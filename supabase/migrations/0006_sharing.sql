-- Sharing (circles phase 2): an appointment or task can be shared with one circle.
-- Members of that circle can read it; only its creator can change it.
-- Private stays the default: circle_id is null unless the creator chooses a circle.

alter table public.appointments add column if not exists circle_id uuid references public.circles (id) on delete set null;
alter table public.tasks add column if not exists circle_id uuid references public.circles (id) on delete set null;
create index if not exists appointments_circle_idx on public.appointments (circle_id) where circle_id is not null;
create index if not exists tasks_circle_idx on public.tasks (circle_id) where circle_id is not null;

-- Read access for circle members. These add to the existing own-rows policies; writes stay creator-only.
drop policy if exists read_circle_appointments on public.appointments;
create policy read_circle_appointments on public.appointments for select
  using (circle_id is not null and public.is_circle_member(circle_id));
drop policy if exists read_circle_tasks on public.tasks;
create policy read_circle_tasks on public.tasks for select
  using (circle_id is not null and public.is_circle_member(circle_id));

-- A shared appointment shows its activity and place, so members may read just those rows.
drop policy if exists read_shared_activity_types on public.activity_types;
create policy read_shared_activity_types on public.activity_types for select using (
  exists (select 1 from public.appointments a
           where a.activity_type_id = activity_types.id and a.circle_id is not null and public.is_circle_member(a.circle_id))
);
drop policy if exists read_shared_places on public.places;
create policy read_shared_places on public.places for select using (
  exists (select 1 from public.appointments a
           where a.place_id = places.id and a.circle_id is not null and public.is_circle_member(a.circle_id))
);

-- You can only share with a circle you belong to. Same function as in 0004, plus the circle check.
create or replace function public.check_appointment_refs() returns trigger
language plpgsql as $$
begin
  if new.activity_type_id is not null and not exists (select 1 from public.activity_types where id = new.activity_type_id and user_id = new.user_id) then
    raise exception 'Activity type not found' using errcode = '23503';
  end if;
  if new.place_id is not null and not exists (select 1 from public.places where id = new.place_id and user_id = new.user_id) then
    raise exception 'Place not found' using errcode = '23503';
  end if;
  if new.series_id is not null and not exists (select 1 from public.appointment_series where id = new.series_id and user_id = new.user_id) then
    raise exception 'Series not found' using errcode = '23503';
  end if;
  if new.circle_id is not null and not exists (select 1 from public.circle_members where circle_id = new.circle_id and user_id = new.user_id) then
    raise exception 'You are not in that circle' using errcode = '23503';
  end if;
  new.updated_at := now();
  return new;
end $$;

-- The same rule for tasks.
create or replace function public.check_task_circle() returns trigger
language plpgsql as $$
begin
  if new.circle_id is not null and not exists (select 1 from public.circle_members where circle_id = new.circle_id and user_id = new.user_id) then
    raise exception 'You are not in that circle' using errcode = '23503';
  end if;
  return new;
end $$;
drop trigger if exists tasks_circle on public.tasks;
create trigger tasks_circle before insert or update of circle_id on public.tasks
for each row execute function public.check_task_circle();

-- Series functions from 0003, now carrying circle_id.
create or replace function public.create_appointment_series(series jsonb, template jsonb, occurrences jsonb)
returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  sid uuid;
  occ jsonb;
begin
  insert into public.appointment_series (weekdays, start_date, end_date, start_time, end_time, time_zone)
  values (
    array(select jsonb_array_elements_text(series->'weekdays')::smallint),
    (series->>'start_date')::date,
    (series->>'end_date')::date,
    (series->>'start_time')::time,
    (series->>'end_time')::time,
    series->>'time_zone'
  ) returning id into sid;

  for occ in select * from jsonb_array_elements(occurrences) loop
    insert into public.appointments (
      activity_type_id, custom_activity, place_id, custom_place, circle_id, series_id, title, starts_at, ends_at, status, team, notes, reminder_minutes
    ) values (
      nullif(template->>'activity_type_id', '')::uuid,
      nullif(template->>'custom_activity', ''),
      nullif(template->>'place_id', '')::uuid,
      nullif(template->>'custom_place', ''),
      nullif(template->>'circle_id', '')::uuid,
      sid,
      template->>'title',
      (occ->>'starts_at')::timestamptz,
      (occ->>'ends_at')::timestamptz,
      coalesce(template->>'status', 'confirmed'),
      nullif(template->>'team', ''),
      nullif(template->>'notes', ''),
      (template->>'reminder_minutes')::integer
    );
  end loop;
  return sid;
end $$;

create or replace function public.update_appointments_bulk(changes jsonb, fields jsonb)
returns integer
language plpgsql security invoker set search_path = public as $$
declare
  ch jsonb;
  n integer := 0;
begin
  for ch in select * from jsonb_array_elements(changes) loop
    update public.appointments set
      starts_at = coalesce((ch->>'starts_at')::timestamptz, starts_at),
      ends_at = coalesce((ch->>'ends_at')::timestamptz, ends_at),
      activity_type_id = case when fields ? 'activity_type_id' then nullif(fields->>'activity_type_id', '')::uuid else activity_type_id end,
      custom_activity = case when fields ? 'custom_activity' then nullif(fields->>'custom_activity', '') else custom_activity end,
      custom_place = case when fields ? 'custom_place' then nullif(fields->>'custom_place', '') else custom_place end,
      circle_id = case when fields ? 'circle_id' then nullif(fields->>'circle_id', '')::uuid else circle_id end,
      place_id = case when fields ? 'place_id' then nullif(fields->>'place_id', '')::uuid else place_id end,
      title = coalesce(fields->>'title', title),
      status = coalesce(fields->>'status', status),
      team = case when fields ? 'team' then nullif(fields->>'team', '') else team end,
      notes = case when fields ? 'notes' then nullif(fields->>'notes', '') else notes end,
      reminder_minutes = case when fields ? 'reminder_minutes' then (fields->>'reminder_minutes')::integer else reminder_minutes end
    where id = (ch->>'id')::uuid;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Leaving or being removed un-shares that person's items. Same functions as in 0005, plus that step.
create or replace function public.leave_circle(p_circle uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  c public.circles;
begin
  select * into c from public.circles where id = p_circle for update;
  if c.id is null or not public.is_circle_member(p_circle) then raise exception 'You are not in this circle'; end if;
  if c.owner_id = auth.uid() then
    if exists (select 1 from public.circle_members where circle_id = p_circle and user_id <> auth.uid()) then
      raise exception 'Make someone else the owner before you leave';
    end if;
    delete from public.circles where id = p_circle;
    return;
  end if;
  -- What they shared with this circle goes back to being private.
  update public.appointments set circle_id = null where circle_id = p_circle and user_id = auth.uid();
  update public.tasks set circle_id = null where circle_id = p_circle and user_id = auth.uid();
  delete from public.circle_members where circle_id = p_circle and user_id = auth.uid();
end $$;

create or replace function public.remove_circle_member(p_circle uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.circles where id = p_circle and owner_id = auth.uid()) then
    raise exception 'Only the owner can do this';
  end if;
  if p_user = auth.uid() then raise exception 'Use leave instead'; end if;
  -- What they shared with this circle goes back to being private.
  update public.appointments set circle_id = null where circle_id = p_circle and user_id = p_user;
  update public.tasks set circle_id = null where circle_id = p_circle and user_id = p_user;
  delete from public.circle_members where circle_id = p_circle and user_id = p_user;
end $$;

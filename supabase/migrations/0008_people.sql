-- People on items (circles phase 3):
--   * who is going to a shared appointment, each with their own reminder;
--   * a busy check that reveals times only, never what the item is;
--   * shared tasks assigned to a member, or left for anyone, and a record of who finished them.

-- ---------------------------------------------------------------------------
-- Who is going
-- ---------------------------------------------------------------------------
-- The creator is always going and is not stored here; these rows are the other members.
create table public.appointment_participants (
  appointment_id uuid not null references public.appointments (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (appointment_id, user_id)
);
create index on public.appointment_participants (user_id);

alter table public.appointment_participants enable row level security;
-- Visible to whoever can see the appointment; the appointment's own policies decide that.
create policy read_participants on public.appointment_participants for select
  using (exists (select 1 from public.appointments a where a.id = appointment_id));
revoke all on public.appointment_participants from anon, authenticated;
grant select on public.appointment_participants to authenticated;

-- One member's reminder for an appointment they are going to, timed by their own default.
create or replace function public.queue_participant_reminder(a public.appointments, uid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  mins integer;
  tz text;
begin
  update public.reminders set status = 'cancelled'
   where appointment_id = a.id and user_id = uid and status = 'pending';
  if a.status = 'cancelled' or a.starts_at <= now() then return; end if;

  select p.default_reminder_minutes, p.time_zone into mins, tz from public.profiles p where p.user_id = uid;
  if not found then mins := 60; end if;      -- no profile yet: the app's default
  if mins is null then return; end if;       -- their default is "No reminder"

  insert into public.reminders (user_id, appointment_id, send_at, title, body)
  values (
    uid, a.id, greatest(a.starts_at - make_interval(mins => mins), now()),
    a.title,
    a.title || ' starts at ' || public.fmt_local_time(a.starts_at, coalesce(tz, 'UTC')) || '.'
      || case when a.status = 'tentative' then ' (Tentative)' else '' end
  );
end $$;

-- Same behaviour as in 0001 for the creator's reminder; then one for each person going.
create or replace function public.sync_appointment_reminder() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  tz text;
  send_time timestamptz;
  p record;
begin
  update public.reminders set status = 'cancelled'
   where appointment_id = new.id and status = 'pending';

  if new.status = 'cancelled' or new.starts_at <= now() then
    return new;
  end if;

  if new.reminder_minutes is not null then
    -- If the reminder time already passed (e.g. created 10 minutes before start), send now.
    send_time := greatest(new.starts_at - make_interval(mins => new.reminder_minutes), now());
    select coalesce(pr.time_zone, 'UTC') into tz from public.profiles pr where pr.user_id = new.user_id;
    tz := coalesce(tz, 'UTC');
    insert into public.reminders (user_id, appointment_id, send_at, title, body)
    values (
      new.user_id, new.id, send_time,
      new.title,
      new.title || ' starts at ' || public.fmt_local_time(new.starts_at, tz) || '.'
        || case when new.status = 'tentative' then ' (Tentative)' else '' end
    );
  end if;

  for p in select user_id from public.appointment_participants where appointment_id = new.id and user_id <> new.user_id loop
    perform public.queue_participant_reminder(new, p.user_id);
  end loop;
  return new;
end $$;

-- Adding someone queues their reminder; removing them cancels it.
create or replace function public.participant_changed() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  a public.appointments;
begin
  if tg_op = 'DELETE' then
    update public.reminders r set status = 'cancelled'
     where r.appointment_id = old.appointment_id and r.user_id = old.user_id and r.status = 'pending'
       and r.user_id <> (select ap.user_id from public.appointments ap where ap.id = old.appointment_id);
    return old;
  end if;
  select * into a from public.appointments where id = new.appointment_id;
  if a.user_id <> new.user_id then perform public.queue_participant_reminder(a, new.user_id); end if;
  return new;
end $$;
create trigger participants_reminder after insert or delete on public.appointment_participants
for each row execute function public.participant_changed();

-- When an appointment stops being shared, or moves to another circle, nobody outside it stays on the list.
create or replace function public.prune_participants() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.appointment_participants p
   where p.appointment_id = new.id
     and (new.circle_id is null
          or not exists (select 1 from public.circle_members m where m.circle_id = new.circle_id and m.user_id = p.user_id));
  return new;
end $$;
create trigger appointments_prune_participants after update of circle_id on public.appointments
for each row when (old.circle_id is distinct from new.circle_id) execute function public.prune_participants();

-- Creator only. Sets who is going to one appointment (p_appt), or to every appointment of a series
-- from p_from onward (p_series). People who are not in the appointment's circle are ignored.
create or replace function public.set_participants(p_appt uuid, p_series uuid, p_from timestamptz, p_users uuid[]) returns integer
language plpgsql security definer set search_path = public as $$
declare
  a record;
  who uuid[] := coalesce(p_users, '{}');
  n integer := 0;
begin
  for a in
    select id, circle_id, user_id from public.appointments
     where user_id = auth.uid()
       and ((p_appt is not null and id = p_appt)
            or (p_series is not null and series_id = p_series and starts_at >= coalesce(p_from, '-infinity')))
  loop
    delete from public.appointment_participants where appointment_id = a.id and not (user_id = any(who));
    if a.circle_id is not null then
      insert into public.appointment_participants (appointment_id, user_id)
      select a.id, m.user_id from public.circle_members m
       where m.circle_id = a.circle_id and m.user_id = any(who) and m.user_id <> a.user_id
      on conflict do nothing;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Busy check
-- ---------------------------------------------------------------------------
-- For members of a circle the caller belongs to: when each of p_users is busy inside a time window,
-- counting private appointments too. Returns times only, so nothing about a private item leaks but its hours.
create or replace function public.circle_busy(p_circle uuid, p_users uuid[], p_from timestamptz, p_to timestamptz, p_exclude uuid)
returns table (user_id uuid, starts_at timestamptz, ends_at timestamptz)
language sql stable security definer set search_path = public as $$
  select distinct m.user_id, a.starts_at, a.ends_at
    from public.circle_members m
    join public.appointments a
      on a.status <> 'cancelled' and a.starts_at < p_to and a.ends_at > p_from
     and (a.user_id = m.user_id
          or exists (select 1 from public.appointment_participants p where p.appointment_id = a.id and p.user_id = m.user_id))
   where m.circle_id = p_circle
     and public.is_circle_member(p_circle)
     and m.user_id = any(coalesce(p_users, '{}'))
     and (p_exclude is null or a.id <> p_exclude)
   order by 1, 2;
$$;

-- ---------------------------------------------------------------------------
-- Task assignment
-- ---------------------------------------------------------------------------
-- assignee_id: the member a shared task is for; null means anyone in the circle.
-- completed_by: who marked it done.
alter table public.tasks
  add column if not exists assignee_id uuid references auth.users (id) on delete set null,
  add column if not exists completed_by uuid references auth.users (id) on delete set null;

-- Same check as in 0006, plus: only a shared task can be assigned, and only to a member of its circle.
create or replace function public.check_task_circle() returns trigger
language plpgsql as $$
begin
  if new.circle_id is null then
    new.assignee_id := null;
    return new;
  end if;
  if not exists (select 1 from public.circle_members where circle_id = new.circle_id and user_id = new.user_id) then
    raise exception 'You are not in that circle' using errcode = '23503';
  end if;
  if new.assignee_id is not null
     and not exists (select 1 from public.circle_members where circle_id = new.circle_id and user_id = new.assignee_id) then
    raise exception 'They are not in that circle' using errcode = '23503';
  end if;
  return new;
end $$;
drop trigger if exists tasks_circle on public.tasks;
create trigger tasks_circle before insert or update of circle_id, assignee_id on public.tasks
for each row execute function public.check_task_circle();

-- Mark a task done or not done. Allowed for its creator, and on a shared task for the member it is
-- assigned to, or for any member when it is for anyone.
create or replace function public.set_task_done(p_task uuid, p_done boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  t public.tasks;
begin
  select * into t from public.tasks where id = p_task for update;
  if t.id is null then raise exception 'Task not found'; end if;
  if not (t.user_id = auth.uid()
          or (t.circle_id is not null and public.is_circle_member(t.circle_id)
              and (t.assignee_id is null or t.assignee_id = auth.uid()))) then
    raise exception 'Only its owner or the person it is assigned to can do this';
  end if;
  update public.tasks
     set state = case when p_done then 'completed' else 'pending' end,
         completed_at = case when p_done then now() end,
         completed_by = case when p_done then auth.uid() end
   where id = p_task;
end $$;

-- ---------------------------------------------------------------------------
-- Leaving a circle. Same functions as in 0006, plus clearing "going" and assignments.
-- ---------------------------------------------------------------------------
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
  -- They stop being listed as going to, or assigned, anything in this circle.
  delete from public.appointment_participants p using public.appointments a
   where a.id = p.appointment_id and a.circle_id = p_circle and p.user_id = auth.uid();
  update public.tasks set assignee_id = null where circle_id = p_circle and assignee_id = auth.uid();
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
  -- They stop being listed as going to, or assigned, anything in this circle.
  delete from public.appointment_participants p using public.appointments a
   where a.id = p.appointment_id and a.circle_id = p_circle and p.user_id = p_user;
  update public.tasks set assignee_id = null where circle_id = p_circle and assignee_id = p_user;
  -- What they shared with this circle goes back to being private.
  update public.appointments set circle_id = null where circle_id = p_circle and user_id = p_user;
  update public.tasks set circle_id = null where circle_id = p_circle and user_id = p_user;
  delete from public.circle_members where circle_id = p_circle and user_id = p_user;
end $$;

revoke all on function
  public.set_participants(uuid, uuid, timestamptz, uuid[]), public.circle_busy(uuid, uuid[], timestamptz, timestamptz, uuid),
  public.set_task_done(uuid, boolean), public.queue_participant_reminder(public.appointments, uuid)
from public, anon;
grant execute on function
  public.set_participants(uuid, uuid, timestamptz, uuid[]), public.circle_busy(uuid, uuid[], timestamptz, timestamptz, uuid),
  public.set_task_done(uuid, boolean)
to authenticated;

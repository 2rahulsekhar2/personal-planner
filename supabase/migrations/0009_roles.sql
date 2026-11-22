-- Roles, privacy and replies (circles phase 4):
--   * roles are enforced: a viewer sees what is shared but cannot share, be given tasks, or finish them;
--   * temporary members: access that ends on a date (a sitter, a visiting relative);
--   * busy only: an appointment shared as a block of time, with nothing else about it;
--   * replies: someone listed as going can answer "going" or "can't".

-- ---------------------------------------------------------------------------
-- Roles and temporary access
-- ---------------------------------------------------------------------------
-- expires_at null: a permanent member. Past: the row stays, so the owner can see it and extend it,
-- but the person counts as outside the circle everywhere.
alter table public.circle_members add column if not exists expires_at timestamptz;
-- How long an invite's access lasts, counted from the day it is accepted. Null: no end.
alter table public.circle_invites add column if not exists access_days integer check (access_days between 1 and 365);

create or replace function public.is_circle_member(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.circle_members
                  where circle_id = cid and user_id = auth.uid() and (expires_at is null or expires_at > now()));
$$;

-- May this person add to the circle: a current owner or member, not a viewer.
create or replace function public.can_add_to_circle(cid uuid, uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select (uid = auth.uid() or public.is_circle_member(cid))   -- only about yourself, or someone in a circle of yours
     and exists (select 1 from public.circle_members
                  where circle_id = cid and user_id = uid and role <> 'viewer' and (expires_at is null or expires_at > now()));
$$;

-- Same function as in 0006. The circle rule now also needs a role that may add, and is checked when the
-- item is shared rather than on every edit, so someone whose access changed can still edit what is theirs.
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
  if new.circle_id is null then
    new.busy_only := false;
  elsif (tg_op = 'INSERT' or new.circle_id is distinct from old.circle_id)
        and not public.can_add_to_circle(new.circle_id, new.user_id) then
    raise exception 'You cannot share with that circle: you are not in it, or you are a viewer' using errcode = '23503';
  end if;
  new.updated_at := now();
  return new;
end $$;

-- Same function as in 0008, with the same role rule, and: a viewer cannot be given a task.
create or replace function public.check_task_circle() returns trigger
language plpgsql as $$
begin
  if new.circle_id is null then
    new.assignee_id := null;
    return new;
  end if;
  if (tg_op = 'INSERT' or new.circle_id is distinct from old.circle_id)
     and not public.can_add_to_circle(new.circle_id, new.user_id) then
    raise exception 'You cannot share with that circle: you are not in it, or you are a viewer' using errcode = '23503';
  end if;
  if new.assignee_id is not null
     and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id or new.circle_id is distinct from old.circle_id)
     and not public.can_add_to_circle(new.circle_id, new.assignee_id) then
    raise exception 'They cannot be given tasks in that circle: they are not in it, or they are a viewer' using errcode = '23503';
  end if;
  return new;
end $$;

-- Same function as in 0008; a viewer cannot finish someone else's task.
create or replace function public.set_task_done(p_task uuid, p_done boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  t public.tasks;
begin
  select * into t from public.tasks where id = p_task for update;
  if t.id is null then raise exception 'Task not found'; end if;
  if not (t.user_id = auth.uid()
          or (t.circle_id is not null and public.can_add_to_circle(t.circle_id, auth.uid())
              and (t.assignee_id is null or t.assignee_id = auth.uid()))) then
    raise exception 'Only its owner or the person it is assigned to can do this';
  end if;
  update public.tasks
     set state = case when p_done then 'completed' else 'pending' end,
         completed_at = case when p_done then now() end,
         completed_by = case when p_done then auth.uid() end
   where id = p_task;
end $$;

-- Owner only: change another member's role and when their access ends (null: no end).
create or replace function public.update_circle_member(p_circle uuid, p_user uuid, p_role text, p_until timestamptz) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.circles where id = p_circle and owner_id = auth.uid()) then
    raise exception 'Only the owner can do this';
  end if;
  if p_user = auth.uid() then raise exception 'The owner''s own access cannot be changed'; end if;
  if p_role not in ('member', 'viewer') then raise exception 'Pick member or viewer'; end if;
  update public.circle_members set role = p_role, expires_at = p_until where circle_id = p_circle and user_id = p_user;
  if not found then raise exception 'They are not in this circle'; end if;
  -- A viewer holds no tasks.
  if p_role = 'viewer' then
    update public.tasks set assignee_id = null where circle_id = p_circle and assignee_id = p_user;
  end if;
  -- Reminders for anything that starts after their access ends are stopped.
  if p_until is not null then
    update public.reminders r set status = 'cancelled'
      from public.appointments a
     where a.id = r.appointment_id and a.circle_id = p_circle and a.user_id <> p_user
       and r.user_id = p_user and r.status = 'pending' and a.starts_at >= p_until;
  end if;
end $$;

-- Invites carry the access length. Same functions as in 0005 otherwise.
drop function if exists public.invite_to_circle(uuid, text, text);
create or replace function public.invite_to_circle(p_circle uuid, p_email text, p_role text, p_days integer default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  c public.circles;
  addr text := lower(nullif(trim(p_email), ''));
  tok uuid;
begin
  select * into c from public.circles where id = p_circle;
  if c.id is null or c.owner_id <> auth.uid() then raise exception 'Only the owner can invite'; end if;
  if addr is not null then
    if addr !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'That email address does not look right'; end if;
    if exists (select 1 from public.circle_members where circle_id = p_circle and lower(email) = addr) then
      raise exception 'They are already in this circle';
    end if;
    -- One open invite per address: a new one replaces the old.
    delete from public.circle_invites where circle_id = p_circle and lower(email) = addr and accepted_at is null;
  end if;
  insert into public.circle_invites (circle_id, circle_name, inviter_email, email, role, access_days)
  values (p_circle, c.name, public.my_email(), addr, coalesce(p_role, 'member'), p_days)
  returning token into tok;
  return tok;
end $$;

drop function if exists public.get_invite(uuid);
create or replace function public.get_invite(p_token uuid)
returns table (circle_name text, inviter_email text, role text, expires_at timestamptz, usable boolean, access_days integer)
language sql stable security definer set search_path = public as $$
  select i.circle_name, i.inviter_email, i.role, i.expires_at,
         (i.accepted_at is null and i.declined_at is null and i.expires_at > now()
          and (i.email is null or i.email = public.my_email())
          and not exists (select 1 from public.circle_members m where m.circle_id = i.circle_id and m.user_id = auth.uid())),
         i.access_days
    from public.circle_invites i
   where i.token = p_token and auth.uid() is not null;
$$;

create or replace function public.respond_to_invite(p_token uuid, p_accept boolean) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  i public.circle_invites;
begin
  if auth.uid() is null or public.my_email() is null then raise exception 'Sign in first'; end if;
  select * into i from public.circle_invites where token = p_token for update;
  if i.id is null then raise exception 'Invite not found'; end if;
  if i.email is not null and i.email <> public.my_email() then raise exception 'This invite is for a different email address'; end if;
  if i.accepted_at is not null or i.declined_at is not null then raise exception 'This invite was already used'; end if;
  if i.expires_at <= now() then raise exception 'This invite has expired'; end if;

  if not p_accept then
    -- Declining an addressed invite closes it; a link stays usable by someone else.
    if i.email is not null then update public.circle_invites set declined_at = now() where id = i.id; end if;
    return null;
  end if;

  insert into public.circle_members (circle_id, user_id, email, role, expires_at)
  values (i.circle_id, auth.uid(), public.my_email(), i.role, now() + make_interval(days => i.access_days))
  on conflict (circle_id, user_id) do nothing;
  update public.circle_invites set accepted_at = now() where id = i.id;
  return i.circle_id;
end $$;

-- ---------------------------------------------------------------------------
-- Busy only
-- ---------------------------------------------------------------------------
-- A shared appointment with busy_only set is not readable by the circle at all. Members get its hours,
-- and whose it is, from circle_busy_blocks below. Nothing else about it leaves its creator.
alter table public.appointments add column if not exists busy_only boolean not null default false;

drop policy if exists read_circle_appointments on public.appointments;
create policy read_circle_appointments on public.appointments for select
  using (circle_id is not null and not busy_only and public.is_circle_member(circle_id));

create or replace function public.circle_busy_blocks(p_from timestamptz, p_to timestamptz)
returns table (id uuid, user_id uuid, circle_id uuid, starts_at timestamptz, ends_at timestamptz)
language sql stable security definer set search_path = public as $$
  select a.id, a.user_id, a.circle_id, a.starts_at, a.ends_at
    from public.appointments a
   where a.busy_only and a.circle_id is not null and a.status <> 'cancelled' and a.user_id <> auth.uid()
     and a.starts_at < p_to and a.ends_at > p_from
     and public.is_circle_member(a.circle_id)
   order by a.starts_at;
$$;

-- Same function as in 0007, except that a busy-only item is logged as private, so its title
-- never reaches the circle's history.
create or replace function public.log_item_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o jsonb := to_jsonb(old);
  n jsonb := to_jsonb(new);
  r jsonb := coalesce(n, o);
  oc text := case when coalesce((o->>'busy_only')::boolean, false) then null else o->>'circle_id' end;
  nc text := case when coalesce((n->>'busy_only')::boolean, false) then null else n->>'circle_id' end;
  who text;
  act text;
begin
  -- No user row means the account is being deleted and this is its cascade: nothing to log.
  select email into who from auth.users where id = (r->>'user_id')::uuid;
  if who is null then return null; end if;

  if tg_op = 'INSERT' then act := 'added';
  elsif tg_op = 'DELETE' then act := 'deleted';
  elsif (n - 'updated_at') = (o - 'updated_at') then return null;
  elsif nc is distinct from oc then
    -- The circle that loses the item is told too.
    if oc is not null then
      insert into public.activity_log (user_id, email, circle_id, kind, action, title)
      values ((r->>'user_id')::uuid, who, oc::uuid, tg_argv[0], 'unshared', r->>'title');
    end if;
    if nc is null then return null; end if;
    act := 'shared';
  elsif n->>'status' = 'cancelled' and o->>'status' <> 'cancelled' then act := 'cancelled';
  elsif n->>'outcome' is distinct from o->>'outcome' and n->>'outcome' is not null then act := n->>'outcome';  -- done, not_done
  elsif n->>'state' is distinct from o->>'state' then act := n->>'state';                                      -- completed, dismissed, pending
  elsif n->>'starts_at' is distinct from o->>'starts_at' or n->>'ends_at' is distinct from o->>'ends_at'
     or n->>'due_date' is distinct from o->>'due_date' or n->>'due_time' is distinct from o->>'due_time' then act := 'rescheduled';
  else act := 'edited';
  end if;

  insert into public.activity_log (user_id, email, circle_id, kind, action, title)
  values ((r->>'user_id')::uuid, who, (case when tg_op = 'DELETE' then oc else nc end)::uuid, tg_argv[0], act, r->>'title');
  return null;
end $$;

-- A busy-only appointment has no going list. Same function and trigger as in 0008, plus that.
create or replace function public.prune_participants() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.appointment_participants p
   where p.appointment_id = new.id
     and (new.circle_id is null or new.busy_only
          or not exists (select 1 from public.circle_members m where m.circle_id = new.circle_id and m.user_id = p.user_id));
  return new;
end $$;
drop trigger if exists appointments_prune_participants on public.appointments;
create trigger appointments_prune_participants after update of circle_id, busy_only on public.appointments
for each row when (old.circle_id is distinct from new.circle_id or old.busy_only is distinct from new.busy_only)
execute function public.prune_participants();

create or replace function public.set_participants(p_appt uuid, p_series uuid, p_from timestamptz, p_users uuid[]) returns integer
language plpgsql security definer set search_path = public as $$
declare
  a record;
  who uuid[] := coalesce(p_users, '{}');
  n integer := 0;
begin
  for a in
    select id, circle_id, user_id, busy_only from public.appointments
     where user_id = auth.uid()
       and ((p_appt is not null and id = p_appt)
            or (p_series is not null and series_id = p_series and starts_at >= coalesce(p_from, '-infinity')))
  loop
    -- Off the list: anyone not chosen, and anyone whose access to the circle has ended.
    delete from public.appointment_participants p
     where p.appointment_id = a.id
       and (not (p.user_id = any(who))
            or not exists (select 1 from public.circle_members m
                            where m.circle_id = a.circle_id and m.user_id = p.user_id and (m.expires_at is null or m.expires_at > now())));
    if a.circle_id is not null and not a.busy_only then
      insert into public.appointment_participants (appointment_id, user_id)
      select a.id, m.user_id from public.circle_members m
       where m.circle_id = a.circle_id and m.user_id = any(who) and m.user_id <> a.user_id
         and (m.expires_at is null or m.expires_at > now())
      on conflict do nothing;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Series functions from 0006, now carrying busy_only.
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
      activity_type_id, custom_activity, place_id, custom_place, circle_id, busy_only, series_id, title, starts_at, ends_at, status, team, notes, reminder_minutes
    ) values (
      nullif(template->>'activity_type_id', '')::uuid,
      nullif(template->>'custom_activity', ''),
      nullif(template->>'place_id', '')::uuid,
      nullif(template->>'custom_place', ''),
      nullif(template->>'circle_id', '')::uuid,
      coalesce((template->>'busy_only')::boolean, false),
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
      busy_only = case when fields ? 'busy_only' then coalesce((fields->>'busy_only')::boolean, false) else busy_only end,
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

-- ---------------------------------------------------------------------------
-- Replies
-- ---------------------------------------------------------------------------
-- null: no answer yet.
alter table public.appointment_participants add column if not exists reply text check (reply in ('going', 'cant'));

-- Same function as in 0008, plus: no reminder for someone who said they can't come, or whose access
-- to the circle ends before it starts.
create or replace function public.queue_participant_reminder(a public.appointments, uid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  mins integer;
  tz text;
begin
  update public.reminders set status = 'cancelled'
   where appointment_id = a.id and user_id = uid and status = 'pending';
  if a.status = 'cancelled' or a.starts_at <= now() then return; end if;
  if exists (select 1 from public.appointment_participants p where p.appointment_id = a.id and p.user_id = uid and p.reply = 'cant') then return; end if;
  if not exists (select 1 from public.circle_members m
                  where m.circle_id = a.circle_id and m.user_id = uid and (m.expires_at is null or m.expires_at > a.starts_at)) then
    return;
  end if;

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

-- For someone listed as going: answer 'going' or 'cant', or null to take the answer back.
create or replace function public.reply_to_appointment(p_appt uuid, p_reply text) returns void
language plpgsql security definer set search_path = public as $$
declare
  a public.appointments;
begin
  update public.appointment_participants set reply = p_reply where appointment_id = p_appt and user_id = auth.uid();
  if not found then raise exception 'You are not listed on this appointment'; end if;
  select * into a from public.appointments where id = p_appt;
  perform public.queue_participant_reminder(a, auth.uid());
end $$;

-- Same function as in 0008; someone who said they can't come is not busy with it.
create or replace function public.circle_busy(p_circle uuid, p_users uuid[], p_from timestamptz, p_to timestamptz, p_exclude uuid)
returns table (user_id uuid, starts_at timestamptz, ends_at timestamptz)
language sql stable security definer set search_path = public as $$
  select distinct m.user_id, a.starts_at, a.ends_at
    from public.circle_members m
    join public.appointments a
      on a.status <> 'cancelled' and a.starts_at < p_to and a.ends_at > p_from
     and (a.user_id = m.user_id
          or exists (select 1 from public.appointment_participants p
                      where p.appointment_id = a.id and p.user_id = m.user_id and p.reply is distinct from 'cant'))
   where m.circle_id = p_circle
     and public.is_circle_member(p_circle)
     and m.user_id = any(coalesce(p_users, '{}'))
     and (p_exclude is null or a.id <> p_exclude)
   order by 1, 2;
$$;

revoke all on function
  public.can_add_to_circle(uuid, uuid), public.update_circle_member(uuid, uuid, text, timestamptz),
  public.invite_to_circle(uuid, text, text, integer), public.get_invite(uuid),
  public.circle_busy_blocks(timestamptz, timestamptz), public.reply_to_appointment(uuid, text)
from public, anon;
grant execute on function
  public.can_add_to_circle(uuid, uuid), public.update_circle_member(uuid, uuid, text, timestamptz),
  public.invite_to_circle(uuid, text, text, integer), public.get_invite(uuid),
  public.circle_busy_blocks(timestamptz, timestamptz), public.reply_to_appointment(uuid, text)
to authenticated;

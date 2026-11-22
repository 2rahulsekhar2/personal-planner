-- Two loose ends from circles phase 4:
--   * moving an appointment clears the replies, since "going" was an answer to the old time;
--   * a person whose access has ended can still see that circle by name, and leave it.

-- Same function as in 0008, plus the reset at the top.
create or replace function public.sync_appointment_reminder() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  tz text;
  send_time timestamptz;
  p record;
begin
  -- A new time is a new question: everyone listed is asked again, and gets a reminder again.
  if tg_op = 'UPDATE' and (new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at) then
    update public.appointment_participants set reply = null where appointment_id = new.id and reply is not null;
  end if;

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

-- After access ends a person still reads their own membership row and the circle's name, nothing else:
-- the other members, and everything shared, stay behind is_circle_member.
drop policy if exists read_circle_members on public.circle_members;
create policy read_circle_members on public.circle_members for select
  using (public.is_circle_member(circle_id) or user_id = auth.uid());
drop policy if exists read_my_circles on public.circles;
create policy read_my_circles on public.circles for select
  using (exists (select 1 from public.circle_members m where m.circle_id = id and m.user_id = auth.uid()));

-- Same function as in 0008, except that having a membership row is enough to leave, ended or not.
create or replace function public.leave_circle(p_circle uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  c public.circles;
begin
  select * into c from public.circles where id = p_circle for update;
  if c.id is null or not exists (select 1 from public.circle_members where circle_id = p_circle and user_id = auth.uid()) then
    raise exception 'You are not in this circle';
  end if;
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

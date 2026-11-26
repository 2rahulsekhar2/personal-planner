-- Several reminders on one appointment or task.
-- The first stays where it was (appointments.reminder_minutes, tasks.notify_at); the others go in a list beside it.
-- Until this has been run the app offers one reminder, as before.

alter table public.appointments add column if not exists extra_reminder_minutes integer[] not null default '{}';
alter table public.appointments drop constraint if exists appointments_extra_reminder_minutes_check;
alter table public.appointments add constraint appointments_extra_reminder_minutes_check
  check (0 <= all (extra_reminder_minutes) and 10080 >= all (extra_reminder_minutes) and cardinality(extra_reminder_minutes) <= 4);

alter table public.tasks add column if not exists extra_notify_at timestamptz[] not null default '{}';
alter table public.tasks drop constraint if exists tasks_extra_notify_at_check;
alter table public.tasks add constraint tasks_extra_notify_at_check check (cardinality(extra_notify_at) <= 4);

-- Same function as in 0011, except that the creator gets one reminder for each time chosen.
create or replace function public.sync_appointment_reminder() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  tz text;
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

  select coalesce(pr.time_zone, 'UTC') into tz from public.profiles pr where pr.user_id = new.user_id;
  tz := coalesce(tz, 'UTC');
  -- A reminder whose time already passed (e.g. created 10 minutes before start) is sent now.
  -- "distinct": two that have both passed become one, not two at once.
  insert into public.reminders (user_id, appointment_id, send_at, title, body)
  select new.user_id, new.id, s.send_at,
         new.title,
         new.title || ' starts at ' || public.fmt_local_time(new.starts_at, tz) || '.'
           || case when new.status = 'tentative' then ' (Tentative)' else '' end
    from (select distinct greatest(new.starts_at - make_interval(mins => m), now()) as send_at
            from unnest(array_append(new.extra_reminder_minutes, new.reminder_minutes)) as m
           where m is not null) s;

  for p in select user_id from public.appointment_participants where appointment_id = new.id and user_id <> new.user_id loop
    perform public.queue_participant_reminder(new, p.user_id);
  end loop;
  return new;
end $$;

drop trigger if exists appointments_reminder on public.appointments;
create trigger appointments_reminder after insert or update of starts_at, ends_at, status, reminder_minutes, extra_reminder_minutes, title
on public.appointments for each row execute function public.sync_appointment_reminder();

-- Same function as in 0001, for each time chosen.
create or replace function public.sync_task_reminder() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.reminders set status = 'cancelled'
   where task_id = new.id and status = 'pending';

  if new.state <> 'pending' then
    return new;
  end if;

  insert into public.reminders (user_id, task_id, send_at, title, body)
  select new.user_id, new.id, s.send_at,
         new.title,
         new.title || case
           when new.due_time is not null then ' — due ' || ltrim(to_char(new.due_time, 'HH12:MI AM'), '0') || '.'
           else ' — due ' || to_char(new.due_date, 'Mon FMDD') || '.'
         end
    from (select distinct greatest(n, now()) as send_at
            from unnest(array_append(new.extra_notify_at, new.notify_at)) as n
           where n is not null and n > now() - interval '1 minute') s;
  return new;
end $$;

drop trigger if exists tasks_reminder on public.tasks;
create trigger tasks_reminder after insert or update of notify_at, extra_notify_at, state, title, due_date, due_time
on public.tasks for each row execute function public.sync_task_reminder();

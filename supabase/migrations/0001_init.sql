-- Personal Planner v1 schema
-- Run in the Supabase SQL editor (or `supabase db push`).

create extension if not exists btree_gist;

-- ---------------------------------------------------------------------------
-- Profiles: per-user defaults
-- ---------------------------------------------------------------------------
create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  time_zone text,                      -- null until the app sets it from the device
  default_reminder_minutes integer default 60 check (default_reminder_minutes is null or default_reminder_minutes between 0 and 10080),
  show_cancelled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Activity types and places (reusable, archivable)
-- ---------------------------------------------------------------------------
create table public.activity_types (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  color text not null default 'sage',
  archived_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.activity_types (user_id);

create table public.places (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  maps_url text not null check (
    maps_url ~* '^https://((www\.)?google\.[a-z.]+/maps|maps\.google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl/maps)(/|\?|$)'
  ),
  notes text,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.places (user_id);

-- ---------------------------------------------------------------------------
-- Appointments
-- ---------------------------------------------------------------------------
create table public.appointment_series (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  weekdays smallint[] not null,          -- ISO weekdays 1=Mon..7=Sun
  start_date date not null,
  end_date date not null check (end_date >= start_date),
  start_time time not null,
  end_time time not null,
  time_zone text not null,
  created_at timestamptz not null default now()
);

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  activity_type_id uuid not null references public.activity_types (id),
  place_id uuid references public.places (id),
  series_id uuid references public.appointment_series (id) on delete set null,
  title text not null check (length(trim(title)) between 1 and 200),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'confirmed' check (status in ('confirmed', 'tentative', 'cancelled')),
  team text,
  notes text,
  reminder_minutes integer check (reminder_minutes is null or reminder_minutes between 0 and 10080),
  client_request_id uuid unique,          -- idempotency key for safe retries
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appointment_end_after_start check (ends_at > starts_at),
  -- Same activity type may never overlap (cancelled excluded). Half-open range so
  -- an appointment ending at 9:00 does not clash with one starting at 9:00.
  -- Enforced inside Postgres, so concurrent saves from two devices cannot both win.
  constraint appointment_same_activity_overlap exclude using gist (
    user_id with =,
    activity_type_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status <> 'cancelled')
);
create index on public.appointments (user_id, starts_at);
create index on public.appointments (series_id);

-- ---------------------------------------------------------------------------
-- Tasks
-- ---------------------------------------------------------------------------
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 200),
  due_date date not null,
  due_time time,
  notify_at timestamptz,
  notes text,
  state text not null default 'pending' check (state in ('pending', 'completed', 'dismissed')),
  completed_at timestamptz,
  client_request_id uuid unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.tasks (user_id, due_date);

-- ---------------------------------------------------------------------------
-- Push subscriptions (one per browser/device) and scheduled reminders
-- ---------------------------------------------------------------------------
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_success_at timestamptz
);
create index on public.push_subscriptions (user_id);

create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  appointment_id uuid references public.appointments (id) on delete cascade,
  task_id uuid references public.tasks (id) on delete cascade,
  send_at timestamptz not null,
  title text not null,
  body text not null,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'cancelled', 'failed')),
  attempts integer not null default 0,
  claimed_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  check ((appointment_id is null) <> (task_id is null))
);
create index reminders_due_idx on public.reminders (send_at) where status in ('pending', 'sending');
create index on public.reminders (appointment_id);
create index on public.reminders (task_id);

-- ---------------------------------------------------------------------------
-- Row level security: every record is private to its owner
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.activity_types enable row level security;
alter table public.places enable row level security;
alter table public.appointment_series enable row level security;
alter table public.appointments enable row level security;
alter table public.tasks enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.reminders enable row level security;

create policy own_profile on public.profiles for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_activity_types on public.activity_types for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_places on public.places for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_series on public.appointment_series for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_appointments on public.appointments for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_tasks on public.tasks for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_push_subscriptions on public.push_subscriptions for all using (user_id = auth.uid()) with check (user_id = auth.uid());
-- Reminders are written only by triggers; users can read their own.
create policy read_own_reminders on public.reminders for select using (user_id = auth.uid());

-- Referenced activity types / places must belong to the same user.
create or replace function public.check_appointment_refs() returns trigger
language plpgsql as $$
begin
  if not exists (select 1 from public.activity_types where id = new.activity_type_id and user_id = new.user_id) then
    raise exception 'Activity type not found' using errcode = '23503';
  end if;
  if new.place_id is not null and not exists (select 1 from public.places where id = new.place_id and user_id = new.user_id) then
    raise exception 'Place not found' using errcode = '23503';
  end if;
  if new.series_id is not null and not exists (select 1 from public.appointment_series where id = new.series_id and user_id = new.user_id) then
    raise exception 'Series not found' using errcode = '23503';
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger appointments_refs before insert or update on public.appointments
for each row execute function public.check_appointment_refs();

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger tasks_touch before update on public.tasks for each row execute function public.touch_updated_at();
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();

-- Create a profile automatically on sign-up.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id) values (new.id) on conflict do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Reminder scheduling: kept in sync with appointments/tasks by triggers, so
-- every edit, reschedule or cancellation updates pending reminders atomically.
-- ---------------------------------------------------------------------------
create or replace function public.fmt_local_time(ts timestamptz, tz text) returns text
language sql stable as $$
  select ltrim(to_char(ts at time zone tz, 'HH12:MI AM'), '0')
$$;

create or replace function public.sync_appointment_reminder() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  tz text;
  send_time timestamptz;
begin
  update public.reminders set status = 'cancelled'
   where appointment_id = new.id and status = 'pending';

  if new.status = 'cancelled' or new.reminder_minutes is null then
    return new;
  end if;

  send_time := new.starts_at - make_interval(mins => new.reminder_minutes);
  if new.starts_at <= now() then
    return new;
  end if;
  -- If the reminder time already passed (e.g. created 10 minutes before start), send now.
  if send_time < now() then
    send_time := now();
  end if;

  select coalesce(p.time_zone, 'UTC') into tz from public.profiles p where p.user_id = new.user_id;
  tz := coalesce(tz, 'UTC');

  insert into public.reminders (user_id, appointment_id, send_at, title, body)
  values (
    new.user_id, new.id, send_time,
    new.title,
    new.title || ' starts at ' || public.fmt_local_time(new.starts_at, tz) || '.'
      || case when new.status = 'tentative' then ' (Tentative)' else '' end
  );
  return new;
end $$;

create trigger appointments_reminder after insert or update of starts_at, ends_at, status, reminder_minutes, title
on public.appointments for each row execute function public.sync_appointment_reminder();

create or replace function public.sync_task_reminder() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  tz text;
begin
  update public.reminders set status = 'cancelled'
   where task_id = new.id and status = 'pending';

  if new.state <> 'pending' or new.notify_at is null or new.notify_at <= now() - interval '1 minute' then
    return new;
  end if;

  select coalesce(p.time_zone, 'UTC') into tz from public.profiles p where p.user_id = new.user_id;
  tz := coalesce(tz, 'UTC');

  insert into public.reminders (user_id, task_id, send_at, title, body)
  values (
    new.user_id, new.id, greatest(new.notify_at, now()),
    new.title,
    new.title || case
      when new.due_time is not null then ' — due ' || ltrim(to_char(new.due_time, 'HH12:MI AM'), '0') || '.'
      else ' — due ' || to_char(new.due_date, 'Mon FMDD') || '.'
    end
  );
  return new;
end $$;

create trigger tasks_reminder after insert or update of notify_at, state, title, due_date, due_time
on public.tasks for each row execute function public.sync_task_reminder();

-- When the time zone changes, rebuild pending reminder texts.
create or replace function public.resync_reminders_for_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.time_zone is distinct from old.time_zone then
    update public.appointments set title = title where user_id = new.user_id and starts_at > now() and status <> 'cancelled';
  end if;
  return new;
end $$;
create trigger profiles_tz_resync after update of time_zone on public.profiles
for each row execute function public.resync_reminders_for_user();

-- ---------------------------------------------------------------------------
-- Delivery: the sender claims due reminders atomically so overlapping cron
-- runs never send the same reminder twice. Service role only.
-- ---------------------------------------------------------------------------
create or replace function public.claim_due_reminders(batch_size integer default 100)
returns setof public.reminders
language plpgsql security definer set search_path = public as $$
begin
  return query
  update public.reminders r
     set status = 'sending', claimed_at = now(), attempts = r.attempts + 1
   where r.id in (
     select id from public.reminders
      where send_at <= now()
        and (status = 'pending' or (status = 'sending' and claimed_at < now() - interval '5 minutes' and attempts < 3))
        and send_at > now() - interval '6 hours'   -- don't deliver very stale reminders
      order by send_at
      limit batch_size
      for update skip locked
   )
  returning r.*;
end $$;

revoke all on function public.claim_due_reminders(integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Recurring series: all occurrences are inserted in one transaction, so a
-- single same-activity conflict rolls back the whole series.
-- ---------------------------------------------------------------------------
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
      activity_type_id, place_id, series_id, title, starts_at, ends_at, status, team, notes, reminder_minutes
    ) values (
      (template->>'activity_type_id')::uuid,
      nullif(template->>'place_id', '')::uuid,
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

-- Update many occurrences of a series at once (whole-series edit), atomically.
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
      activity_type_id = coalesce((fields->>'activity_type_id')::uuid, activity_type_id),
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

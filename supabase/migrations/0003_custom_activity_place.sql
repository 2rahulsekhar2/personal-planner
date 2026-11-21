-- One-off activity and place for a single appointment: free text, not added to the saved lists.
-- An appointment now has either a saved activity type or a custom activity name.
alter table public.appointments
  alter column activity_type_id drop not null,
  add column if not exists custom_activity text check (custom_activity is null or length(trim(custom_activity)) between 1 and 100),
  add column if not exists custom_place text check (custom_place is null or length(trim(custom_place)) between 1 and 200);

alter table public.appointments drop constraint if exists appointment_has_activity;
alter table public.appointments add constraint appointment_has_activity
  check (activity_type_id is not null or custom_activity is not null);

-- The same-activity overlap rule compares activity_type_id, and null never equals null,
-- so custom-activity appointments do not block each other. That is intended: they are one-offs.

-- Same functions as in 0001, now carrying the two custom fields.
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
      activity_type_id, custom_activity, place_id, custom_place, series_id, title, starts_at, ends_at, status, team, notes, reminder_minutes
    ) values (
      nullif(template->>'activity_type_id', '')::uuid,
      nullif(template->>'custom_activity', ''),
      nullif(template->>'place_id', '')::uuid,
      nullif(template->>'custom_place', ''),
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
      activity_type_id = case when fields ? 'activity_type_id' then nullif(fields->>'activity_type_id', '')::uuid else activity_type_id end,
      custom_activity = case when fields ? 'custom_activity' then nullif(fields->>'custom_activity', '') else custom_activity end,
      custom_place = case when fields ? 'custom_place' then nullif(fields->>'custom_place', '') else custom_place end,
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

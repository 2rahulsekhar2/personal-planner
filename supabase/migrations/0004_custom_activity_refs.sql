-- Follow-up to 0003: the reference check from 0001 still demanded a saved activity type,
-- so an appointment with only a one-off custom_activity was rejected with "Activity type not found".
-- Same function as in 0001, now skipping that check when there is no activity_type_id.
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
  new.updated_at := now();
  return new;
end $$;

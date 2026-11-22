-- Two additions for repeats:
--   * changing how an appointment series repeats, from one appointment onward;
--   * tasks that repeat.

-- Replace a series from one appointment onward: that appointment and the later ones are removed and a new
-- run is saved, in one transaction, so a failure part-way cannot leave the calendar with neither.
-- Runs as the caller: row-level security limits the delete to their own appointments, and
-- create_appointment_series applies the usual checks to the new ones.
create or replace function public.replace_series_from(p_series uuid, p_from timestamptz, series jsonb, template jsonb, occurrences jsonb)
returns uuid
language plpgsql security invoker set search_path = public as $$
begin
  if p_series is null or p_from is null then raise exception 'Series and start are required'; end if;
  delete from public.appointments where series_id = p_series and starts_at >= p_from and user_id = auth.uid();
  return public.create_appointment_series(series, template, occurrences);
end $$;
revoke all on function public.replace_series_from(uuid, timestamptz, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.replace_series_from(uuid, timestamptz, jsonb, jsonb, jsonb) to authenticated;

-- Tasks made together by one repeat share this id, so "this and the following" can be found. There is no
-- series table for tasks: each task stands alone once made.
alter table public.tasks add column if not exists series_id uuid;
create index if not exists tasks_series_idx on public.tasks (series_id, due_date) where series_id is not null;

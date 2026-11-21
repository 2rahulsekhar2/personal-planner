-- Whether an appointment actually happened: marked by the user afterwards.
-- outcome is null until they decide; outcome_reason is an optional note for "not done".
alter table public.appointments
  add column if not exists outcome text check (outcome in ('done', 'not_done')),
  add column if not exists outcome_reason text;

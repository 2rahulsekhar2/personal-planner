-- Table access for the app's roles, stated outright.
-- Older Supabase projects gave signed-in users access to every new table in `public` by default, and the
-- earlier migrations relied on that. Newer projects do not, and the app then fails with
-- "permission denied for table ...". Row-level security still decides which rows each person gets.
-- Safe to run on a project that already has these: granting twice changes nothing.

grant usage on schema public to authenticated, service_role;

-- A person's own rows: read and write, limited to their rows by the own_* policies in 0001.
grant select, insert, update, delete on
  public.profiles, public.activity_types, public.places, public.appointment_series,
  public.appointments, public.tasks, public.push_subscriptions
to authenticated;

-- Reminders are written by triggers and sent by the server; a person only reads their own.
grant select on public.reminders to authenticated;

-- Functions the app calls as the signed-in user, or that policies run as them.
grant execute on function
  public.my_email(), public.create_appointment_series(jsonb, jsonb, jsonb), public.update_appointments_bulk(jsonb, jsonb)
to authenticated;

-- The server (reminder sender, push subscriptions) uses the service role.
grant all on all tables in schema public to service_role;
grant execute on function public.claim_due_reminders(integer) to service_role;

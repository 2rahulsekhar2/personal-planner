-- Run once in the Supabase SQL editor AFTER deploying the app to Vercel.
-- Replace the two placeholders first. This calls the reminder sender every minute.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'send-due-reminders',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://YOUR-APP.vercel.app/api/cron/reminders',
    headers := jsonb_build_object('Authorization', 'Bearer YOUR_CRON_SECRET', 'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
  $$
);

-- To stop it later:  select cron.unschedule('send-due-reminders');

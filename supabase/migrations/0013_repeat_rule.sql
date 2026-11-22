-- Repeats beyond weekly: daily, every few weeks, monthly, yearly.
-- A series' appointments are stored one by one, as before, so nothing here changes how they behave.
-- This column keeps the rule that made them, as the app wrote it:
--   {"freq": "monthly", "every": 1, "weekdays": [], "monthBy": "weekday", "count": 12}
-- Older series have null here and are weekly on `weekdays`.
alter table public.appointment_series add column if not exists rule jsonb;

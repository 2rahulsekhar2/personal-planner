# Personal Planner

A responsive web app for personal appointments and tasks with browser push reminders.
Built from the v1 product spec: same-activity overlaps are blocked, cross-activity overlaps warn,
tasks never block time, and reminder status is shown honestly per device.

**Stack:** Next.js 15 (App Router, TypeScript) on Vercel · Supabase (Postgres, Auth, pg_cron) · Web Push (VAPID).

## How the important rules are enforced

| Rule | Where |
| --- | --- |
| Same activity type can't overlap (cancelled excluded, back-to-back allowed) | Postgres exclusion constraint `appointment_same_activity_overlap`, so two devices saving at once can't both win. The UI checks first so you see the clashing appointment. |
| Different activity types overlap → warning | UI check before save, with "Save anyway". |
| Recurring series | Occurrences are expanded in your time zone, checked one by one; same-type clashes must be skipped, cross-type clashes can be kept or skipped. The whole series is inserted in one transaction. |
| Private data | Row-level security on every table plus a trigger that rejects references to another user's activity types/places. |
| Reminders follow edits | Database triggers rebuild the pending reminder whenever an appointment's time, status, title or reminder changes, or a task's notify time/state changes. Cancelling stops it. |
| No duplicate sends | A cron job claims due reminders with `FOR UPDATE SKIP LOCKED`; each goes to every device you enabled. |
| No duplicate records on retry | Each form carries a `client_request_id` with a unique constraint. |

## Setup (about 20 minutes)

1. **Supabase.** Create a free project at supabase.com. In *SQL Editor*, run `supabase/migrations/0001_init.sql`.
2. **Sign-in.** In *Authentication → Providers*, email (magic link) is on by default. To add Google, enable the Google provider and paste a Google OAuth client ID/secret (Google Cloud Console → Credentials → OAuth client, redirect URI shown by Supabase). In *Authentication → URL Configuration*, set Site URL to your Vercel URL and add `https://YOUR-APP.vercel.app/auth/callback` (and `http://localhost:3000/auth/callback` for local dev) to Redirect URLs.
3. **Push keys.** Run `npx web-push generate-vapid-keys`.
4. **Vercel.** Import this repo at vercel.com/new and add the variables from `.env.example`. Deploy.
5. **Reminder schedule.** Edit `supabase/cron.sql` with your Vercel URL and `CRON_SECRET`, then run it in the Supabase SQL editor.
6. Open the app, sign in, add an activity type (e.g. Cricket) and a place, then go to *Settings → Enable reminders* and press *Send test notification*.

On iPhone/iPad: open the site in Safari → Share → *Add to Home Screen*, open it from the Home Screen, then enable reminders.

## Local development

```bash
cp .env.example .env.local   # fill in values
npm install
npm run dev
npm test                     # conflict + recurrence unit tests
```

## Not in v1

Shared calendars, Google Calendar sync, travel buffers, natural-language entry, email/SMS reminders, offline editing,
morning summaries and repeated overdue notifications (see spec section 15).

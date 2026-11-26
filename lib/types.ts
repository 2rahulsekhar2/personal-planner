export type AppointmentStatus = "confirmed" | "tentative" | "cancelled";
export type TaskState = "pending" | "completed" | "dismissed";

export interface Profile {
  user_id: string;
  time_zone: string | null;
  default_reminder_minutes: number | null;
  show_cancelled: boolean;
}

export interface ActivityType {
  id: string;
  user_id: string;
  name: string;
  color: string;
  archived_at: string | null;
}

export interface Place {
  id: string;
  user_id: string;
  name: string;
  maps_url: string;
  notes: string | null;
  archived_at: string | null;
}

export interface Appointment {
  id: string;
  user_id: string; // who created it; only they can change it
  circle_id?: string | null; // shared with this circle; absent until 0006_sharing.sql has been run
  // Shared as a block of time only: the circle sees when, and nothing else. Absent until 0009_roles.sql has been run.
  busy_only?: boolean;
  // Someone else's busy-only appointment: just its hours. Built in usePlanner, never a full database row.
  busy?: boolean;
  activity_type_id: string | null; // null when the appointment uses a one-off custom_activity
  place_id: string | null;
  series_id: string | null;
  title: string;
  starts_at: string;
  ends_at: string;
  status: AppointmentStatus;
  team: string | null;
  notes: string | null;
  reminder_minutes: number | null;
  // Further reminders, besides the one above. Absent until supabase/migrations/0023_multi_reminders.sql has been run.
  extra_reminder_minutes?: number[];
  // Set by the user afterwards. Absent until supabase/migrations/0002_appointment_outcome.sql has been run.
  outcome?: "done" | "not_done" | null;
  outcome_reason?: string | null;
  // One-off free text for this appointment only. Absent until supabase/migrations/0003_custom_activity_place.sql has been run.
  custom_activity?: string | null;
  custom_place?: string | null;
  // The other members going, besides the creator. Absent until supabase/migrations/0008_people.sql has been run.
  participants?: { user_id: string; reply?: "going" | "cant" | null }[];
}

export interface Task {
  id: string;
  user_id: string;
  circle_id?: string | null;
  assignee_id?: string | null; // on a shared task: the member it is for; null means anyone in the circle
  completed_by?: string | null;
  series_id?: string | null; // shared by tasks made by one repeat; absent until 0014_series_edit.sql has been run
  title: string;
  due_date: string; // yyyy-MM-dd
  due_time: string | null; // HH:mm[:ss]
  notify_at: string | null;
  extra_notify_at?: string[]; // further reminders; absent until 0023_multi_reminders.sql has been run
  notes: string | null;
  state: TaskState;
  completed_at: string | null;
}

export interface PushSubscriptionRow {
  id: string;
  endpoint: string;
  user_agent: string | null;
  created_at: string;
}

export const ACTIVITY_COLORS: { key: string; label: string }[] = [
  { key: "sage", label: "Sage" },
  { key: "sky", label: "Sky" },
  { key: "rose", label: "Rose" },
  { key: "amber", label: "Amber" },
  { key: "lilac", label: "Lilac" },
  { key: "slate", label: "Slate" },
  { key: "teal", label: "Teal" },
  { key: "clay", label: "Clay" },
];

// A reminder is stored as minutes before the start; null means none. The database allows up to 7 days.
export const MAX_REMINDER_MINUTES = 10080;
export type ReminderUnit = "minutes" | "hours" | "days";
// Each unit: its size in minutes, its names, and the amount offered when it is first picked.
export const REMINDER_UNITS: Record<ReminderUnit, { minutes: number; label: string; one: string; start: number }> = {
  minutes: { minutes: 1, label: "Minutes", one: "minute", start: 15 },
  hours: { minutes: 60, label: "Hours", one: "hour", start: 1 },
  days: { minutes: 1440, label: "Days", one: "day", start: 1 },
};

/** Minutes as the largest unit that divides them exactly: 90 is 90 minutes, 120 is 2 hours, 2880 is 2 days. Null for none or "at start". */
export function reminderParts(minutes: number | null): { amount: number; unit: ReminderUnit } | null {
  if (!minutes || minutes < 0) return null;
  const unit: ReminderUnit = minutes % 1440 === 0 ? "days" : minutes % 60 === 0 ? "hours" : "minutes";
  return { amount: minutes / REMINDER_UNITS[unit].minutes, unit };
}

/** "No reminder", "At start time", "15 minutes before", "1 hour before", "2 days before". */
export function reminderLabel(minutes: number | null): string {
  if (minutes === null) return "No reminder";
  const p = reminderParts(minutes);
  return p ? `${p.amount} ${p.amount === 1 ? REMINDER_UNITS[p.unit].one : p.unit} before` : "At start time";
}

/** "At start", "15 min", "2 h", "1 d": a reminder small enough for a chip. */
export function reminderShort(minutes: number): string {
  const p = reminderParts(minutes);
  return p ? `${p.amount} ${{ minutes: "min", hours: "h", days: "d" }[p.unit]}` : "At start";
}

// One appointment or task holds up to this many reminders. The database allows the same: one, and four more.
export const MAX_REMINDERS = 5;

/** Several reminders as one tidy list: no repeats, smallest first, never more than MAX_REMINDERS. For minutes before the start, or UTC ISO times. */
export function tidyReminders<T extends number | string>(list: (T | null | undefined)[]): T[] {
  const kept = list.filter((x): x is T => x !== null && x !== undefined);
  return [...new Set(kept)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).slice(0, MAX_REMINDERS);
}

/** How the database holds them: the first in the column that was always there, the others in the list beside it. */
export function splitReminders<T>(list: T[]): { first: T | null; rest: T[] } {
  return { first: list.length ? list[0] : null, rest: list.slice(1) };
}

/** How many whole minutes `at` falls before `ref` (both ISO times); 0 when it is at or after it. Turns a task's stored reminder time into "minutes before it is due". */
export function minutesBefore(ref: string, at: string): number {
  return Math.max(0, Math.round((Date.parse(ref) - Date.parse(at)) / 60000));
}

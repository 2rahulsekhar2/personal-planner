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
  name: string;
  color: string;
  archived_at: string | null;
}

export interface Place {
  id: string;
  name: string;
  maps_url: string;
  notes: string | null;
  archived_at: string | null;
}

export interface Appointment {
  id: string;
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
  // Set by the user afterwards. Absent until supabase/migrations/0002_appointment_outcome.sql has been run.
  outcome?: "done" | "not_done" | null;
  outcome_reason?: string | null;
  // One-off free text for this appointment only. Absent until supabase/migrations/0003_custom_activity_place.sql has been run.
  custom_activity?: string | null;
  custom_place?: string | null;
}

export interface Task {
  id: string;
  title: string;
  due_date: string; // yyyy-MM-dd
  due_time: string | null; // HH:mm[:ss]
  notify_at: string | null;
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

export const REMINDER_CHOICES: { value: number | null; label: string }[] = [
  { value: null, label: "No reminder" },
  { value: 0, label: "At start time" },
  { value: 10, label: "10 minutes before" },
  { value: 30, label: "30 minutes before" },
  { value: 60, label: "1 hour before" },
  { value: 120, label: "2 hours before" },
  { value: 1440, label: "1 day before" },
];

import { DateTime } from "luxon";

export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function isValidTimeZone(tz: string): boolean {
  return DateTime.now().setZone(tz).isValid;
}

/** Combine a local date (yyyy-MM-dd) and time (HH:mm) in a zone into a DateTime. */
export function localToDateTime(date: string, time: string, tz: string): DateTime {
  return DateTime.fromISO(`${date}T${time.slice(0, 5)}`, { zone: tz });
}

/**
 * Turn a date plus start/end clock times into a UTC interval. An end time at or
 * before the start time means the appointment ends on the following day.
 */
export function toInterval(date: string, start: string, end: string, tz: string) {
  const s = localToDateTime(date, start, tz);
  let e = localToDateTime(date, end, tz);
  const nextDay = e <= s;
  if (nextDay) e = localToDateTime(s.plus({ days: 1 }).toISODate()!, end, tz);
  return { start: s, end: e, nextDay, valid: s.isValid && e.isValid };
}

export function fmtTime(iso: string | DateTime, tz: string): string {
  const d = typeof iso === "string" ? DateTime.fromISO(iso, { zone: "utc" }) : iso;
  return d.setZone(tz).toFormat("h:mm a");
}

export function fmtShortTime(iso: string | DateTime, tz: string): string {
  const d = (typeof iso === "string" ? DateTime.fromISO(iso, { zone: "utc" }) : iso).setZone(tz);
  return d.minute === 0 ? d.toFormat("h a") : d.toFormat("h:mm a");
}

export function fmtRange(startIso: string, endIso: string, tz: string): string {
  const s = DateTime.fromISO(startIso, { zone: "utc" }).setZone(tz);
  const e = DateTime.fromISO(endIso, { zone: "utc" }).setZone(tz);
  const sameDay = s.hasSame(e, "day");
  return `${fmtShortTime(s, tz)} – ${fmtShortTime(e, tz)}${sameDay ? "" : " (next day)"}`;
}

export function fmtDateLong(date: string | DateTime, tz: string): string {
  const d = typeof date === "string" ? DateTime.fromISO(date, { zone: tz }) : date.setZone(tz);
  return d.toFormat("cccc, d LLLL");
}

export function todayISO(tz: string): string {
  return DateTime.now().setZone(tz).toISODate()!;
}

export function startOfWeek(date: string, tz: string): DateTime {
  return DateTime.fromISO(date, { zone: tz }).startOf("week"); // ISO weeks start Monday
}

export function relativeDayLabel(date: string, tz: string): string {
  const today = DateTime.now().setZone(tz).startOf("day");
  const d = DateTime.fromISO(date, { zone: tz }).startOf("day");
  const diff = Math.round(d.diff(today, "days").days);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff > 1 && diff < 7) return d.toFormat("cccc");
  return d.toFormat("ccc d LLL");
}

/** A task is overdue when it is pending and its due moment has passed. */
export function isTaskOverdue(
  task: { state: string; due_date: string; due_time: string | null },
  tz: string,
  now: DateTime = DateTime.now(),
): boolean {
  if (task.state !== "pending") return false;
  const due = task.due_time
    ? localToDateTime(task.due_date, task.due_time, tz)
    : DateTime.fromISO(task.due_date, { zone: tz }).endOf("day");
  return due < now;
}

export function hhmm(t: string | null | undefined): string {
  return t ? t.slice(0, 5) : "";
}

export function fmtClock(t: string): string {
  return DateTime.fromFormat(t.slice(0, 5), "HH:mm").toFormat("h:mm a");
}

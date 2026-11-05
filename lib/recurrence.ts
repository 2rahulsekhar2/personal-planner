import { DateTime } from "luxon";
import { toInterval } from "./time";

export interface WeeklyRule {
  startDate: string; // first possible date, yyyy-MM-dd
  endDate: string; // last possible date, inclusive
  weekdays: number[]; // ISO weekday numbers, 1 = Monday
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  timeZone: string;
}

export interface Occurrence {
  date: string;
  starts_at: string;
  ends_at: string;
}

export const MAX_OCCURRENCES = 200;

/**
 * Expand a weekly rule into concrete occurrences. Each occurrence is computed in
 * the user's time zone, so 6 AM stays 6 AM across daylight-saving changes.
 */
export function expandWeekly(rule: WeeklyRule): Occurrence[] {
  const out: Occurrence[] = [];
  if (!rule.weekdays.length) return out;
  let d = DateTime.fromISO(rule.startDate, { zone: rule.timeZone });
  const end = DateTime.fromISO(rule.endDate, { zone: rule.timeZone });
  if (!d.isValid || !end.isValid) return out;
  while (d <= end && out.length < MAX_OCCURRENCES) {
    if (rule.weekdays.includes(d.weekday)) {
      const date = d.toISODate()!;
      const iv = toInterval(date, rule.startTime, rule.endTime, rule.timeZone);
      out.push({ date, starts_at: iv.start.toUTC().toISO()!, ends_at: iv.end.toUTC().toISO()! });
    }
    d = d.plus({ days: 1 });
  }
  return out;
}

export const WEEKDAY_LABELS = [
  { n: 1, short: "Mon", long: "Monday" },
  { n: 2, short: "Tue", long: "Tuesday" },
  { n: 3, short: "Wed", long: "Wednesday" },
  { n: 4, short: "Thu", long: "Thursday" },
  { n: 5, short: "Fri", long: "Friday" },
  { n: 6, short: "Sat", long: "Saturday" },
  { n: 7, short: "Sun", long: "Sunday" },
];

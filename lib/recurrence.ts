import { DateTime } from "luxon";
import { toInterval } from "./time";

export type Freq = "daily" | "weekly" | "monthly" | "yearly";
/** Monthly and yearly: the same date ("the 24th"), the same weekday ("the 4th Tuesday"), or the last such weekday. */
export type MonthBy = "date" | "weekday" | "last";

export interface RepeatRule {
  freq: Freq;
  every: number; // every N days, weeks, months or years
  weekdays: number[]; // weekly only: ISO weekday numbers, 1 = Monday
  monthBy: MonthBy; // monthly and yearly only
  startDate: string; // first possible date, yyyy-MM-dd
  endDate?: string; // last possible date, inclusive; or
  count?: number; // stop after this many. One of the two is needed: a series never runs open-ended.
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

// The day in month `m` that matches the start date's pattern, or null when that month has none
// (no 31st, no 29 February, no 5th Tuesday). Such months are skipped, not moved to another day.
function dayIn(m: DateTime, start: DateTime, by: MonthBy): DateTime | null {
  if (by === "date") return start.day <= m.daysInMonth! ? m.set({ day: start.day }) : null;
  if (by === "last") {
    const last = m.endOf("month").startOf("day");
    return last.minus({ days: (last.weekday - start.weekday + 7) % 7 });
  }
  const d = m.plus({ days: (start.weekday - m.weekday + 7) % 7, weeks: Math.ceil(start.day / 7) - 1 });
  return d.month === m.month ? d : null;
}

// Candidate dates in order, from the start date on. The caller stops at the end date or count.
function* candidates(rule: RepeatRule, start: DateTime, end: DateTime | null): Generator<DateTime> {
  const every = Math.max(1, Math.floor(rule.every) || 1);
  const days = [...new Set(rule.weekdays)].sort();
  // 4000 steps is far past what 200 occurrences can need; it only bounds a rule that matches nothing.
  for (let k = 0; k < 4000; k++) {
    if (rule.freq === "daily") yield start.plus({ days: k * every });
    else if (rule.freq === "weekly") {
      const week = start.startOf("week").plus({ weeks: k * every });
      if (!days.length || (end && week > end)) return;
      for (const wd of days) {
        const d = week.plus({ days: wd - 1 });
        if (d >= start) yield d;
      }
    } else {
      const m = start.startOf("month").plus({ months: k * every * (rule.freq === "yearly" ? 12 : 1) });
      if (end && m > end) return;
      const d = dayIn(m, start, rule.monthBy);
      if (d) yield d;
    }
  }
}

/**
 * Expand a repeat rule into concrete occurrences. Each occurrence is computed in
 * the user's time zone, so 6 AM stays 6 AM across daylight-saving changes.
 */
export function expandRule(rule: RepeatRule): Occurrence[] {
  const out: Occurrence[] = [];
  const start = DateTime.fromISO(rule.startDate, { zone: rule.timeZone });
  const end = rule.endDate ? DateTime.fromISO(rule.endDate, { zone: rule.timeZone }) : null;
  if (!start.isValid || (end ? !end.isValid : !rule.count)) return out;
  const max = Math.min(MAX_OCCURRENCES, rule.count && rule.count > 0 ? Math.floor(rule.count) : MAX_OCCURRENCES);
  for (const d of candidates(rule, start, end)) {
    if ((end && d > end) || out.length >= max) break;
    const date = d.toISODate()!;
    const iv = toInterval(date, rule.startTime, rule.endTime, rule.timeZone);
    out.push({ date, starts_at: iv.start.toUTC().toISO()!, ends_at: iv.end.toUTC().toISO()! });
  }
  return out;
}

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;

/** The choices for "which day of the month", worded for the start date: "On the 24th", "On the 4th Tuesday", "On the last Tuesday". */
export function monthByChoices(startDate: string): { by: MonthBy; label: string }[] {
  const d = DateTime.fromISO(startDate);
  if (!d.isValid) return [];
  const nth = Math.ceil(d.day / 7);
  return [
    { by: "date", label: `On the ${ordinal(d.day)}` },
    // A 5th Tuesday exists in few months, so it is offered only as "the last".
    ...(nth <= 4 ? [{ by: "weekday" as const, label: `On the ${ordinal(nth)} ${d.weekdayLong}` }] : []),
    ...(d.day + 7 > d.daysInMonth! ? [{ by: "last" as const, label: `On the last ${d.weekdayLong}` }] : []),
  ];
}

/** The rule as a sentence: "Every 2 weeks on Mon and Wed", "Every year on the 4th Tuesday of November". */
export function describeRule(rule: Pick<RepeatRule, "freq" | "every" | "weekdays" | "monthBy" | "startDate">): string {
  const n = Math.max(1, Math.floor(rule.every) || 1);
  const unit = { daily: "day", weekly: "week", monthly: "month", yearly: "year" }[rule.freq];
  const head = n === 1 ? `Every ${unit}` : `Every ${n} ${unit}s`;
  if (rule.freq === "daily") return head;
  if (rule.freq === "weekly") {
    const days = [...new Set(rule.weekdays)].sort();
    if (n === 1 && days.join() === "1,2,3,4,5") return "Every weekday, Monday to Friday";
    if (n === 1 && days.length === 7) return "Every day";
    const names = days.map((w) => WEEKDAY_LABELS[w - 1].short);
    return `${head} on ${names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0] ?? "no day"}`;
  }
  const d = DateTime.fromISO(rule.startDate);
  const which = monthByChoices(rule.startDate).find((c) => c.by === rule.monthBy)?.label.replace(/^On /, "on ") ?? "";
  if (rule.freq === "monthly") return `${head} ${which}`;
  return rule.monthBy === "date" ? `${head} on ${d.toFormat("d LLLL")}` : `${head} ${which} of ${d.monthLong}`;
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

/** What the Repeat picker holds: how often ("" is never), every how many, on which days, and how it ends. */
export interface RepeatChoice {
  freq: Freq | "";
  every: number;
  weekdays: number[];
  monthBy: MonthBy;
  ends: "on" | "after";
  until: string; // yyyy-MM-dd, when ends is "on"
  count: number; // when ends is "after"
}
export const NO_REPEAT: RepeatChoice = { freq: "", every: 1, weekdays: [], monthBy: "date", ends: "on", until: "", count: 10 };

// "On the 4th Tuesday" only exists for some dates; a choice that no longer fits the date falls back to the date itself.
const monthByFor = (c: RepeatChoice, date: string): MonthBy => (monthByChoices(date).some((m) => m.by === c.monthBy) ? c.monthBy : "date");

/** The picker's choice as a rule that can be expanded, starting on `date`. */
export function toRule(c: RepeatChoice, date: string, startTime: string, endTime: string, timeZone: string): RepeatRule {
  return {
    freq: c.freq || "weekly", every: c.every, weekdays: c.weekdays, monthBy: monthByFor(c, date), startDate: date, startTime, endTime, timeZone,
    ...(c.ends === "on" ? { endDate: c.until } : { count: c.count }),
  };
}

/** The choice as it is kept with a series (appointment_series.rule). */
export function storedRule(c: RepeatChoice, date: string) {
  return { freq: c.freq, every: c.every, weekdays: c.freq === "weekly" ? c.weekdays : [], monthBy: monthByFor(c, date), ...(c.ends === "on" ? { until: c.until } : { count: c.count }) };
}

/**
 * A stored series back into a choice, for editing. It always ends "on a date", the series' last date: a count
 * would mean something different part-way through. A series from before rules were stored is weekly on its weekdays.
 */
export function choiceFromSeries(s: { rule?: unknown; weekdays?: number[] | null; end_date: string }): RepeatChoice {
  const r = (s.rule ?? {}) as Partial<RepeatChoice>;
  const freq = (["daily", "weekly", "monthly", "yearly"] as const).find((f) => f === r.freq) ?? "weekly";
  return {
    freq,
    every: Math.max(1, Math.floor(Number(r.every)) || 1),
    weekdays: (Array.isArray(r.weekdays) && r.weekdays.length ? r.weekdays : s.weekdays ?? []).map(Number),
    monthBy: (["date", "weekday", "last"] as const).find((b) => b === r.monthBy) ?? "date",
    ends: "on", until: s.end_date, count: 10,
  };
}

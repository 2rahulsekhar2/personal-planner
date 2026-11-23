import { DateTime } from "luxon";

export type MoneyKind = "income" | "expense";
export type MoneyFreq = "once" | "daily" | "weekly" | "monthly" | "yearly";

export interface Bank { id: string; name: string; balance: number; balance_at: string | null; archived_at: string | null }
export interface MoneyType { id: string; name: string; kind: MoneyKind; archived_at: string | null }
export interface Increase { id: string; name: string; percent: number; archived_at: string | null }
export interface Person { id: string; name: string; relationship: string; archived_at: string | null }

export interface MoneyItem {
  id: string;
  kind: MoneyKind;
  name: string;
  amount: number; // the budget for one occurrence
  freq: MoneyFreq;
  start_date: string; // yyyy-MM-dd; the date itself when freq is "once"
  end_date: string | null;
  bank_id: string | null;
  type_id: string | null;
  increase_id: string | null;
  person_ids: string[];
  notes: string | null;
}

/** One month of one item, stored only when that month was changed, skipped or paid. `month` is yyyy-MM-01. */
export interface MoneyEntry {
  item_id: string;
  month: string;
  budget: number | null;
  actual: number | null;
  paid_at: string | null;
  skipped: boolean;
}

export const FREQ_LABELS: Record<MoneyFreq, string> = { once: "One time", daily: "Every day", weekly: "Every week", monthly: "Every month", yearly: "Every year" };
export const RELATIONSHIPS = ["Self", "Spouse", "Son", "Daughter", "Father", "Mother", "Brother", "Sister"];

const day = (iso: string) => DateTime.fromISO(iso, { zone: "utc" });
const round2 = (n: number) => Math.round(n * 100) / 100;

/** "2026-11" moved by a number of months. */
export const shiftMonth = (ym: string, by: number) => day(`${ym}-01`).plus({ months: by }).toFormat("yyyy-MM");
/** "November 2026". */
export const monthLabel = (ym: string) => day(`${ym}-01`).toFormat("LLLL yyyy");

/**
 * The dates an item falls due inside a month ("yyyy-MM"). A bill on the 31st, or on 29 February,
 * moves to the last day of a shorter month: it is still owed that month.
 */
export function datesInMonth(item: Pick<MoneyItem, "freq" | "start_date" | "end_date">, ym: string): string[] {
  const first = day(`${ym}-01`);
  const start = day(item.start_date);
  if (!first.isValid || !start.isValid) return [];
  const last = first.endOf("month").startOf("day");
  const lo = start > first ? start : first;
  const end = item.end_date ? day(item.end_date) : last;
  const hi = end < last ? end : last;
  if (lo > hi) return [];
  const within = (d: DateTime) => (d >= lo && d <= hi ? [d.toISODate()!] : []);
  if (item.freq === "once") return within(start);
  if (item.freq === "monthly" || (item.freq === "yearly" && first.month === start.month)) return within(first.set({ day: Math.min(start.day, first.daysInMonth!) }));
  if (item.freq === "yearly") return [];
  const out: string[] = [];
  const step = item.freq === "weekly" ? 7 : 1;
  for (let d = lo.plus({ days: item.freq === "weekly" ? (start.weekday - lo.weekday + 7) % 7 : 0 }); d <= hi; d = d.plus({ days: step })) out.push(d.toISODate()!);
  return out;
}

/** One occurrence's budget on a date: the item's amount, raised by `percent` once for each full year since it started. */
export function amountOn(item: Pick<MoneyItem, "amount" | "start_date">, date: string, percent: number): number {
  const years = Math.max(0, Math.floor(day(date).diff(day(item.start_date), "years").years));
  return round2(item.amount * (1 + percent / 100) ** years);
}

/** An item in one month: what the rule says, and what was changed or recorded for that month. */
export interface Line {
  item: MoneyItem;
  dates: string[];
  rule: number; // the month's budget by the rule alone
  budget: number; // the month's budget in force: the month's own figure when one was set
  actual: number | null;
  paid: boolean;
  skipped: boolean;
}

/** Every item that falls due in the month, earliest first. Skipped lines are included, so they can be put back. */
export function monthLines(items: MoneyItem[], entries: MoneyEntry[], increases: Increase[], ym: string): Line[] {
  const pct = new Map(increases.map((i) => [i.id, Number(i.percent)]));
  const byItem = new Map(entries.filter((e) => e.month.slice(0, 7) === ym).map((e) => [e.item_id, e]));
  return items
    .map((item): Line | null => {
      const dates = datesInMonth(item, ym);
      if (!dates.length) return null;
      const percent = (item.freq !== "once" && item.increase_id && pct.get(item.increase_id)) || 0;
      const rule = round2(dates.reduce((sum, d) => sum + amountOn(item, d, percent), 0));
      const e = byItem.get(item.id);
      return { item, dates, rule, budget: e?.budget != null ? Number(e.budget) : rule, actual: e?.actual != null ? Number(e.actual) : null, paid: !!e?.paid_at, skipped: !!e?.skipped };
    })
    .filter((l): l is Line => !!l)
    .sort((a, b) => a.dates[0].localeCompare(b.dates[0]) || a.item.name.localeCompare(b.item.name));
}

/** What a line is expected to come to: the actual amount once known, the budget until then. */
export const expected = (l: Line) => l.actual ?? l.budget;
/** What has really moved: the actual amount, or the budget for a line marked paid without one. Nothing until then. */
export const settled = (l: Line) => l.actual ?? (l.paid ? l.budget : 0);

export interface Totals { budget: number; actual: number; due: number }
/** A kind's month: budgeted, really paid or received so far, and still to come. Skipped lines count for nothing. */
export function totals(lines: Line[], kind: MoneyKind): Totals {
  const live = lines.filter((l) => l.item.kind === kind && !l.skipped);
  const sum = (f: (l: Line) => number) => round2(live.reduce((s, l) => s + f(l), 0));
  return { budget: sum((l) => l.budget), actual: sum(settled), due: sum((l) => (l.paid ? 0 : expected(l))) };
}

/** A bank's month: today's balance, plus income still to arrive, minus expenses still to pay. Below zero is a shortfall. */
export function bankPosition(bank: Pick<Bank, "id" | "balance">, lines: Line[]) {
  const mine = lines.filter((l) => l.item.bank_id === bank.id);
  const incomeDue = totals(mine, "income").due;
  const expenseDue = totals(mine, "expense").due;
  return { incomeDue, expenseDue, after: round2(Number(bank.balance) + incomeDue - expenseDue) };
}

const whole = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const paise = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2 });
/** Rupees, grouped the Indian way: ₹1,25,000. Paise show only when there are some. */
export const inr = (n: number) => (Number.isInteger(n) ? whole : paise).format(n);

/** A typed amount as a number, or null when it is not a usable amount. Commas and the rupee sign are allowed. */
export function parseAmount(text: string): number | null {
  const n = Number(text.replace(/[₹,\s]/g, ""));
  return text.trim() && Number.isFinite(n) && n >= 0 && n < 1e12 ? round2(n) : null;
}

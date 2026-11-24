import { DateTime } from "luxon";

export type MoneyKind = "income" | "expense";
export type MoneyFreq = "once" | "daily" | "weekly" | "monthly" | "yearly";

// circle_id on every row: null is private, otherwise the circle it is shared with. Absent until 0017_money_shared.sql has been run.
export interface Bank { id: string; user_id?: string; circle_id?: string | null; name: string; balance: number; balance_at: string | null; archived_at: string | null }
export interface MoneyType { id: string; circle_id?: string | null; name: string; kind: MoneyKind; archived_at: string | null }
export interface Increase { id: string; circle_id?: string | null; name: string; percent: number; archived_at: string | null }
/** member_id: this person is also that member of the circle. */
export interface Person { id: string; circle_id?: string | null; member_id?: string | null; name: string; relationship: string; archived_at: string | null }

export interface MoneyItem {
  id: string;
  circle_id?: string | null;
  kind: MoneyKind;
  name: string;
  amount: number; // the budget for one occurrence, from the first date on
  // Later changes of that amount, each from a date on. Absent until 0020_money_amount_steps.sql has been run.
  amount_steps?: AmountStep[] | null;
  freq: MoneyFreq;
  start_date: string; // yyyy-MM-dd; the date itself when freq is "once"
  end_date: string | null;
  bank_id: string | null;
  type_id: string | null;
  increase_id: string | null;
  person_ids: string[];
  notes: string | null;
}

/** A change of an item's amount from a date on. It holds until the next change, or the item's last date. */
export interface AmountStep {
  from: string; // yyyy-MM-dd
  amount: number;
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

/** A request to add, change or delete a shared item. It takes effect once everyone it is waiting on has approved. */
export interface Proposal {
  id: string;
  circle_id: string;
  item_id: string | null; // null: a new item
  action: "add" | "change" | "delete";
  payload: Partial<MoneyItem>; // the item as asked for; empty for a delete
  created_by: string;
  status: "pending" | "approved" | "rejected" | "withdrawn";
  reason: string | null; // why it was rejected
}

/** Who still has to approve: the circle's current owners and members, apart from whoever asked and whoever already has. */
export function waitingOn(p: Pick<Proposal, "id" | "created_by">, members: { user_id: string; role: string; expires_at?: string | null }[], approvals: { proposal_id: string; user_id: string }[], now = Date.now()): string[] {
  const done = new Set(approvals.filter((a) => a.proposal_id === p.id).map((a) => a.user_id));
  return members
    .filter((m) => m.role !== "viewer" && (!m.expires_at || Date.parse(m.expires_at) > now) && m.user_id !== p.created_by && !done.has(m.user_id))
    .map((m) => m.user_id);
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

type Priced = Pick<MoneyItem, "amount" | "start_date"> & { amount_steps?: AmountStep[] | null };

/** The amount in force on a date, and the day it took effect: the item's own amount, or the latest change dated on or before then. */
export function amountIn(item: Priced, date: string): { amount: number; since: string } {
  let now = { amount: Number(item.amount), since: item.start_date };
  for (const s of item.amount_steps ?? []) if (s.from <= date && s.from > now.since) now = { amount: Number(s.amount), since: s.from };
  return now;
}

/**
 * One occurrence's budget on a date: the amount in force then, raised by `percent` once for each full year since
 * that amount took effect. A change of amount starts the count again: the new figure is taken as already up to date.
 */
export function amountOn(item: Priced, date: string, percent: number): number {
  const { amount, since } = amountIn(item, date);
  const years = Math.max(0, Math.floor(day(date).diff(day(since), "years").years));
  return round2(amount * (1 + percent / 100) ** years);
}

/** An item's amounts as stretches of time, earliest first: each runs to the day before the next, the last to the item's end (null: no end). */
export function amountPeriods(item: Priced & Pick<MoneyItem, "end_date">): { from: string; to: string | null; amount: number }[] {
  const steps = [...(item.amount_steps ?? [])].filter((s) => s.from > item.start_date).sort((a, b) => a.from.localeCompare(b.from));
  const all = [{ from: item.start_date, amount: Number(item.amount) }, ...steps.map((s) => ({ from: s.from, amount: Number(s.amount) }))];
  return all.map((p, n) => ({ ...p, to: all[n + 1] ? day(all[n + 1].from).minus({ days: 1 }).toISODate()! : item.end_date }));
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

/** What falls due on one day: lines with a single date in the month. A daily or weekly item is a month's running total, not a bill for a day. */
export const linesDueOn = (lines: Line[], date: string) => lines.filter((l) => !l.skipped && l.dates.length === 1 && l.dates[0] === date);

export interface Share { id: string | null; amount: number }
/** A month's spending for each person: a line's amount splits equally between the people it is for. `id` null gathers lines for nobody in particular. Largest first. */
export function byPerson(lines: Line[], kind: MoneyKind = "expense"): Share[] {
  const sums = new Map<string | null, number>();
  for (const l of lines) {
    if (l.item.kind !== kind || l.skipped) continue;
    const who: (string | null)[] = l.item.person_ids.length ? l.item.person_ids : [null];
    for (const id of who) sums.set(id, (sums.get(id) ?? 0) + expected(l) / who.length);
  }
  return [...sums].map(([id, amount]) => ({ id, amount: round2(amount) })).sort((a, b) => b.amount - a.amount);
}

export interface TypeSum extends Totals { id: string | null }
/** A month for each type: budgeted, really paid so far, and still to come. `id` null gathers lines without a type. Largest budget first. */
export function byType(lines: Line[], kind: MoneyKind = "expense"): TypeSum[] {
  const ids = [...new Set(lines.filter((l) => l.item.kind === kind && !l.skipped).map((l) => l.item.type_id))];
  return ids.map((id) => ({ id, ...totals(lines.filter((l) => l.item.type_id === id), kind) })).sort((a, b) => b.budget - a.budget);
}

/** The months ahead by the plan: each month's budgeted income and expenses, yearly increases and one-month changes included. */
export function forecast(items: MoneyItem[], entries: MoneyEntry[], increases: Increase[], fromYm: string, months = 12) {
  return Array.from({ length: months }, (_, n) => {
    const ym = shiftMonth(fromYm, n);
    const lines = monthLines(items, entries, increases, ym);
    const income = totals(lines, "income").budget;
    const expense = totals(lines, "expense").budget;
    return { ym, income, expense, left: round2(income - expense) };
  });
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

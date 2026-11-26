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
  // Set when the item is a loan: `amount` is then the EMI, paid every month. Absent until 0021_money_loans.sql has been run.
  loan?: Loan | null;
  // Set when the item is computed from other items; `amount` is then unused. Absent until 0022_money_computed.sql has been run.
  formula?: FormulaToken[] | null;
  freq: MoneyFreq;
  start_date: string; // yyyy-MM-dd; the date itself when freq is "once"
  end_date: string | null;
  bank_id: string | null;
  type_id: string | null;
  increase_id: string | null;
  person_ids: string[];
  notes: string | null;
  // Its place in its list, set by moving it by hand. Absent until 0024_money_item_order.sql has been run.
  sort_order?: number | null;
}

/** Lines in the order set by hand: placed ones first, lowest place first; the rest after them, kept as they came. */
export function byPlace<T extends { item: { sort_order?: number | null } }>(lines: T[]): T[] {
  const at = (l: T) => l.item.sort_order ?? Infinity;
  return lines.map((l, i) => [l, i] as const).sort((a, b) => (at(a[0]) === at(b[0]) ? a[1] - b[1] : at(a[0]) - at(b[0]))).map(([l]) => l);
}

/** `ids` with `id` taken out and put back at place `to` (0 is first; past the end is last). */
export function movedTo(ids: string[], id: string, to: number): string[] {
  const rest = ids.filter((x) => x !== id);
  rest.splice(Math.max(0, Math.min(rest.length, to)), 0, id);
  return rest;
}

/** A change of an item's amount from a date on. It holds until the next change, or the item's last date. */
export interface AmountStep {
  from: string; // yyyy-MM-dd
  amount: number;
}

/** One piece of a formula: another item's month, a number, a percentage (10% is 0.1), or an operator or bracket. */
export type FormulaToken = { t: "item"; id: string } | { t: "num"; v: number } | { t: "pct"; v: number } | { t: "op"; v: "+" | "-" | "*" | "/" | "(" | ")" };

/** What was borrowed. The item it sits on is the monthly payment. */
export interface Loan {
  principal: number; // the amount taken
  rate: number; // percent a year
  kind: "reducing" | "flat"; // interest on what is still owed, or on the amount taken every month
  months: number; // the tenure the EMI is worked out for
  // Optional: what the lender says was owed on a date. The sums carry on from there.
  balance?: number | null;
  balance_on?: string | null;
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

/** The usual EMI for a loan, to the next whole rupee. Flat: an equal share of the amount taken, plus a month's interest on all of it. */
export function loanEmi(loan: Pick<Loan, "principal" | "rate" | "kind" | "months">): number {
  const { principal: p, months: n } = loan;
  const r = loan.rate / 1200;
  if (!(p > 0) || !(n > 0)) return 0;
  if (loan.kind === "flat" || r === 0) return Math.ceil(p / n + p * r);
  const grow = (1 + r) ** n;
  return Math.ceil((p * r * grow) / (grow - 1));
}

export interface LoanRow { date: string; pay: number; interest: number; balance: number } // balance: still owed after this payment
type Lent = Priced & { loan?: Loan | null };
const LOAN_MAX = 1200; // months: a loan whose EMI never covers its interest stops being worked out here

/**
 * A loan's payments month by month, by the calendar: each EMI (with its yearly increase and dated changes) first pays
 * the month's interest, and the rest comes off what is owed. The last payment is whatever remains, and then it stops.
 * Where the lender's own balance on a date is given, what is owed is reset to it from the next payment on.
 * `untilYm` stops the working early, for when only the months up to one are wanted.
 */
export function loanSchedule(item: Lent, percent = 0, untilYm?: string): LoanRow[] {
  const loan = item.loan;
  if (!loan) return [];
  const fix = loan.balance != null && loan.balance_on ? { on: loan.balance_on, balance: Number(loan.balance) } : null;
  const rows: LoanRow[] = [];
  let balance = Number(loan.principal);
  let fixed = !fix;
  for (let n = 0; n < LOAN_MAX; n++) {
    const ym = shiftMonth(item.start_date.slice(0, 7), n);
    if (untilYm && ym > untilYm) break;
    const [date] = datesInMonth({ freq: "monthly", start_date: item.start_date, end_date: null }, ym);
    if (!date) break;
    if (fix && !fixed && date > fix.on) { balance = fix.balance; fixed = true; }
    if (fixed && balance <= 0) break; // before the lender's figure applies, payments carry on whatever these sums say
    const interest = round2(((loan.kind === "flat" ? Number(loan.principal) : balance) * Number(loan.rate)) / 1200);
    const pay = fixed ? Math.min(amountOn(item, date, percent), round2(balance + interest)) : amountOn(item, date, percent);
    balance = Math.max(0, round2(balance + interest - pay));
    rows.push({ date, pay, interest: Math.min(interest, pay), balance });
  }
  return rows;
}

/** Where a loan stands on a day: what is still owed, payments left, the last payment's date, and all the interest it costs. */
export function loanNow(item: Lent, percent: number, today: string) {
  const rows = loanSchedule(item, percent);
  const loan = item.loan!;
  const done = rows.filter((r) => r.date <= today);
  let balance = done.length ? done[done.length - 1].balance : Number(loan.principal);
  // The lender's figure is the latest word when no payment has fallen due since.
  if (loan.balance != null && loan.balance_on && loan.balance_on <= today && loan.balance_on >= (done[done.length - 1]?.date ?? "")) balance = Number(loan.balance);
  return {
    balance, left: rows.length - done.length, ends: rows.length ? rows[rows.length - 1].date : null,
    interest: round2(rows.reduce((s, r) => s + r.interest, 0)), paid: round2(rows.reduce((s, r) => s + r.pay, 0)),
    endless: rows.length === LOAN_MAX, // the EMI does not cover the interest
  };
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
  // A computed item only: the lines of the items its formula uses that fall in this month.
  parts?: Line[];
  derived?: boolean; // `actual` was worked out from the parts, not typed for this item
  warn?: string; // why the formula comes to ₹0
}

/**
 * Works a formula out, with `valueOf` giving each item's worth. The usual order: brackets, then × and ÷, then + and −.
 * `error`: "syntax" when the pieces do not make a sum, "zero" when it divides by nothing.
 */
export function evalFormula(tokens: FormulaToken[], valueOf: (id: string) => number): { value: number; error?: "syntax" | "zero" } {
  let at = 0;
  let zero = false;
  const op = (v: string) => { const t = tokens[at]; return t?.t === "op" && t.v === v; };
  const factor = (): number => {
    const t = tokens[at++];
    if (!t) throw 0;
    if (t.t === "num") return Number(t.v);
    if (t.t === "pct") return Number(t.v) / 100;
    if (t.t === "item") return valueOf(t.id);
    if (t.v === "-") return -factor();
    if (t.v !== "(") throw 0;
    const inner = sum();
    if (!op(")")) throw 0;
    at++;
    return inner;
  };
  const product = (): number => {
    let n = factor();
    while (op("*") || op("/")) {
      const divide = op("/");
      at++;
      const by = factor();
      if (divide && by === 0) zero = true;
      n = divide ? (by === 0 ? 0 : n / by) : n * by;
    }
    return n;
  };
  const sum = (): number => {
    let n = product();
    while (op("+") || op("-")) {
      const minus = op("-");
      at++;
      n = minus ? n - product() : n + product();
    }
    return n;
  };
  try {
    const value = sum();
    if (at !== tokens.length || !Number.isFinite(value)) return { value: 0, error: "syntax" };
    return zero ? { value: 0, error: "zero" } : { value: round2(value) };
  } catch {
    return { value: 0, error: "syntax" };
  }
}

/** The ids of the items a formula uses. */
export const formulaItems = (tokens: FormulaToken[] | null | undefined) => (tokens ?? []).flatMap((t) => (t.t === "item" ? [t.id] : []));
type Twin = Pick<MoneyItem, "id" | "kind" | "name" | "freq" | "type_id" | "bank_id" | "formula"> & { circle_id?: string | null };
/**
 * One-time items of one name, type and bank are one thing said month by month: an import leaves a row that is
 * filled in only now and then as an item for each of its months. This is what they share; null for any other item.
 */
const twinKey = (i: Twin) => (i.freq === "once" && !i.formula ? `${i.kind}|${i.circle_id ?? ""}|${i.name.trim().toLowerCase()}|${i.type_id}|${i.bank_id}` : null);
/** Each such item's key, with every item that has it. */
function twinsOf<T extends Twin>(items: T[]): Map<string, T[]> {
  const by = new Map<string, T[]>();
  for (const i of items) { const k = twinKey(i); if (k) by.set(k, [...(by.get(k) ?? []), i]); }
  return by;
}
/**
 * The ids of every item used in some other item's formula: parts, which are not lines of their own.
 * A one-time item used there takes its twins with it, since the formula reads whichever of them the month has.
 */
export function partIds(items: Twin[]): Set<string> {
  const used = new Set(items.flatMap((i) => formulaItems(i.formula)));
  const twins = twinsOf(items);
  for (const i of items) if (used.has(i.id)) for (const t of twins.get(twinKey(i) ?? "") ?? []) used.add(t.id);
  return used;
}
/** True when `id`'s formula would, through the items it uses, come back to `id`. */
export function formulaLoops(id: string, tokens: FormulaToken[], items: Pick<MoneyItem, "id" | "formula">[]): boolean {
  const byId = new Map(items.map((i) => [i.id, i]));
  const seen = new Set<string>();
  const reach = (ids: string[]): boolean => ids.some((x) => x === id || (!seen.has(x) && (seen.add(x), reach(formulaItems(byId.get(x)?.formula)))));
  return reach(formulaItems(tokens));
}
/** A line with the lines under it, and those under them. */
export const withParts = (lines: Line[]): Line[] => lines.flatMap((l) => [l, ...withParts(l.parts ?? [])]);

/**
 * Every line of the month, earliest first. Skipped lines are included, so they can be put back.
 * An item used in another item's formula is not a line here: it sits under that item, in `parts`, and counts only through it.
 */
export function monthLines(items: MoneyItem[], entries: MoneyEntry[], increases: Increase[], ym: string): Line[] {
  const pct = new Map(increases.map((i) => [i.id, Number(i.percent)]));
  const byItem = new Map(entries.filter((e) => e.month.slice(0, 7) === ym).map((e) => [e.item_id, e]));
  const byId = new Map(items.map((i) => [i.id, i]));
  const made = new Map<string, Line | null>();
  const twins = twinsOf(items);
  // What a formula means by an item, this month: the item itself, or for a one-time item its twin that falls in the month.
  const meant = (id: string) => {
    const it = byId.get(id);
    return it && ((twins.get(twinKey(it) ?? "") ?? []).find((t) => datesInMonth(t, ym).length > 0) ?? it);
  };
  // An item's line this month, or null when it is not due. `above`: the computed items being worked out, to catch a loop.
  const lineOf = (item: MoneyItem, above: string[]): Line | null => {
    if (made.has(item.id)) return made.get(item.id)!;
    const percent = (item.freq !== "once" && item.increase_id && pct.get(item.increase_id)) || 0;
    // A loan is due while something is owed, and its last payment is what remains.
    const due = item.loan && !item.formula ? loanSchedule(item, percent, ym).find((r) => r.date.slice(0, 7) === ym) : null;
    const dates = item.loan && !item.formula ? (due ? [due.date] : []) : datesInMonth(item, ym);
    const e = byItem.get(item.id);
    let line: Line | null = null;
    if (dates.length && !item.formula) {
      const rule = due ? due.pay : round2(dates.reduce((sum, d) => sum + amountOn(item, d, percent), 0));
      line = { item, dates, rule, budget: e?.budget != null ? Number(e.budget) : rule, actual: e?.actual != null ? Number(e.actual) : null, paid: !!e?.paid_at, skipped: !!e?.skipped };
    } else if (dates.length) {
      // Computed: the formula over its parts' budgets, and again over what they really came to once any of them is known.
      const used = [...new Set(formulaItems(item.formula))];
      const loop = above.includes(item.id);
      const found = loop ? [] : used.map((id) => { const part = meant(id); return part ? lineOf(part, [...above, item.id]) : null; });
      const parts = [...new Set(found.filter((l): l is Line => !!l))];
      // Looked up by the id the formula holds, whichever twin answered for it this month.
      const live = new Map(used.flatMap((id, n) => { const l = found[n]; return l && !l.skipped ? [[id, l] as const] : []; }));
      const plan = evalFormula(item.formula!, (id) => live.get(id)?.budget ?? 0);
      const real = evalFormula(item.formula!, (id) => { const l = live.get(id); return l ? expected(l) : 0; });
      const warn = loop ? "Its formula uses itself." : plan.error === "syntax" ? "Its formula is not complete." : plan.error === "zero" ? "Its formula divides by zero." : used.some((id) => !byId.has(id)) ? "Its formula uses an item that is gone." : plan.value < 0 ? "Its formula comes to less than zero." : undefined;
      const rule = loop || plan.error ? 0 : Math.max(0, plan.value);
      const known = [...live.values()].some((l) => l.actual !== null);
      const typed = e?.actual != null ? Number(e.actual) : null;
      line = {
        item, dates, rule, budget: e?.budget != null ? Number(e.budget) : rule, paid: !!e?.paid_at, skipped: !!e?.skipped, parts, warn,
        actual: typed ?? (known && !loop && !real.error ? Math.max(0, real.value) : null), derived: typed === null && known,
      };
    }
    if (!above.includes(item.id)) made.set(item.id, line); // a line cut short by a loop is not the item's real one
    return line;
  };
  const parts = partIds(items);
  return items
    .filter((i) => !parts.has(i.id))
    .map((i) => lineOf(i, []))
    .filter((l): l is Line => !!l)
    .sort((a, b) => a.dates[0].localeCompare(b.dates[0]) || a.item.name.localeCompare(b.item.name));
}

/** What a line is expected to come to: the actual amount once known, the budget until then. */
export const expected = (l: Line) => l.actual ?? l.budget;
/** What the month before `nowYm` left open: its lines neither paid or received, nor skipped. Each has to be answered once the new month starts. */
export const carryOver = (items: MoneyItem[], entries: MoneyEntry[], increases: Increase[], nowYm: string) => monthLines(items, entries, increases, shiftMonth(nowYm, -1)).filter((l) => !l.paid && !l.skipped);
/** A repeating item's open month carried into this one: a one-time item for what was due, named after the month it came from. */
export const carried = (l: Line, fromYm: string, today: string) => ({
  kind: l.item.kind, name: `${l.item.name} (${monthLabel(fromYm).split(" ")[0]})`, amount: expected(l), freq: "once" as const, start_date: today, end_date: null,
  bank_id: l.item.bank_id, type_id: l.item.type_id, increase_id: null, person_ids: l.item.person_ids, notes: l.item.notes,
});
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

/** An item across a run of months: its line in each month it falls due (null where it does not), what each comes to, and the sum. */
export interface YearRow { item: MoneyItem; cells: (Line | null)[]; values: number[]; total: number }
/**
 * A run of months as a grid, a row for every item due in any of them. A cell counts as its expected amount,
 * and as nothing when skipped. Items that come most often are first, so a row's pattern shows how often it comes.
 */
export function yearRows(items: MoneyItem[], entries: MoneyEntry[], increases: Increase[], fromYm: string, months = 12): { months: string[]; rows: YearRow[] } {
  const yms = Array.from({ length: months }, (_, n) => shiftMonth(fromYm, n));
  const cols = yms.map((ym) => new Map(monthLines(items, entries, increases, ym).map((l) => [l.item.id, l])));
  const rows = items
    .map((item): YearRow => {
      const cells = cols.map((c) => c.get(item.id) ?? null);
      const values = cells.map((l) => (l && !l.skipped ? expected(l) : 0));
      return { item, cells, values, total: round2(values.reduce((s, v) => s + v, 0)) };
    })
    .filter((r) => r.cells.some(Boolean))
    .sort((a, b) => b.cells.filter(Boolean).length - a.cells.filter(Boolean).length || a.item.name.localeCompare(b.item.name));
  return { months: yms, rows };
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

/**
 * One item for each name, in the order the names first come. Where several items share a name (an import can
 * leave one for every month), the one due in `ym` stands for them; failing that, the one that started last.
 */
export function oneAName<T extends Pick<MoneyItem, "name" | "freq" | "start_date" | "end_date">>(items: T[], ym: string): T[] {
  const best = new Map<string, T>();
  const due = (i: T) => datesInMonth(i, ym).length > 0;
  for (const i of items) {
    const key = i.name.trim().toLowerCase();
    const had = best.get(key);
    if (!had || (due(i) && !due(had)) || (due(i) === due(had) && i.start_date > had.start_date)) best.set(key, i);
  }
  return [...best.values()];
}

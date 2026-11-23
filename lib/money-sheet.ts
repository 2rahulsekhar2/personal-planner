import { DateTime } from "luxon";
import { amountOn, datesInMonth, expected, monthLines, shiftMonth, type Bank, type Increase, type MoneyEntry, type MoneyFreq, type MoneyItem, type MoneyKind, type MoneyType } from "./money";

/**
 * A budget sheet and Money's own data, each turned into the other.
 * The sheet has one row for each income or expense and one column for each month:
 *   Particulars | Head | Bank | Increment | Notes | Jul 2023 | Aug 2023 | ...
 * A row reading INFLOW or OUTFLOW says which kind the rows under it are.
 */
export type Cell = string | number | Date | null | undefined;

/** Rows by table name: the shape money_snapshot() returns and money_replace() takes. */
export interface MoneyData {
  money_banks: Bank[];
  money_types: MoneyType[];
  money_increases: Increase[];
  money_items: MoneyItem[];
  money_entries: MoneyEntry[];
}

/** The short codes used in the Head column, and the type each becomes. Any other head is kept as it is written. */
export const HEADS: Record<string, string> = {
  GE: "General Expense", INVMT: "Investment", PE_R: "Personal (Rahul)", PE_A: "Personal (Ashu)", HE_TVM: "Home (Trivandrum)",
  HE_ACL: "Home (Anchal)", BBE: "Baby expenses", EMI_LOAN: "EMI / Loan", TAX: "Tax",
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const text = (c: Cell) => (typeof c === "string" ? c.trim() : "");
const amount = (c: Cell) => (typeof c === "number" && Number.isFinite(c) && c > 0 ? round2(c) : null);
const dateIn = (ym: string, day: number) => `${ym}-${String(Math.min(day, DateTime.fromISO(`${ym}-01`).daysInMonth!)).padStart(2, "0")}`;

/** A cell note as plain text: Google Sheets and Excel wrap each note in an id, an author line and filler. */
export function cleanNote(note: string): string {
  return note
    .split("\n")
    .map((l) => l.trim().replace(/^Comment:\s*/, ""))
    .filter((l) => l && !/^(=+|-+|ID#.*|\[Threaded comment\]|Your version of Excel .*|.*\(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\))$/.test(l))
    .join("; ");
}

/**
 * Reads a budget sheet. `notes` holds cell notes keyed "row,column" (both from 0). Months before `nowYm` are
 * history: each figure is recorded as paid or received. Later months are the plan.
 * `keep` is the banks already in Money: one with the same name keeps its balance.
 * Returns the rows to store, and the names of rows left out because no month had a figure.
 */
export function sheetToMoney(rows: Cell[][], notes: Record<string, string>, nowYm: string, keep: Bank[] = []): { data: MoneyData; skipped: string[] } {
  const labelRow = rows.findIndex((r) => r.some((c) => /^particulars$/i.test(text(c))));
  const dateRow = rows.findIndex((r) => r.filter((c) => c instanceof Date).length >= 3);
  if (labelRow < 0 || dateRow < 0) throw new Error("This does not look like a budget sheet. It needs a Particulars column and a row of month dates.");
  const col = (re: RegExp) => Math.max(rows[labelRow].findIndex((c) => re.test(text(c))), rows[dateRow].findIndex((c) => re.test(text(c))));
  const cName = col(/^particulars$/i), cHead = col(/^head$/i), cBank = col(/^bank$/i), cRise = col(/inflation|increment/i), cPay = col(/^to pay$/i), cNotes = col(/^notes$/i);
  const months = rows[dateRow].flatMap((c, i) => (c instanceof Date ? [{ i, ym: c.toISOString().slice(0, 7) }] : []));
  const lastYm = months.reduce((max, m) => (m.ym > max ? m.ym : max), "");

  const data: MoneyData = { money_banks: [], money_types: [], money_increases: [], money_items: [], money_entries: [] };
  const skipped: string[] = [];
  // One row in a list for each distinct name: made the first time it is met.
  const ids = new Map<string, string>();
  const idFor = (key: string, make: (id: string) => void) => {
    if (!ids.has(key)) {
      ids.set(key, crypto.randomUUID());
      make(ids.get(key)!);
    }
    return ids.get(key)!;
  };

  let kind: MoneyKind = "expense";
  let sawTotal = false;
  for (let r = Math.max(labelRow, dateRow) + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const name = text(row[cName]);
    if (!name) continue;
    const marker = /^(inflow|income)$/i.test(name) ? "income" : /^(outflow|expenses?)$/i.test(name) ? "expense" : null;
    if (marker) {
      kind = marker;
      sawTotal = false;
      continue;
    }
    const head = text(row[cHead]).slice(0, 80);
    const bank = text(row[cBank]).slice(0, 80);
    if (/\btotal\b/i.test(name)) {
      sawTotal = true;
      continue;
    }
    // A balance carried from last month, and the sums written under a total: Money works these out itself.
    if (/^c\/f\b/i.test(name) || (sawTotal && !head && !bank)) continue;
    const vals = months.flatMap((m) => {
      const v = amount(row[m.i]);
      return v === null ? [] : [{ ym: m.ym, v, note: notes[`${r},${m.i}`] }];
    }).sort((a, b) => a.ym.localeCompare(b.ym));
    if (!vals.length) {
      if (head || bank) skipped.push(name);
      continue;
    }

    const bank_id = bank ? idFor(`bank|${bank.toLowerCase()}`, (id) => {
      const old = keep.find((b) => b.name.trim().toLowerCase() === bank.toLowerCase());
      data.money_banks.push({ id, name: bank, balance: Number(old?.balance ?? 0), balance_at: old?.balance_at ?? null, archived_at: null });
    }) : null;
    const typeName = HEADS[head.toUpperCase()] ?? head;
    const type_id = head ? idFor(`type|${kind}|${typeName.toLowerCase()}`, (id) => data.money_types.push({ id, name: typeName, kind, archived_at: null })) : null;
    // The sheet writes 10% as 0.1; a figure above 1 is taken as a percentage already.
    const riseCell = row[cRise];
    const rise = typeof riseCell === "number" ? riseCell : 0;
    const percent = round2(rise > 0 && rise <= 1 ? rise * 100 : rise);
    const increase_id = percent > 0 && percent <= 100 ? idFor(`rise|${percent}`, (id) => data.money_increases.push({ id, name: `${percent}% a year`, percent, archived_at: null })) : null;
    // "Car Loan - 5th" falls due on the 5th.
    const day = Math.max(1, Number(/\b(\d{1,2})(?:st|nd|rd|th)\b/i.exec(name)?.[1]) || 1);
    const toPay = amount(row[cPay]);
    const rowNotes = [text(row[cNotes]), toPay !== null && !/^To pay:/m.test(text(row[cNotes])) ? `To pay: ${toPay}` : ""];

    const add = (freq: MoneyFreq, vs: typeof vals, cellNotes: string[]) => {
      const first = vs[0].ym;
      const last = vs[vs.length - 1].ym;
      const start_date = dateIn(first, day);
      const pct = freq === "once" || !increase_id ? 0 : percent;
      // The rule is set from the present: the first planned month, or the last month on record when the row has ended.
      const ref = vs.find((v) => v.ym >= nowYm) ?? vs[vs.length - 1];
      const item: MoneyItem = {
        id: crypto.randomUUID(), kind, name: name.slice(0, 120), freq, start_date,
        amount: round2((ref.v * 1e6) / amountOn({ amount: 1e6, start_date }, dateIn(ref.ym, day), pct)),
        end_date: freq === "once" || shiftMonth(last, freq === "yearly" ? 12 : 1) > lastYm ? null : DateTime.fromISO(`${last}-01`).endOf("month").toISODate(),
        bank_id, type_id, increase_id: freq === "once" ? null : increase_id, person_ids: [],
        notes: [...rowNotes, ...cellNotes].filter(Boolean).join("\n") || null,
      };
      data.money_items.push(item);
      const byYm = new Map(vs.map((v) => [v.ym, v.v]));
      for (let ym = first; ym <= last; ym = shiftMonth(ym, 1)) {
        const dates = datesInMonth(item, ym);
        if (!dates.length) continue;
        const v = byYm.get(ym);
        const differs = v !== undefined && Math.abs(v - amountOn(item, dates[0], pct)) > 0.004;
        const entry = { item_id: item.id, month: `${ym}-01`, budget: differs ? v : null, actual: null, paid_at: null, skipped: false };
        if (v === undefined) data.money_entries.push({ ...entry, skipped: true });
        else if (ym < nowYm) data.money_entries.push({ ...entry, actual: v, paid_at: `${ym}-01T00:00:00Z` });
        else if (differs) data.money_entries.push(entry);
      }
    };
    const dated = (vs: typeof vals) => vs.filter((v) => v.note).map((v) => `${v.ym}: ${v.note}`);
    const span = Math.round(DateTime.fromISO(`${vals[vals.length - 1].ym}-01`).diff(DateTime.fromISO(`${vals[0].ym}-01`), "months").months) + 1;
    if (vals.length > 1 && vals.every((v) => v.ym.slice(5) === vals[0].ym.slice(5))) add("yearly", vals, dated(vals));
    // A row filled in less than half its months is a set of separate payments, not a monthly bill with gaps.
    else if (vals.length * 2 < span || vals.length === 1) for (const v of vals) add("once", [v], v.note ? [v.note] : []);
    else add("monthly", vals, dated(vals));
  }
  return { data, skipped };
}

/**
 * Writes Money's data as a budget sheet that sheetToMoney reads back. Each cell is what the month is expected to
 * come to: the actual amount once known, the budget until then. One-time items that share a name fill one row.
 */
// shortcut: paid marks, people and daily or weekly rules are not written (a weekly item becomes a monthly figure); a backup keeps those, add columns here if exports must too
export function moneyToSheet(d: MoneyData, nowYm: string): Cell[][] {
  const ends = [shiftMonth(nowYm, 12), ...d.money_entries.map((e) => e.month.slice(0, 7)), ...d.money_items.map((i) => (i.end_date ?? i.start_date).slice(0, 7))];
  const from = d.money_items.reduce((min, i) => (i.start_date.slice(0, 7) < min ? i.start_date.slice(0, 7) : min), nowYm);
  const to = ends.reduce((max, ym) => (ym > max ? ym : max));
  const months: string[] = [];
  for (let ym = from; ym <= to; ym = shiftMonth(ym, 1)) months.push(ym);
  const byMonth = months.map((ym) => new Map(monthLines(d.money_items, d.money_entries, d.money_increases, ym).filter((l) => !l.skipped).map((l) => [l.item.id, expected(l)])));

  const name = (list: { id: string; name: string }[], id: string | null) => list.find((x) => x.id === id)?.name ?? null;
  const out: Cell[][] = [["Particulars", "Head", "Bank", "Increment", "Notes", ...months.map((ym) => new Date(`${ym}-01T00:00:00Z`))]];
  for (const kind of ["income", "expense"] as const) {
    out.push([kind === "income" ? "INFLOW" : "OUTFLOW"]);
    const groups = new Map<string, MoneyItem[]>();
    for (const i of d.money_items.filter((x) => x.kind === kind)) {
      const key = i.freq === "once" ? `${i.name}|${i.type_id}|${i.bank_id}` : i.id;
      groups.set(key, [...(groups.get(key) ?? []), i]);
    }
    for (const items of [...groups.values()].sort((a, b) => a[0].name.localeCompare(b[0].name))) {
      const rise = d.money_increases.find((x) => x.id === items[0].increase_id);
      const notes = [...new Set(items.flatMap((i) => (i.notes ? [i.notes] : [])))].join("\n");
      out.push([
        items[0].name, name(d.money_types, items[0].type_id), name(d.money_banks, items[0].bank_id), rise ? Number(rise.percent) / 100 : null, notes || null,
        ...byMonth.map((m) => {
          const due = items.filter((i) => m.has(i.id));
          return due.length ? round2(due.reduce((sum, i) => sum + m.get(i.id)!, 0)) : null;
        }),
      ]);
    }
  }
  return out;
}

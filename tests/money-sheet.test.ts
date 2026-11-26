import { describe, expect, it } from "vitest";
import { expected, monthLines, shiftMonth } from "@/lib/money";
import { cleanNote, moneyToSheet, sheetToMoney, type Cell, type MoneyData } from "@/lib/money-sheet";
import { readXlsx, writeXlsx } from "@/lib/money-xlsx";

const NOW = "2026-11";
const month = (ym: string) => new Date(`${ym}-01T00:00:00Z`);
// Jul 2026 to Jun 2028: four months of history, then the plan.
const MONTHS = Array.from({ length: 24 }, (_, n) => shiftMonth("2026-07", n));
const line = (name: string, head: string | null, bank: string | null, rise: number | null, toPay: number | null, at: (ym: string) => number | null): Cell[] => [name, head, bank, rise, toPay, ...MONTHS.map(at)];

const SHEET: Cell[][] = [
  ["Particulars", "Head", "Bank", "Inflation/\nIncrement", "My Balance", ...MONTHS.map(() => 5)],
  [null, null, null, null, "TO Pay", ...MONTHS.map(month)],
  ["INFLOW"],
  line("Salary", null, null, 0.1, null, (ym) => (ym < "2027-01" ? 1000 : ym < "2028-01" ? 1100 : 1210)),
  line("C/F last month Balance", null, null, null, null, () => 50),
  line("TOTAL", null, null, null, null, () => 1050),
  line("Cash In Hand", null, null, null, null, () => 7),
  ["OUTFLOW"],
  ["RECURRING"],
  line("Car Loan - 5th", "EMI_LOAN", "HDFC Bank", null, 90000, (ym) => (ym <= "2027-03" ? 9321 : null)),
  line("Wifi", "HE_TVM", "hdfc bank", null, null, (ym) => (ym === "2026-09" ? null : 700)),
  line("Car Insurance", "GE", "Axis Bank", null, null, (ym) => (ym.endsWith("-08") ? 3000 : null)),
  line("Car Service", "GE", "Axis Bank", null, null, (ym) => (ym === "2026-08" || ym === "2027-05" ? 5000 : null)),
  line("Land Loan", "EMI_LOAN", "HDFC Bank", null, null, () => null),
  line("GRAND TOTAL", null, null, null, null, () => 99),
];

/** What each named row comes to in a month, by the app's own sums. */
const figures = (d: MoneyData, ym: string) => {
  const sums: Record<string, number> = {};
  for (const l of monthLines(d.money_items, d.money_entries, d.money_increases, ym)) if (!l.skipped) sums[l.item.name] = (sums[l.item.name] ?? 0) + expected(l);
  return sums;
};
const sheetFigures = (ym: string) => {
  const c = 5 + MONTHS.indexOf(ym);
  return Object.fromEntries(SHEET.slice(2).filter((r) => typeof r[c] === "number" && (r[1] || r[0] === "Salary")).map((r) => [r[0], r[c]]));
};

describe("reading a budget sheet", () => {
  const { data, skipped } = sheetToMoney(SHEET, { "12,6": "Polo service" }, NOW, [{ id: "old", name: "HDFC Bank", balance: 4200, balance_at: "2026-11-01", archived_at: null }]);
  const item = (name: string) => data.money_items.filter((i) => i.name === name);

  it("gives every month the figure the sheet has, past and planned", () => {
    for (const ym of MONTHS) expect(figures(data, ym), ym).toEqual(sheetFigures(ym));
  });

  it("leaves out totals, carried balances and section headings, and reports rows with no figures", () => {
    expect(data.money_items.map((i) => i.name).sort()).toEqual(["Car Insurance", "Car Loan - 5th", "Car Service", "Car Service", "Salary", "Wifi"]);
    expect(skipped).toEqual(["Land Loan"]);
  });

  it("records past months as paid and leaves planned months open", () => {
    const paid = (ym: string) => monthLines(data.money_items, data.money_entries, data.money_increases, ym).filter((l) => l.paid).length;
    expect(paid("2026-10")).toBe(3);
    expect(paid(NOW)).toBe(0);
  });

  it("names the types in full, keeps one bank for each name and keeps a known bank's balance", () => {
    expect(data.money_types.map((t) => `${t.kind}: ${t.name}`).sort()).toEqual(["expense: EMI / Loan", "expense: General Expense", "expense: Home (Trivandrum)"]);
    expect(data.money_banks.map((b) => [b.name, b.balance])).toEqual([["HDFC Bank", 4200], ["Axis Bank", 0]]);
  });

  it("works out when a row falls due, how often, and when it ends", () => {
    expect(item("Car Loan - 5th")[0]).toMatchObject({ freq: "monthly", start_date: "2026-07-05", end_date: "2027-03-31", notes: "To pay: 90000" });
    expect(item("Car Insurance")[0]).toMatchObject({ freq: "yearly", start_date: "2026-08-01", end_date: null });
    expect(item("Car Service").map((i) => [i.freq, i.start_date, i.notes])).toEqual([["once", "2026-08-01", "Polo service"], ["once", "2027-05-01", null]]);
    expect(item("Salary")[0]).toMatchObject({ kind: "income", freq: "monthly", end_date: null });
    expect(data.money_increases).toMatchObject([{ name: "10% a year", percent: 10 }]);
  });

  it("keeps a row as one item, with lasting changes of amount dated and stray figures apart", () => {
    const rows: Cell[][] = [SHEET[0], SHEET[1], ["OUTFLOW"],
      // A monthly EMI with a stray figure far after it.
      line("Mobile Loan - 5th", "EMI_LOAN", "HDFC Bank", null, null, (ym) => (ym <= "2027-06" ? 3590 : ym === "2028-05" ? 1 : null)),
      // A subscription that goes up for good in March, with one dearer month in between.
      line("Hotstar - 16th", "GE", "HDFC Bank", null, null, (ym) => (ym < "2027-03" ? 179 : ym === "2027-09" ? 1500 : 299)),
    ];
    const { data } = sheetToMoney(rows, {}, NOW);
    const of = (name: string) => data.money_items.filter((i) => i.name === name);
    expect(of("Mobile Loan - 5th").map((i) => [i.freq, i.amount, i.start_date])).toEqual([["monthly", 3590, "2026-07-05"], ["once", 1, "2028-05-05"]]);
    expect(of("Hotstar - 16th")).toHaveLength(1);
    expect(of("Hotstar - 16th")[0]).toMatchObject({ freq: "monthly", amount: 179, amount_steps: [{ from: "2027-03-16", amount: 299 }] });
    for (const ym of MONTHS) expect(figures(data, ym)["Hotstar - 16th"], ym).toBe(rows[4][5 + MONTHS.indexOf(ym)]);
  });

  it("refuses a sheet that is not a budget", () => {
    expect(() => sheetToMoney([["Name", "Phone"]], {}, NOW)).toThrow(/budget sheet/);
  });
});

describe("writing a budget sheet", () => {
  it("survives a trip through an Excel file with the same monthly figures", async () => {
    const { data } = sheetToMoney(SHEET, {}, NOW);
    const file = await readXlsx(await writeXlsx(moneyToSheet(data, NOW)));
    expect(file.rows[0].slice(0, 5)).toEqual(["Particulars", "Head", "Bank", "Increment", "Notes"]);
    const again = sheetToMoney(file.rows, file.notes, NOW).data;
    for (const ym of MONTHS) expect(figures(again, ym), ym).toEqual(figures(data, ym));
    expect(again.money_types.map((t) => t.name).sort()).toEqual(data.money_types.map((t) => t.name).sort());
    expect(again.money_items.find((i) => i.name === "Car Loan - 5th")?.notes).toBe("To pay: 90000");
  });
});

describe("cell notes", () => {
  it("keeps only what was written", () => {
    expect(cleanNote("======\nID#AAAB5JWtgKQ\nRahul    (2026-05-01 21:06:48)\nPolo Service\n------\nID#AAAA\nRahul    (2022-11-04 06:27:31)\nCeramic coating")).toBe("Polo Service; Ceramic coating");
  });
});

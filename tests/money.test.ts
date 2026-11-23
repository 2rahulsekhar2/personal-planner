import { describe, expect, it } from "vitest";
import { amountOn, bankPosition, datesInMonth, monthLines, parseAmount, shiftMonth, totals, type MoneyEntry, type MoneyItem } from "@/lib/money";

const item = (over: Partial<MoneyItem>): MoneyItem => ({
  id: "i1", kind: "expense", name: "Wifi bill", amount: 1000, freq: "monthly", start_date: "2026-01-15", end_date: null,
  bank_id: "b1", type_id: null, increase_id: null, person_ids: [], notes: null, ...over,
});

describe("when an item falls due", () => {
  it("places a one-time item in its own month only", () => {
    const once = item({ freq: "once", start_date: "2026-11-23" });
    expect(datesInMonth(once, "2026-11")).toEqual(["2026-11-23"]);
    expect(datesInMonth(once, "2026-12")).toEqual([]);
  });
  it("repeats monthly from the start month, and stops after the end date", () => {
    const m = item({ end_date: "2026-03-10" });
    expect(datesInMonth(m, "2025-12")).toEqual([]);
    expect(datesInMonth(m, "2026-02")).toEqual(["2026-02-15"]);
    expect(datesInMonth(m, "2026-03")).toEqual([]); // ends on the 10th, before the 15th
  });
  it("moves the 31st to the last day of a shorter month", () => {
    expect(datesInMonth(item({ start_date: "2026-01-31" }), "2026-02")).toEqual(["2026-02-28"]);
  });
  it("counts weekly and daily occurrences inside the month", () => {
    // 3 November 2026 is a Tuesday: Tuesdays in December are the 1st, 8th, 15th, 22nd and 29th.
    expect(datesInMonth(item({ freq: "weekly", start_date: "2026-11-03" }), "2026-12")).toHaveLength(5);
    expect(datesInMonth(item({ freq: "daily", start_date: "2026-11-20" }), "2026-11")).toHaveLength(11);
    expect(datesInMonth(item({ freq: "daily", start_date: "2026-01-01" }), "2027-02")).toHaveLength(28);
  });
  it("repeats yearly in the start month only", () => {
    const y = item({ freq: "yearly", start_date: "2024-02-29" });
    expect(datesInMonth(y, "2026-02")).toEqual(["2026-02-28"]);
    expect(datesInMonth(y, "2026-03")).toEqual([]);
  });
});

describe("yearly increase", () => {
  it("raises the amount once for each full year, compounding", () => {
    const emi = item({ amount: 10000, start_date: "2025-04-05" });
    expect(amountOn(emi, "2026-04-04", 10)).toBe(10000);
    expect(amountOn(emi, "2026-04-05", 10)).toBe(11000);
    expect(amountOn(emi, "2027-06-05", 10)).toBe(12100);
  });
});

describe("a month's lines and totals", () => {
  const items = [
    item({ id: "wifi", amount: 1000 }),
    item({ id: "milk", name: "Milk", freq: "daily", amount: 50, start_date: "2026-01-01" }),
    item({ id: "pay", name: "Salary", kind: "income", amount: 90000, start_date: "2026-01-01" }),
    item({ id: "gym", name: "Gym", amount: 2000, bank_id: "b2" }),
  ];
  const entries: MoneyEntry[] = [
    { item_id: "wifi", month: "2026-11-01", budget: 1200, actual: 1180, paid_at: "2026-11-15T00:00:00Z", skipped: false },
    { item_id: "gym", month: "2026-11-01", budget: null, actual: null, paid_at: null, skipped: true },
    { item_id: "milk", month: "2026-10-01", budget: 9999, actual: null, paid_at: null, skipped: false }, // another month: ignored
  ];
  const lines = monthLines(items, entries, [], "2026-11");

  it("uses the month's own budget when one is set, and the rule otherwise", () => {
    expect(lines.find((l) => l.item.id === "wifi")).toMatchObject({ rule: 1000, budget: 1200, actual: 1180, paid: true });
    expect(lines.find((l) => l.item.id === "milk")).toMatchObject({ budget: 1500, paid: false });
  });
  it("leaves skipped lines out of the totals", () => {
    expect(totals(lines, "expense")).toEqual({ budget: 2700, actual: 1180, due: 1500 });
    expect(totals(lines, "income")).toEqual({ budget: 90000, actual: 0, due: 90000 });
  });
  it("shows what a bank holds after the month's unpaid items", () => {
    expect(bankPosition({ id: "b1", balance: 5000 }, lines)).toEqual({ incomeDue: 90000, expenseDue: 1500, after: 93500 });
    expect(bankPosition({ id: "b2", balance: 100 }, lines).after).toBe(100); // its only expense is skipped
  });
});

describe("helpers", () => {
  it("moves a month across a year end", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });
  it("reads a typed amount", () => {
    expect(parseAmount("₹1,25,000.50")).toBe(125000.5);
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("-5")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
  });
});

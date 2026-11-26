import { describe, expect, it } from "vitest";
import { carried, carryOver, evalFormula, formulaLoops, withParts, type FormulaToken, loanEmi, loanNow, loanSchedule, amountIn, amountOn, amountPeriods, bankPosition, byPerson, byType, forecast, linesDueOn, waitingOn, datesInMonth, monthLines, parseAmount, shiftMonth, totals, yearRows, type MoneyEntry, type MoneyItem } from "@/lib/money";
import { byPlace, movedTo, oneAName } from "@/lib/money";

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

describe("approvals", () => {
  const members = [
    { user_id: "asker", role: "member" },
    { user_id: "owner", role: "owner" },
    { user_id: "looker", role: "viewer" },
    { user_id: "gone", role: "member", expires_at: "2020-01-01T00:00:00Z" },
    { user_id: "other", role: "member" },
  ];
  const p = { id: "p1", created_by: "asker" };
  it("waits for every current owner and member except the asker", () => {
    expect(waitingOn(p, members, [])).toEqual(["owner", "other"]);
  });
  it("stops waiting for those who approved this request", () => {
    expect(waitingOn(p, members, [{ proposal_id: "p1", user_id: "owner" }, { proposal_id: "p2", user_id: "other" }])).toEqual(["other"]);
    expect(waitingOn(p, members, [{ proposal_id: "p1", user_id: "owner" }, { proposal_id: "p1", user_id: "other" }])).toEqual([]);
  });
});

describe("insights", () => {
  const items = [
    item({ id: "wifi", amount: 1200, person_ids: ["a", "b", "c"], type_id: "home" }),
    item({ id: "school", name: "School", amount: 5000, person_ids: ["c"], type_id: "kids", start_date: "2026-01-10" }),
    item({ id: "tax", name: "Tax", amount: 300, type_id: "home", freq: "once", start_date: "2026-11-20" }),
    item({ id: "milk", name: "Milk", amount: 50, freq: "daily", start_date: "2026-01-01" }),
    item({ id: "emi", name: "EMI", amount: 10000, increase_id: "up", start_date: "2026-02-05" }),
    item({ id: "pay", name: "Salary", kind: "income", amount: 60000, start_date: "2026-01-01" }),
  ];
  const entries: MoneyEntry[] = [{ item_id: "school", month: "2026-11-01", budget: null, actual: 5600, paid_at: "2026-11-10T00:00:00Z", skipped: false }];
  const up = [{ id: "up", name: "Step-up", percent: 10, archived_at: null }];
  const lines = monthLines(items, entries, up, "2026-11");

  it("splits each expense equally between the people it is for", () => {
    // Wifi 1200 / 3 = 400 each. School, at its actual 5600, is all c's. Tax, milk and the EMI are for nobody in particular.
    expect(byPerson(lines)).toEqual([{ id: null, amount: 11800 }, { id: "c", amount: 6000 }, { id: "a", amount: 400 }, { id: "b", amount: 400 }]);
  });
  it("sums budget and actual for each type", () => {
    expect(byType(lines).find((t) => t.id === "kids")).toEqual({ id: "kids", budget: 5000, actual: 5600, due: 0 });
    expect(byType(lines).find((t) => t.id === "home")).toEqual({ id: "home", budget: 1500, actual: 0, due: 1500 });
  });
  it("lists what falls due on a day, leaving out daily items", () => {
    expect(linesDueOn(lines, "2026-11-20").map((l) => l.item.id)).toEqual(["tax"]);
    expect(linesDueOn(lines, "2026-11-15").map((l) => l.item.id)).toEqual(["wifi"]);
    expect(linesDueOn(lines, "2026-11-02")).toEqual([]);
  });
  it("forecasts the months ahead, with the yearly increase from its anniversary", () => {
    const f = forecast(items, entries, up, "2026-12", 3);
    expect(f.map((m) => m.ym)).toEqual(["2026-12", "2027-01", "2027-02"]);
    // December: wifi 1200 + school 5000 + milk 31 x 50 + EMI 10000. February 2027: 28 days of milk, and the EMI is 11000.
    expect(f[0]).toEqual({ ym: "2026-12", income: 60000, expense: 17750, left: 42250 });
    expect(f[2].expense).toBe(1200 + 5000 + 28 * 50 + 11000);
  });
});

describe("an amount that changes from a date", () => {
  // Salary: 2,00,000 from February 2025, 2,25,000 from April 2026, 2,50,000 from April 2027.
  const pay = item({ id: "pay", kind: "income", amount: 200000, start_date: "2025-02-01", amount_steps: [{ from: "2027-04-01", amount: 250000 }, { from: "2026-04-01", amount: 225000 }] });

  it("uses the amount in force on the date, whatever order the changes are stored in", () => {
    expect(amountIn(pay, "2026-03-31")).toEqual({ amount: 200000, since: "2025-02-01" });
    expect(amountIn(pay, "2026-04-01")).toEqual({ amount: 225000, since: "2026-04-01" });
    expect(amountIn(pay, "2028-01-01")).toEqual({ amount: 250000, since: "2027-04-01" });
  });
  it("lists the stretches, each ending the day before the next", () => {
    expect(amountPeriods(pay)).toEqual([
      { from: "2025-02-01", to: "2026-03-31", amount: 200000 },
      { from: "2026-04-01", to: "2027-03-31", amount: 225000 },
      { from: "2027-04-01", to: null, amount: 250000 },
    ]);
    expect(amountPeriods({ ...pay, end_date: "2027-12-31" })[2].to).toBe("2027-12-31");
  });
  it("shows the new amount in the month it starts, and in a forecast across the change", () => {
    expect(monthLines([pay], [], [], "2026-03")[0].budget).toBe(200000);
    expect(monthLines([pay], [], [], "2026-04")[0].budget).toBe(225000);
    expect(forecast([pay], [], [], "2026-02", 4).map((m) => m.income)).toEqual([200000, 200000, 225000, 225000]);
  });
  it("splits a daily item's month at the change", () => {
    // Milk: 50 a day, 60 a day from the 11th. April has 10 days at 50 and 20 at 60.
    const milk = item({ freq: "daily", amount: 50, start_date: "2026-01-01", amount_steps: [{ from: "2026-04-11", amount: 60 }] });
    expect(monthLines([milk], [], [], "2026-04")[0].budget).toBe(10 * 50 + 20 * 60);
  });
  it("counts a yearly increase from when the amount in force began", () => {
    const emi = item({ amount: 10000, start_date: "2025-04-05", amount_steps: [{ from: "2026-10-05", amount: 15000 }] });
    expect(amountOn(emi, "2026-04-05", 10)).toBe(11000); // a year on the first amount
    expect(amountOn(emi, "2026-10-05", 10)).toBe(15000); // the change is taken as given
    expect(amountOn(emi, "2027-10-05", 10)).toBe(16500); // a year on the second
  });
  it("still lets one month's own figure win", () => {
    const entries: MoneyEntry[] = [{ item_id: "pay", month: "2026-04-01", budget: 210000, actual: null, paid_at: null, skipped: false }];
    expect(monthLines([pay], entries, [], "2026-04")[0]).toMatchObject({ rule: 225000, budget: 210000 });
  });
  it("ignores a change dated on or before the first date, and an item with none", () => {
    expect(amountIn(item({ amount: 500, start_date: "2026-01-15", amount_steps: [{ from: "2026-01-15", amount: 900 }] }), "2026-06-01").amount).toBe(500);
    expect(amountIn(item({ amount: 500, amount_steps: null }), "2026-06-01").amount).toBe(500);
  });
});

describe("a loan", () => {
  const loan = (over: Partial<MoneyItem> = {}, l: Partial<NonNullable<MoneyItem["loan"]>> = {}) =>
    item({ id: "loan", kind: "expense", freq: "monthly", start_date: "2026-01-05", loan: { principal: 100000, rate: 12, kind: "reducing", months: 12, ...l }, ...over, amount: over.amount ?? loanEmi({ principal: 100000, rate: 12, kind: "reducing", months: 12, ...l }) });

  it("works out the usual EMI, to the next rupee", () => {
    expect(loanEmi({ principal: 100000, rate: 12, kind: "reducing", months: 12 })).toBe(8885);
    expect(loanEmi({ principal: 120000, rate: 10, kind: "flat", months: 12 })).toBe(11000);
    expect(loanEmi({ principal: 120000, rate: 0, kind: "reducing", months: 12 })).toBe(10000);
    expect(loanEmi({ principal: 0, rate: 10, kind: "reducing", months: 12 })).toBe(0);
  });

  it("pays interest first, the rest off what is owed, and ends on the remainder", () => {
    const rows = loanSchedule(loan());
    expect(rows).toHaveLength(12);
    expect(rows[0]).toEqual({ date: "2026-01-05", pay: 8885, interest: 1000, balance: 92115 });
    expect(rows[11].balance).toBe(0);
    expect(rows[11].pay).toBeLessThanOrEqual(8885);
    expect(rows[11].pay).toBeGreaterThan(8800);
  });

  it("charges flat interest on the amount taken every month", () => {
    const rows = loanSchedule(loan({}, { principal: 120000, rate: 10, kind: "flat" }));
    expect(rows).toHaveLength(12);
    expect(rows.every((r) => r.interest === 1000 && r.pay === 11000)).toBe(true);
    expect(rows[11].balance).toBe(0);
  });

  it("a bigger EMI from a date ends it sooner", () => {
    const rows = loanSchedule(loan({ amount_steps: [{ from: "2026-04-01", amount: 20000 }] }));
    expect(rows.length).toBeLessThan(12);
    expect(rows[3].pay).toBe(20000);
    expect(rows[rows.length - 1].balance).toBe(0);
  });

  it("carries on from the lender's balance on a date", () => {
    const rows = loanSchedule(loan({}, { balance: 10000, balance_on: "2026-03-20" }));
    expect(rows[2].pay).toBe(8885); // March, before the figure applies
    expect(rows[3]).toEqual({ date: "2026-04-05", pay: 8885, interest: 100, balance: 1215 });
    expect(rows).toHaveLength(5);
    expect(rows[4].pay).toBe(1227.15);
  });

  it("stops at the last date when closed early", () => {
    const rows = loanSchedule(loan({ end_date: "2026-03-10" }));
    expect(rows.map((r) => r.date)).toEqual(["2026-01-05", "2026-02-05", "2026-03-05"]);
  });

  it("says where it stands on a day", () => {
    const now = loanNow(loan(), 0, "2026-03-10");
    expect(now.balance).toBe(loanSchedule(loan())[2].balance);
    expect(now.left).toBe(9);
    expect(now.ends).toBe("2026-12-05");
    expect(now.endless).toBe(false);
    expect(loanNow(loan(), 0, "2025-12-01").balance).toBe(100000);
    expect(loanNow(loan({}, { balance: 50000, balance_on: "2026-03-08" }), 0, "2026-03-10").balance).toBe(50000);
    expect(loanNow(loan({ amount: 500 }), 0, "2026-03-10").endless).toBe(true);
  });

  it("is a line while something is owed, and gone after", () => {
    const l = loan();
    expect(monthLines([l], [], [], "2026-12")[0].rule).toBe(loanSchedule(l)[11].pay);
    expect(monthLines([l], [], [], "2027-01")).toEqual([]);
    expect(monthLines([l], [], [], "2025-12")).toEqual([]);
    expect(monthLines([l], [], [], "2026-06")[0]).toMatchObject({ rule: 8885, dates: ["2026-06-05"] });
  });
});

describe("the year as a grid", () => {
  it("gives a row to each item due in the run, a cell a month, and counts actuals and skips", () => {
    const rent = item({ id: "rent", name: "Rent", start_date: "2026-01-05" });
    const car = item({ id: "car", name: "Car insurance", freq: "yearly", amount: 18000, start_date: "2025-03-10" });
    const gone = item({ id: "gone", name: "Old gym", end_date: "2026-06-30" });
    const entries: MoneyEntry[] = [
      { item_id: "rent", month: "2026-12-01", budget: null, actual: 1200, paid_at: "2026-12-05T00:00:00Z", skipped: false },
      { item_id: "rent", month: "2027-01-01", budget: null, actual: null, paid_at: null, skipped: true },
    ];
    const { months, rows } = yearRows([car, gone, rent], entries, [], "2026-11");
    expect(months[0]).toBe("2026-11");
    expect(months[11]).toBe("2027-10");
    expect(rows.map((r) => r.item.id)).toEqual(["rent", "car"]); // most often first; nothing due is left out
    expect(rows[0].values.slice(0, 3)).toEqual([1000, 1200, 0]);
    expect(rows[0].cells[2]?.skipped).toBe(true);
    expect(rows[0].total).toBe(11200);
    expect(rows[1].cells.map((c) => !!c)).toEqual([false, false, false, false, true, false, false, false, false, false, false, false]);
  });
});

describe("a computed item", () => {
  const n = (v: number): FormulaToken => ({ t: "num", v });
  const o = (v: "+" | "-" | "*" | "/" | "(" | ")"): FormulaToken => ({ t: "op", v });
  const it_ = (id: string): FormulaToken => ({ t: "item", id });
  const worth = (id: string) => ({ a: 100, b: 40 })[id] ?? 0;

  it("works a formula out in the usual order", () => {
    expect(evalFormula([n(2), o("+"), n(3), o("*"), n(4)], worth).value).toBe(14);
    expect(evalFormula([o("("), n(2), o("+"), n(3), o(")"), o("*"), n(4)], worth).value).toBe(20);
    expect(evalFormula([it_("a"), o("-"), it_("b")], worth).value).toBe(60);
    expect(evalFormula([it_("a"), o("*"), { t: "pct", v: 10 }], worth).value).toBe(10);
    expect(evalFormula([o("-"), it_("b"), o("+"), it_("a")], worth).value).toBe(60);
    expect(evalFormula([n(10), o("-"), n(4), o("-"), n(3)], worth).value).toBe(3);
    expect(evalFormula([n(100), o("/"), n(8)], worth).value).toBe(12.5);
  });

  it("says when a formula is not a sum, or divides by zero", () => {
    expect(evalFormula([], worth).error).toBe("syntax");
    expect(evalFormula([n(2), o("+")], worth).error).toBe("syntax");
    expect(evalFormula([n(2), n(3)], worth).error).toBe("syntax");
    expect(evalFormula([o("("), n(2)], worth).error).toBe("syntax");
    expect(evalFormula([n(2), o("/"), it_("none")], worth)).toEqual({ value: 0, error: "zero" });
  });

  const salary = item({ id: "sal", kind: "income", name: "Salary", amount: 100000, start_date: "2026-01-01" });
  const tax = item({ id: "tax", kind: "expense", name: "Tax", amount: 10000, start_date: "2026-01-01" });
  const bonus = item({ id: "bon", kind: "income", name: "Bonus", amount: 50000, freq: "yearly", start_date: "2026-03-01" });
  const net = item({ id: "net", kind: "income", name: "Take home", amount: 0, start_date: "2026-01-01", formula: [it_("sal"), o("+"), it_("bon"), o("-"), it_("tax")] });
  const all = [salary, tax, bonus, net];

  it("takes its budget from its parts, which are no longer lines of their own", () => {
    const lines = monthLines(all, [], [], "2026-02");
    expect(lines.map((l) => l.item.id)).toEqual(["net"]);
    expect(lines[0]).toMatchObject({ rule: 90000, budget: 90000, actual: null });
    expect(lines[0].parts!.map((l) => l.item.id).sort()).toEqual(["sal", "tax"]); // the bonus is not due: it counts as 0
    expect(monthLines(all, [], [], "2026-03")[0].budget).toBe(140000);
    expect(totals(lines, "income").budget).toBe(90000);
    expect(totals(lines, "expense").budget).toBe(0);
    expect(withParts(lines).map((l) => l.item.id).sort()).toEqual(["net", "sal", "tax"]);
  });

  it("takes its actual from its parts' actuals, unless one is typed for it", () => {
    const e = (item_id: string, over: Partial<MoneyEntry>): MoneyEntry => ({ item_id, month: "2026-02-01", budget: null, actual: null, paid_at: null, skipped: false, ...over });
    expect(monthLines(all, [e("sal", { actual: 98000 })], [], "2026-02")[0]).toMatchObject({ actual: 88000, derived: true, budget: 90000 });
    expect(monthLines(all, [e("sal", { actual: 98000 }), e("net", { actual: 87500 })], [], "2026-02")[0]).toMatchObject({ actual: 87500, derived: false });
    expect(monthLines(all, [e("tax", { skipped: true })], [], "2026-02")[0].budget).toBe(100000);
    expect(monthLines(all, [e("sal", { budget: 80000 })], [], "2026-02")[0].budget).toBe(70000);
  });

  it("nests, and shows ₹0 with a reason when it cannot be worked out", () => {
    const half = item({ id: "half", name: "Half", amount: 0, start_date: "2026-01-01", formula: [it_("net"), o("*"), { t: "pct", v: 50 }] });
    const nested = monthLines([...all, half], [], [], "2026-02");
    expect(nested.map((l) => l.item.id)).toEqual(["half"]);
    expect(nested[0].budget).toBe(45000);
    expect(nested[0].parts![0].parts).toHaveLength(2);
    const under = item({ id: "u", name: "Under", amount: 0, start_date: "2026-01-01", formula: [it_("tax"), o("-"), it_("sal")] });
    expect(monthLines([salary, tax, under], [], [], "2026-02")[0]).toMatchObject({ budget: 0, warn: "Its formula comes to less than zero." });
    const gone = item({ id: "g", name: "Gone", amount: 0, start_date: "2026-01-01", formula: [it_("tax"), o("+"), it_("nobody")] });
    expect(monthLines([tax, gone], [], [], "2026-02")[0]).toMatchObject({ budget: 10000, warn: "Its formula uses an item that is gone." });
    const split = item({ id: "s", name: "Split", amount: 0, start_date: "2026-01-01", formula: [it_("tax"), o("/"), it_("bon")] });
    expect(monthLines([tax, bonus, split], [], [], "2026-02")[0]).toMatchObject({ budget: 0, warn: "Its formula divides by zero." });
  });

  it("refuses a formula that comes back to itself", () => {
    expect(formulaLoops("sal", [it_("net")], all)).toBe(true);
    expect(formulaLoops("net", [it_("net")], all)).toBe(true);
    expect(formulaLoops("new", [it_("net"), o("+"), it_("sal")], all)).toBe(false);
  });
});

describe("what a month leaves open", () => {
  it("asks about last month's lines that were neither settled nor skipped, and carries a repeating one as a one-time item", () => {
    const rent = item({ id: "rent", name: "Rent" });
    const gym = item({ id: "gym", name: "Gym" });
    const net = item({ id: "net", name: "Internet" });
    const gift = item({ id: "gift", name: "Gift", freq: "once", start_date: "2026-10-20" });
    const entries: MoneyEntry[] = [
      { item_id: "rent", month: "2026-10-01", budget: null, actual: 1200, paid_at: null, skipped: false },
      { item_id: "gym", month: "2026-10-01", budget: null, actual: null, paid_at: "2026-10-15T00:00:00Z", skipped: false },
      { item_id: "net", month: "2026-10-01", budget: null, actual: null, paid_at: null, skipped: true },
      { item_id: "gym", month: "2026-09-01", budget: null, actual: null, paid_at: null, skipped: false }, // older months are not asked about
    ];
    const open = carryOver([rent, gym, net, gift], entries, [], "2026-11");
    expect(open.map((l) => l.item.id).sort()).toEqual(["gift", "rent"]);
    const rentLine = open.find((l) => l.item.id === "rent")!;
    expect(carried(rentLine, "2026-10", "2026-11-03")).toMatchObject({ name: "Rent (October)", amount: 1200, freq: "once", start_date: "2026-11-03", end_date: null, increase_id: null });
  });
});

describe("lines moved by hand", () => {
  const line = (id: string, sort_order?: number | null) => ({ item: { id, sort_order } });
  it("puts placed lines first by their place, and leaves the rest as they came", () => {
    expect(byPlace([line("a"), line("b", 1), line("c", null), line("d", 0)]).map((l) => l.item.id)).toEqual(["d", "b", "a", "c"]);
    expect(byPlace([line("a"), line("b")]).map((l) => l.item.id)).toEqual(["a", "b"]);
  });
  it("moves one id to a place, never past either end", () => {
    expect(movedTo(["a", "b", "c"], "c", 0)).toEqual(["c", "a", "b"]);
    expect(movedTo(["a", "b", "c"], "a", 1)).toEqual(["b", "a", "c"]);
    expect(movedTo(["a", "b", "c"], "a", 9)).toEqual(["b", "c", "a"]);
    expect(movedTo(["a", "b", "c"], "b", -3)).toEqual(["b", "a", "c"]);
  });
});

describe("items offered one a name", () => {
  const item = (name: string, start_date: string, freq: "once" | "monthly" = "once") => ({ name, freq, start_date, end_date: null });
  it("keeps the one due this month, else the one that started last", () => {
    const got = oneAName([item("Temple", "2026-09-05"), item("Temple", "2026-11-05"), item("temple ", "2026-12-05"), item("Rent", "2025-01-01", "monthly"), item("Car", "2026-01-10"), item("Car", "2026-06-10")], "2026-11");
    expect(got.map((i) => `${i.name}|${i.start_date}`)).toEqual(["Temple|2026-11-05", "Rent|2025-01-01", "Car|2026-06-10"]);
  });
});

describe("a formula over an item that comes now and then", () => {
  const o = (v: "+" | "-" | "*" | "/"): FormulaToken => ({ t: "op", v });
  const temple = (id: string, start_date: string, amount: number) => item({ id, name: "Temple", freq: "once", start_date, amount });
  const jan = temple("t1", "2026-01-05", 5000), mar = temple("t3", "2026-03-05", 8000);
  const rent = item({ id: "rent", name: "Rent", amount: 20000, start_date: "2026-01-01" });
  const home = item({ id: "home", name: "Home", amount: 0, start_date: "2026-01-01", formula: [{ t: "item", id: "rent" }, o("+"), { t: "item", id: "t1" }] });
  const all = [jan, mar, rent, home];

  it("uses what the item of that name comes to in each month", () => {
    expect(monthLines(all, [], [], "2026-01").map((l) => [l.item.id, l.budget])).toEqual([["home", 25000]]);
    expect(monthLines(all, [], [], "2026-02").map((l) => [l.item.id, l.budget])).toEqual([["home", 20000]]);
    expect(monthLines(all, [], [], "2026-03").map((l) => [l.item.id, l.budget])).toEqual([["home", 28000]]);
    expect(monthLines(all, [], [], "2026-03")[0].parts?.map((p) => p.item.id)).toEqual(["rent", "t3"]);
  });

  it("leaves a one-time item of another bank or name as a line of its own", () => {
    const other = item({ id: "x", name: "Temple", freq: "once", start_date: "2026-03-09", amount: 700, bank_id: "b2" });
    expect(monthLines([...all, other], [], [], "2026-03").map((l) => l.item.id).sort()).toEqual(["home", "x"]);
  });
});

import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { billReminders } from "@/lib/money-reminders";
import type { MoneyEntry, MoneyItem } from "@/lib/money";

const item = (over: Partial<MoneyItem & { user_id: string }>): MoneyItem & { user_id: string } => ({
  id: "wifi", user_id: "me", kind: "expense", name: "Wifi bill", amount: 1499, freq: "monthly", start_date: "2026-01-24", end_date: null,
  bank_id: "b1", type_id: null, increase_id: null, person_ids: [], notes: null, ...over,
});
const plan = (items: (MoneyItem & { user_id: string })[], nowIso: string, extra: { entries?: MoneyEntry[]; recipients?: (i: MoneyItem & { user_id: string }) => string[]; zones?: Record<string, string> } = {}) =>
  billReminders({
    items, entries: extra.entries ?? [], increases: [], now: DateTime.fromISO(nowIso, { zone: "utc" }),
    recipients: extra.recipients ?? ((i) => [i.user_id]),
    zoneOf: (u) => extra.zones?.[u] ?? "Asia/Kolkata",
    bankName: (id) => (id === "b1" ? "HDFC Bank" : undefined),
  });

describe("bill reminders", () => {
  it("plans tomorrow's bill for 9 in the morning, in the person's own time zone", () => {
    // 23 November, 6 PM in India. The bill is due on the 24th: 9 AM IST is 03:30 UTC.
    expect(plan([item({})], "2026-11-23T12:30:00Z")).toEqual([{
      user_id: "me", money_ref: "bill:wifi:2026-11-24", send_at: "2026-11-24T03:30:00.000Z",
      title: "Wifi bill is due today", body: "₹1,499 from HDFC Bank. Open Planner to mark it paid.",
    }]);
  });
  it("sends at once when the day's 9 AM has already passed", () => {
    const [r] = plan([item({})], "2026-11-24T10:00:00Z"); // 3:30 PM in India on the due date
    expect(r.send_at).toBe("2026-11-24T10:00:00.000Z");
    expect(r.money_ref).toBe("bill:wifi:2026-11-24");
  });
  it("plans nothing for a bill that is not due today or tomorrow", () => {
    expect(plan([item({})], "2026-11-20T12:00:00Z")).toEqual([]);
    expect(plan([item({})], "2026-11-25T12:00:00Z")).toEqual([]);
  });
  it("leaves out paid and skipped months, incomes, and daily items", () => {
    const paid: MoneyEntry = { item_id: "wifi", month: "2026-11-01", budget: null, actual: null, paid_at: "2026-11-20T00:00:00Z", skipped: false };
    expect(plan([item({})], "2026-11-23T12:30:00Z", { entries: [paid] })).toEqual([]);
    expect(plan([item({})], "2026-11-23T12:30:00Z", { entries: [{ ...paid, paid_at: null, skipped: true }] })).toEqual([]);
    expect(plan([item({ kind: "income" })], "2026-11-23T12:30:00Z")).toEqual([]);
    expect(plan([item({ freq: "daily" })], "2026-11-23T12:30:00Z")).toEqual([]);
  });
  it("uses the month's actual amount when one is entered, and names no bank when there is none", () => {
    const entry: MoneyEntry = { item_id: "wifi", month: "2026-11-01", budget: null, actual: 1620, paid_at: null, skipped: false };
    expect(plan([item({ bank_id: null })], "2026-11-23T12:30:00Z", { entries: [entry] })[0].body).toBe("₹1,620. Open Planner to mark it paid.");
  });
  it("tells each recipient, each by their own clock", () => {
    // 23 November 20:00 UTC: already the 24th in India, still the 23rd in New York.
    const rows = plan([item({})], "2026-11-23T20:00:00Z", { recipients: () => ["in", "ny"], zones: { in: "Asia/Kolkata", ny: "America/New_York" } });
    expect(rows.map((r) => [r.user_id, r.send_at])).toEqual([["in", "2026-11-24T03:30:00.000Z"], ["ny", "2026-11-24T14:00:00.000Z"]]);
  });
  it("tells nobody when an item has no recipients", () => {
    expect(plan([item({})], "2026-11-23T12:30:00Z", { recipients: () => [] })).toEqual([]);
  });
});

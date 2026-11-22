import { describe, expect, it } from "vitest";
import { choiceFromSeries, describeRule, expandRule, monthByChoices, storedRule, toRule, NO_REPEAT, type RepeatRule } from "@/lib/recurrence";
import { toInterval, isTaskOverdue } from "@/lib/time";
import { reminderLabel, reminderParts } from "@/lib/types";
import { DateTime } from "luxon";

describe("weekly recurrence", () => {
  it("expands selected weekdays up to the end date", () => {
    const occ = expandRule({
      freq: "weekly", every: 1, monthBy: "date",
      startDate: "2026-12-01", endDate: "2026-12-31", weekdays: [1, 3],
      startTime: "06:00", endTime: "08:00", timeZone: "Asia/Kolkata",
    });
    expect(occ.map((o) => o.date)).toEqual([
      "2026-12-02", "2026-12-07", "2026-12-09", "2026-12-14", "2026-12-16",
      "2026-12-21", "2026-12-23", "2026-12-28", "2026-12-30",
    ]);
    expect(occ[0].starts_at).toBe("2026-12-02T00:30:00.000Z");
  });
  it("keeps local time stable across DST", () => {
    const occ = expandRule({
      freq: "weekly", every: 1, monthBy: "date",
      startDate: "2026-10-19", endDate: "2026-11-09", weekdays: [1],
      startTime: "06:00", endTime: "08:00", timeZone: "Europe/London",
    });
    const local = occ.map((o) => DateTime.fromISO(o.starts_at).setZone("Europe/London").toFormat("HH:mm"));
    expect(new Set(local)).toEqual(new Set(["06:00"]));
  });
});

describe("intervals and tasks", () => {
  it("treats an end before start as next day", () => {
    const iv = toInterval("2026-12-05", "22:00", "01:00", "UTC");
    expect(iv.nextDay).toBe(true);
    expect(iv.end.toISO()).toContain("2026-12-06T01:00");
  });
  it("derives overdue state", () => {
    const now = DateTime.fromISO("2026-12-03T19:00", { zone: "Asia/Kolkata" });
    expect(isTaskOverdue({ state: "pending", due_date: "2026-12-03", due_time: "18:30" }, "Asia/Kolkata", now)).toBe(true);
    expect(isTaskOverdue({ state: "pending", due_date: "2026-12-03", due_time: null }, "Asia/Kolkata", now)).toBe(false);
    expect(isTaskOverdue({ state: "completed", due_date: "2026-12-01", due_time: null }, "Asia/Kolkata", now)).toBe(false);
  });
});

describe("repeat rules", () => {
  const base: RepeatRule = { freq: "daily", every: 1, weekdays: [], monthBy: "date", startDate: "2026-11-24", startTime: "09:00", endTime: "10:00", timeZone: "Asia/Kolkata" };
  const dates = (r: Partial<RepeatRule>) => expandRule({ ...base, ...r }).map((o) => o.date);

  it("repeats daily, and every few days", () => {
    expect(dates({ endDate: "2026-11-27" })).toEqual(["2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27"]);
    expect(dates({ every: 3, count: 3 })).toEqual(["2026-11-24", "2026-11-27", "2026-11-30"]);
  });
  it("skips weeks when every is above one, and never goes before the start", () => {
    // 24 Nov 2026 is a Tuesday: that week's Monday is before the start, so it is left out.
    expect(dates({ freq: "weekly", every: 2, weekdays: [1, 2], count: 4 })).toEqual(["2026-11-24", "2026-12-07", "2026-12-08", "2026-12-21"]);
  });
  it("repeats monthly on the date, skipping months without it", () => {
    expect(dates({ freq: "monthly", startDate: "2027-01-31", count: 4 })).toEqual(["2027-01-31", "2027-03-31", "2027-05-31", "2027-07-31"]);
  });
  it("repeats monthly on the nth or the last weekday", () => {
    expect(dates({ freq: "monthly", monthBy: "weekday", count: 3 })).toEqual(["2026-11-24", "2026-12-22", "2027-01-26"]); // 4th Tuesday
    expect(dates({ freq: "monthly", monthBy: "last", count: 3 })).toEqual(["2026-11-24", "2026-12-29", "2027-01-26"]); // last Tuesday
  });
  it("repeats yearly, and 29 February only in leap years", () => {
    expect(dates({ freq: "yearly", count: 3 })).toEqual(["2026-11-24", "2027-11-24", "2028-11-24"]);
    expect(dates({ freq: "yearly", startDate: "2028-02-29", endDate: "2036-12-31" })).toEqual(["2028-02-29", "2032-02-29", "2036-02-29"]);
    expect(dates({ freq: "yearly", monthBy: "weekday", count: 2 })).toEqual(["2026-11-24", "2027-11-23"]); // 4th Tuesday of November
  });
  it("needs an end, and stops at 200", () => {
    expect(dates({})).toEqual([]);
    expect(dates({ endDate: "2030-01-01" })).toHaveLength(200);
    expect(dates({ freq: "weekly", weekdays: [], count: 5 })).toEqual([]);
  });
  it("offers the month choices that fit the start date", () => {
    expect(monthByChoices("2026-11-24").map((c) => c.label)).toEqual(["On the 24th", "On the 4th Tuesday", "On the last Tuesday"]);
    expect(monthByChoices("2026-11-03").map((c) => c.label)).toEqual(["On the 3rd", "On the 1st Tuesday"]);
    expect(monthByChoices("2026-11-30").map((c) => c.label)).toEqual(["On the 30th", "On the last Monday"]);
  });
  it("describes a rule in words", () => {
    expect(describeRule({ ...base, every: 2 })).toBe("Every 2 days");
    expect(describeRule({ ...base, freq: "weekly", weekdays: [3, 1] })).toBe("Every week on Mon and Wed");
    expect(describeRule({ ...base, freq: "weekly", weekdays: [1, 2, 3, 4, 5] })).toBe("Every weekday, Monday to Friday");
    expect(describeRule({ ...base, freq: "monthly", every: 3, monthBy: "last" })).toBe("Every 3 months on the last Tuesday");
    expect(describeRule({ ...base, freq: "yearly" })).toBe("Every year on 24 November");
    expect(describeRule({ ...base, freq: "yearly", monthBy: "weekday" })).toBe("Every year on the 4th Tuesday of November");
  });
});

describe("reminder wording", () => {
  it("uses the largest unit that fits exactly", () => {
    expect([null, 0, 1, 15, 60, 90, 120, 1440, 2880, 10080].map(reminderLabel)).toEqual([
      "No reminder", "At start time", "1 minute before", "15 minutes before", "1 hour before",
      "90 minutes before", "2 hours before", "1 day before", "2 days before", "7 days before",
    ]);
    expect(reminderParts(180)).toEqual({ amount: 3, unit: "hours" });
    expect(reminderParts(0)).toBeNull();
  });
});

describe("repeat choices", () => {
  it("round-trips through what is stored with a series", () => {
    const choice = { ...NO_REPEAT, freq: "monthly" as const, every: 2, monthBy: "last" as const, ends: "after" as const, count: 6 };
    const stored = storedRule(choice, "2026-11-24");
    expect(stored).toEqual({ freq: "monthly", every: 2, weekdays: [], monthBy: "last", count: 6 });
    // Loaded for editing, it ends on the series' last date instead of a count.
    expect(choiceFromSeries({ rule: stored, weekdays: [], end_date: "2027-09-28" })).toEqual({ freq: "monthly", every: 2, weekdays: [], monthBy: "last", ends: "on", until: "2027-09-28", count: 10 });
  });
  it("reads a series from before rules were stored as weekly", () => {
    expect(choiceFromSeries({ rule: null, weekdays: [1, 3], end_date: "2026-12-31" })).toMatchObject({ freq: "weekly", every: 1, weekdays: [1, 3], until: "2026-12-31" });
  });
  it("falls back to the date when the month choice no longer fits", () => {
    // "The last Tuesday" was chosen on the 24th; on the 3rd there is no such choice.
    expect(toRule({ ...NO_REPEAT, freq: "monthly", monthBy: "last", until: "2027-03-01" }, "2026-11-03", "09:00", "10:00", "UTC").monthBy).toBe("date");
  });
});

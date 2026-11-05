import { describe, expect, it } from "vitest";
import { expandWeekly } from "@/lib/recurrence";
import { toInterval, isTaskOverdue } from "@/lib/time";
import { DateTime } from "luxon";

describe("weekly recurrence", () => {
  it("expands selected weekdays up to the end date", () => {
    const occ = expandWeekly({
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
    const occ = expandWeekly({
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

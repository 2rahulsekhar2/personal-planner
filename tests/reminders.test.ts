import { describe, expect, it } from "vitest";
import { MAX_REMINDERS, minutesBefore, reminderShort, splitReminders, tidyReminders } from "@/lib/types";

describe("several reminders", () => {
  it("drops repeats and blanks, sorts, and keeps no more than the most allowed", () => {
    expect(tidyReminders([1440, null, 60, 60, undefined, 0])).toEqual([0, 60, 1440]);
    expect(tidyReminders([7, 6, 5, 4, 3, 2, 1])).toHaveLength(MAX_REMINDERS);
    expect(tidyReminders(["2026-11-27T03:30:00.000Z", "2026-11-26T03:30:00.000Z", "2026-11-27T03:30:00.000Z"]))
      .toEqual(["2026-11-26T03:30:00.000Z", "2026-11-27T03:30:00.000Z"]);
  });

  it("puts the first in the old column and the others beside it", () => {
    expect(splitReminders([0, 60, 1440])).toEqual({ first: 0, rest: [60, 1440] });
    expect(splitReminders([15])).toEqual({ first: 15, rest: [] });
    expect(splitReminders([])).toEqual({ first: null, rest: [] });
  });

  it("reads a task's stored reminder time as minutes before it is due", () => {
    expect(minutesBefore("2026-11-27T03:30:00.000Z", "2026-11-27T02:30:00+00:00")).toBe(60);
    expect(minutesBefore("2026-11-27T03:30:00.000Z", "2026-11-26T03:30:00.000Z")).toBe(1440);
    expect(minutesBefore("2026-11-27T03:30:00.000Z", "2026-11-27T05:00:00.000Z")).toBe(0);
  });

  it("names a reminder briefly for a chip", () => {
    expect([0, 15, 60, 90, 1440, 2880].map(reminderShort)).toEqual(["At start", "15 min", "1 h", "90 min", "1 d", "2 d"]);
  });
});

import { describe, expect, it } from "vitest";
import { weekFromToday } from "@/lib/time";

describe("weekFromToday", () => {
  const tz = "Asia/Kolkata", today = "2026-11-21"; // a Saturday
  const start = (d: string) => weekFromToday(d, tz, today).toISODate();

  it("starts today's block on today", () => {
    expect(start("2026-11-21")).toBe("2026-11-21");
    expect(start("2026-11-27")).toBe("2026-11-21");
  });
  it("steps in whole weeks either side, with no gaps or overlaps", () => {
    expect(start("2026-11-28")).toBe("2026-11-28");
    expect(start("2026-11-20")).toBe("2026-11-14");
    expect(start("2026-11-14")).toBe("2026-11-14");
    expect(start("2026-11-13")).toBe("2026-11-07");
  });
});

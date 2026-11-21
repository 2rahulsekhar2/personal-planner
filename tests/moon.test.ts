import { describe, expect, it } from "vitest";
import { moonPhase } from "@/lib/moon";

describe("moonPhase", () => {
  it("is near 0 at a known new moon and near 0.5 at a known full moon", () => {
    const newMoon = moonPhase(new Date(Date.UTC(2024, 3, 8, 18, 21))); // 2024-04-08 total solar eclipse
    const fullMoon = moonPhase(new Date(Date.UTC(2024, 3, 23, 23, 49)));
    expect(Math.min(newMoon, 1 - newMoon)).toBeLessThan(0.03);
    expect(Math.abs(fullMoon - 0.5)).toBeLessThan(0.03);
  });
});

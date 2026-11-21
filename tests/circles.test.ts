import { describe, expect, it } from "vitest";
import { expiryLabel, isOpen } from "@/lib/circles";

const now = Date.UTC(2026, 10, 21, 12);
const at = (hours: number) => new Date(now + hours * 3600000).toISOString();

describe("circle invites", () => {
  it("are open only while unused, undeclined and unexpired", () => {
    expect(isOpen({ expires_at: at(1), accepted_at: null, declined_at: null }, now)).toBe(true);
    expect(isOpen({ expires_at: at(-1), accepted_at: null, declined_at: null }, now)).toBe(false);
    expect(isOpen({ expires_at: at(1), accepted_at: at(-2), declined_at: null }, now)).toBe(false);
    expect(isOpen({ expires_at: at(1), accepted_at: null, declined_at: at(-2) }, now)).toBe(false);
  });
  it("say when they expire", () => {
    expect(expiryLabel(at(5), now)).toBe("Expires today");
    expect(expiryLabel(at(30), now)).toBe("Expires tomorrow");
    expect(expiryLabel(at(24 * 6 + 1), now)).toBe("Expires in 6 days");
  });
});

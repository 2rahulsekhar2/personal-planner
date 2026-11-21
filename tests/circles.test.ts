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

import { seatsOf } from "@/lib/circles";

describe("seatsOf", () => {
  it("puts the owner first, then orders by email, with a colour and initial each", () => {
    const seats = seatsOf({
      id: "c", name: "Family", owner_id: "b",
      circle_members: [
        { user_id: "a", email: "zed@x.com", role: "member" },
        { user_id: "b", email: "rahul@x.com", role: "owner" },
        { user_id: "c", email: "anu@x.com", role: "viewer" },
      ],
    });
    expect(seats.map((s) => s.user_id)).toEqual(["b", "c", "a"]);
    expect(seats.map((s) => s.letter)).toEqual(["R", "A", "Z"]);
    expect(new Set(seats.map((s) => s.color)).size).toBe(3);
  });
});

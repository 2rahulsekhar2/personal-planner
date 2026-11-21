import { describe, expect, it } from "vitest";
import { collapseActivity, describeActivity, type ActivityEntry } from "@/lib/activity";

const e = (over: Partial<ActivityEntry>): ActivityEntry => ({
  id: 1, user_id: "a", email: "anu@x.com", circle_id: null, kind: "task", action: "added", title: "Buy milk", created_at: "2026-11-21T10:00:00Z", ...over,
});

describe("activity", () => {
  it("reads as a sentence, with You for the signed-in user", () => {
    expect(describeActivity(e({}), "a")).toBe("You added task “Buy milk”");
    expect(describeActivity(e({ kind: "appointment", action: "not_done", title: "Gym" }), "b")).toBe("anu@x.com marked appointment “Gym” not done");
    expect(describeActivity(e({ kind: "circle", action: "removed", title: "Family" }), "a")).toBe("You were removed from circle “Family”");
    expect(describeActivity(e({ kind: "circle", action: "removed", title: "Family" }), "b")).toBe("anu@x.com was removed from circle “Family”");
  });
  it("folds a run of identical entries into one with a count", () => {
    const out = collapseActivity([e({ id: 3 }), e({ id: 2 }), e({ id: 1, action: "edited" })]);
    expect(out.map((x) => [x.id, x.count])).toEqual([[3, 2], [1, 1]]);
  });
});

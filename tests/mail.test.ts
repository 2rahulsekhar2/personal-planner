import { describe, expect, it } from "vitest";
import { buildInviteEmail } from "@/lib/mail";

const base = { to: "priya@x.in", circleName: "Family", inviterEmail: "rahul@x.in", role: "member", accessDays: null, link: "https://app.test/?invite=abc" };

describe("invite email", () => {
  it("names the circle, the inviter and the link", () => {
    const m = buildInviteEmail(base);
    expect(m.subject).toBe("rahul@x.in invited you to Family on Planner");
    expect(m.text).toContain("https://app.test/?invite=abc");
    expect(m.text).toContain("sign in with priya@x.in");
    expect(m.text).not.toContain("viewer");
  });
  it("says so for a viewer and for temporary access", () => {
    const m = buildInviteEmail({ ...base, role: "viewer", accessDays: 7 });
    expect(m.text).toContain("as a viewer");
    expect(m.text).toContain("lasts 7 days");
  });
  it("escapes a circle name in the HTML and keeps the subject on one line", () => {
    const m = buildInviteEmail({ ...base, circleName: '<img src=x onerror=alert(1)>\nBcc: a@b.c' });
    expect(m.html).not.toContain("<img");
    expect(m.html).toContain("&lt;img");
    expect(m.subject).not.toMatch(/[\r\n]/);
  });
});

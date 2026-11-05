import { describe, expect, it } from "vitest";
import { findConflicts } from "@/lib/conflicts";

const CRICKET = "cricket";
const HOSPITAL = "hospital";
const at = (h: number) => new Date(Date.UTC(2026, 11, 3, h)).toISOString();
const appt = (id: string, type: string, s: number, e: number, status = "confirmed") => ({
  id, activity_type_id: type, starts_at: at(s), ends_at: at(e), status,
});
const existing = [appt("x", CRICKET, 7, 9)];

describe("spec section 6.1 conflict table", () => {
  it("blocks partial same-activity overlap", () => {
    expect(findConflicts(appt("n", CRICKET, 8, 10), existing).blocking).toHaveLength(1);
  });
  it("blocks identical same-activity slot", () => {
    expect(findConflicts(appt("n", CRICKET, 7, 9), existing).blocking).toHaveLength(1);
  });
  it("allows back-to-back appointments", () => {
    const r = findConflicts(appt("n", CRICKET, 9, 11), existing);
    expect(r.blocking).toHaveLength(0);
    expect(r.warnings).toHaveLength(0);
  });
  it("warns for different activities", () => {
    const r = findConflicts(appt("n", HOSPITAL, 8, 9), existing);
    expect(r.blocking).toHaveLength(0);
    expect(r.warnings).toHaveLength(1);
  });
  it("tentative appointments still block", () => {
    expect(findConflicts(appt("n", CRICKET, 8, 10), [appt("x", CRICKET, 7, 9, "tentative")]).blocking).toHaveLength(1);
  });
  it("cancelled appointments never block or warn", () => {
    const r = findConflicts(appt("n", CRICKET, 8, 10), [appt("x", CRICKET, 7, 9, "cancelled"), appt("y", HOSPITAL, 7, 9, "cancelled")]);
    expect(r.blocking).toHaveLength(0);
    expect(r.warnings).toHaveLength(0);
  });
  it("ignores the appointment being edited", () => {
    expect(findConflicts(appt("x", CRICKET, 8, 10), existing).blocking).toHaveLength(0);
  });
});

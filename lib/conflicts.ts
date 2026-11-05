export interface Slot {
  id?: string;
  activity_type_id: string;
  starts_at: string;
  ends_at: string;
  status: string;
}

export interface ConflictResult<T extends Slot> {
  /** Same activity type: saving is not allowed. */
  blocking: T[];
  /** Different activity type: saving allowed after an explicit confirmation. */
  warnings: T[];
}

/** Half-open intervals: an appointment ending exactly when another starts does not overlap. */
export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && aEnd > bStart;
}

export function findConflicts<T extends Slot>(
  candidate: Slot,
  existing: T[],
  excludeIds: string[] = [],
): ConflictResult<T> {
  const result: ConflictResult<T> = { blocking: [], warnings: [] };
  if (candidate.status === "cancelled") return result;
  const cs = Date.parse(candidate.starts_at);
  const ce = Date.parse(candidate.ends_at);
  for (const e of existing) {
    if (e.status === "cancelled") continue;
    if (e.id && (e.id === candidate.id || excludeIds.includes(e.id))) continue;
    if (!overlaps(cs, ce, Date.parse(e.starts_at), Date.parse(e.ends_at))) continue;
    if (e.activity_type_id === candidate.activity_type_id) result.blocking.push(e);
    else result.warnings.push(e);
  }
  return result;
}

/** Postgres exclusion-constraint violation raised by the backend overlap rule. */
export function isOverlapError(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  return err.code === "23P01" || /appointment_same_activity_overlap/.test(err.message ?? "");
}

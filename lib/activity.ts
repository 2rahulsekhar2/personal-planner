// One row of activity_log (supabase/migrations/0007_activity.sql).
export interface ActivityEntry {
  id: number;
  user_id: string;
  email: string;
  circle_id: string | null;
  kind: "appointment" | "task" | "circle";
  action: string;
  title: string;
  created_at: string;
}

// What each action reads as; {x} is the item, for example: task “Buy milk”.
const PHRASES: Record<string, string> = {
  added: "added {x}",
  edited: "edited {x}",
  rescheduled: "rescheduled {x}",
  cancelled: "cancelled {x}",
  deleted: "deleted {x}",
  shared: "shared {x}",
  unshared: "stopped sharing {x}",
  done: "marked {x} done",
  not_done: "marked {x} not done",
  completed: "completed {x}",
  dismissed: "dismissed {x}",
  pending: "reopened {x}",
  created: "created {x}",
  joined: "joined {x}",
  left: "left {x}",
};

/** "You added task “Buy milk”", "anu@x.com joined circle “Family”". */
export function describeActivity(e: ActivityEntry, myId: string | null): string {
  const mine = e.user_id === myId;
  const phrase = e.action === "removed" ? `${mine ? "were" : "was"} removed from {x}` : (PHRASES[e.action] ?? `${e.action} {x}`);
  return `${mine ? "You" : e.email} ${phrase.replace("{x}", `${e.kind} “${e.title}”`)}`;
}

/** Folds a run of the same thing (a recurring series adds one row per date) into one entry with a count. */
export function collapseActivity(rows: ActivityEntry[]): (ActivityEntry & { count: number })[] {
  const out: (ActivityEntry & { count: number })[] = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (last && last.user_id === r.user_id && last.kind === r.kind && last.action === r.action && last.title === r.title && last.circle_id === r.circle_id) last.count++;
    else out.push({ ...r, count: 1 });
  }
  return out;
}

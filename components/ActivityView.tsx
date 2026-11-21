"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DateTime } from "luxon";
import type { PlannerCtx } from "./usePlanner";
import type { Circle } from "@/lib/circles";
import { collapseActivity, describeActivity, type ActivityEntry } from "@/lib/activity";
import { fmtTime, relativeDayLabel } from "@/lib/time";

// shortcut: shows the newest 200 entries for the chosen filters, add paging when someone needs to look further back
const LIMIT = 200;

// Who did what: your own activity, plus everything in the circles you belong to.
export default function ActivityView({ ctx, circles }: { ctx: PlannerCtx; circles: Circle[] }) {
  const { supabase, userId, email, tz } = ctx;
  const [circleId, setCircleId] = useState<string | null>(null); // null: all activity
  const [person, setPerson] = useState(""); // "": everyone
  const [rows, setRows] = useState<ActivityEntry[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Everyone seen in loaded entries, so people who have since left a circle can still be picked.
  const [seen, setSeen] = useState<Pick<ActivityEntry, "user_id" | "email" | "circle_id">[]>([]);

  // The people to pick from: the chosen circle's members, or everyone across my circles. Always me.
  const people = useMemo(() => {
    const byId = new Map<string, string>();
    if (userId) byId.set(userId, "You");
    for (const c of circles) {
      if (circleId && c.id !== circleId) continue;
      for (const m of c.circle_members) if (!byId.has(m.user_id)) byId.set(m.user_id, m.email);
    }
    for (const e of seen) if ((!circleId || e.circle_id === circleId) && !byId.has(e.user_id)) byId.set(e.user_id, e.email);
    return [...byId].map(([id, label]) => ({ id, label }));
  }, [circles, circleId, userId, seen]);

  const load = useCallback(async () => {
    let q = supabase.from("activity_log").select("id, user_id, email, circle_id, kind, action, title, created_at");
    if (circleId) q = q.eq("circle_id", circleId);
    if (person) q = q.eq("user_id", person);
    const { data, error } = await q.order("id", { ascending: false }).limit(LIMIT);
    // 42P01 / PGRST205: the table does not exist yet.
    setMissing(error?.code === "42P01" || error?.code === "PGRST205");
    setError(error ? error.message : null);
    const got = (data ?? []) as ActivityEntry[];
    setRows(got);
    setSeen((old) => {
      const add = got.filter((e, i) => ![...old, ...got.slice(0, i)].some((x) => x.user_id === e.user_id && x.circle_id === e.circle_id));
      return add.length ? [...old, ...add] : old;
    });
  }, [supabase, circleId, person]);

  useEffect(() => {
    load();
  }, [load]);

  const pickCircle = (id: string | null) => {
    setCircleId(id);
    // Keep the person only if they are, or were, in the circle being opened.
    const there = (x: { user_id: string }) => x.user_id === person;
    if (id && person && !circles.find((c) => c.id === id)?.circle_members.some(there) && !seen.some((e) => e.circle_id === id && there(e))) setPerson("");
  };

  // Newest first, under a heading per day.
  const days = useMemo(() => {
    const out: { date: string; items: ReturnType<typeof collapseActivity> }[] = [];
    for (const e of collapseActivity(rows ?? [])) {
      const date = DateTime.fromISO(e.created_at).setZone(tz).toISODate()!;
      if (out[out.length - 1]?.date === date) out[out.length - 1].items.push(e);
      else out.push({ date, items: [e] });
    }
    return out;
  }, [rows, tz]);

  const circleName = (id: string | null) => circles.find((c) => c.id === id)?.name;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Activity</h1>
      </div>
      <p className="hint">What you have done, and what members have done with items shared in your circles. Private items of other people never show here.</p>

      <div className="row">
        <div className="chips grow" role="group" aria-label="Filter by circle">
          <button className={`chip chip-sm ${!circleId ? "is-selected" : ""}`} aria-pressed={!circleId} onClick={() => pickCircle(null)}>All activity</button>
          {circles.map((c) => (
            <button key={c.id} className={`chip chip-sm ${circleId === c.id ? "is-selected" : ""}`} aria-pressed={circleId === c.id} onClick={() => pickCircle(c.id)}>{c.name}</button>
          ))}
        </div>
        <select aria-label="Filter by person" value={person} onChange={(e) => setPerson(e.target.value)}>
          <option value="">Everyone</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </div>

      {missing && <div className="alert alert-warn">Activity needs a one-time database update: run supabase/migrations/0007_activity.sql in the Supabase SQL editor, then reload.</div>}
      {error && !missing && <div className="alert alert-error" role="alert">Couldn’t load activity: {error}. <button className="link" onClick={load}>Retry</button></div>}

      {days.map((d) => (
        <section key={d.date}>
          <h2 className="section-title">{relativeDayLabel(d.date, tz)}</h2>
          <ul className="card list">
            {d.items.map((e) => (
              <li key={e.id} className="list-row">
                <span className="avatar avatar-sm" aria-hidden>{(e.user_id === userId ? email ?? e.email : e.email)[0].toUpperCase()}</span>
                <span className="grow circle-who">
                  <span>{describeActivity(e, userId)}{e.count > 1 ? ` (${e.count} times)` : ""}</span>
                  <span className="muted">{fmtTime(e.created_at, tz)}{circleName(e.circle_id) ? ` · ${circleName(e.circle_id)}` : ""}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {rows && !error && rows.length === 0 && <p className="empty">Nothing here yet.</p>}
      {rows?.length === LIMIT && <p className="hint">Showing the latest {LIMIT} entries. Use the filters to narrow down.</p>}
    </div>
  );
}

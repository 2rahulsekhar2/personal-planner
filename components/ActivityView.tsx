"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DateTime } from "luxon";
import type { PlannerCtx } from "./usePlanner";
import { seatsOf, type Circle } from "@/lib/circles";
import { collapseActivity, describeActivity, type ActivityEntry } from "@/lib/activity";
import { fmtTime, relativeDayLabel } from "@/lib/time";
import type { Hit } from "./SearchDialog";
import type { Appointment, Task } from "@/lib/types";

const svg = (d: string) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;
// What kind of thing an entry is about, as a picture.
const KIND_ICON = {
  appointment: svg("M4 6.5h16v13H4zM8 3.5v5M16 3.5v5M4 11h16"),
  task: svg("M5 12.5l4.5 4.5L19 7.5"),
  circle: svg("M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M17 11a3 3 0 1 0 0-6M18 14.6a5.5 5.5 0 0 1 3.5 5.4"),
};
// How it ended: something gained or finished, something taken away, or a plain change.
const toneOf = (action: string) =>
  ["added", "created", "joined", "shared", "done", "completed"].includes(action) ? "good"
    : ["deleted", "cancelled", "dismissed", "removed", "left", "unshared", "not_done"].includes(action) ? "gone" : "plain";

// shortcut: shows the newest 200 entries for the chosen filters, add paging when someone needs to look further back
const LIMIT = 200;

// Who did what: your own activity, plus everything in the circles you belong to.
export default function ActivityView({ ctx, circles, onOpen }: { ctx: PlannerCtx; circles: Circle[]; onOpen: (h: Hit) => void }) {
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

  // A log row keeps only the title, so find the item by it: of several with that title (a repeat), the one
  // created or changed nearest the moment logged.
  const open = async (e: ActivityEntry) => {
    if (e.kind === "circle") return e.circle_id && circles.some((c) => c.id === e.circle_id) ? onOpen({ kind: "circle", id: e.circle_id, name: e.title }) : ctx.toast("info", `You are no longer in “${e.title}”`);
    const table = e.kind === "appointment" ? "appointments" : "tasks";
    const find = (fields: string) => supabase.from(table).select(fields).eq("title", e.title).limit(100);
    let res = await find(e.kind === "appointment" ? "*, participants:appointment_participants(user_id, reply)" : "*");
    if (res.error) res = await find("*");
    if (res.error) return ctx.toast("error", `Couldn’t open it: ${res.error.message}`);
    const at = Date.parse(e.created_at);
    const gap = (x: { created_at?: string; updated_at?: string }) => Math.min(...[x.created_at, x.updated_at].map((t) => (t ? Math.abs(Date.parse(t) - at) : Infinity)));
    const rows = (res.data ?? []) as unknown as ((Appointment | Task) & { created_at?: string; updated_at?: string })[];
    const best = rows.sort((a, b) => gap(a) - gap(b))[0];
    if (!best) return ctx.toast("info", `That ${e.kind} has since been deleted`);
    onOpen(e.kind === "appointment" ? { kind: "appt", appt: best as Appointment } : { kind: "task", task: best as Task });
  };

  const circleName = (id: string | null) => circles.find((c) => c.id === id)?.name;
  // A person keeps the colour of their seat in a circle; someone in none of mine gets the plain one.
  const colorOf = useMemo(() => new Map(circles.flatMap((c) => seatsOf(c).map((m) => [m.user_id, m.color] as const))), [circles]);

  return (
    <div className="page">
      <div className="page-head"><h1>History</h1></div>

      <div className="hist-filters">
        <div className="chips" role="group" aria-label="Filter by circle">
          <button className={`chip chip-sm ${!circleId ? "is-selected" : ""}`} aria-pressed={!circleId} onClick={() => pickCircle(null)}>All</button>
          {circles.map((c) => (
            <button key={c.id} className={`chip chip-sm ${circleId === c.id ? "is-selected" : ""}`} aria-pressed={circleId === c.id} onClick={() => pickCircle(c.id)}>{c.name}</button>
          ))}
        </div>
        {/* Who: a face each. Press one to see only that person, press it again for everyone. */}
        {people.length > 1 && (
          <div className="scope-faces" role="group" aria-label="Filter by person">
            {people.map((p) => (
              <button key={p.id} className={`face act-${colorOf.get(p.id) ?? "slate"} ${person && person !== p.id ? "is-off" : ""}`} aria-pressed={person === p.id} aria-label={`Only ${p.label}`} title={p.label} onClick={() => setPerson(person === p.id ? "" : p.id)}>
                {(p.id === userId ? email ?? "Y" : p.label)[0].toUpperCase()}
              </button>
            ))}
          </div>
        )}
      </div>

      {missing && <div className="alert alert-warn">History needs a one-time database update: run supabase/migrations/0007_activity.sql in the Supabase SQL editor, then reload.</div>}
      {error && !missing && <div className="alert alert-error" role="alert">Couldn’t load history: {error}. <button className="link" onClick={load}>Retry</button></div>}

      {days.map((d) => (
        <section key={d.date} className="hist-day">
          <h2>{relativeDayLabel(d.date, tz)}</h2>
          {/* A line down the day, a mark for each thing done: its picture says what kind, its colour how it ended. */}
          <ol className="hist">
            {d.items.map((e) => (
              <li key={e.id}>
                <span className={`hist-mark is-${toneOf(e.action)}`} aria-hidden>{KIND_ICON[e.kind]}</span>
                <button className="grow hist-what hist-open" onClick={() => open(e)}>
                  <span><strong>{e.user_id === userId ? "You" : e.email.split("@")[0]}</strong> {describeActivity(e, userId).replace(/^\S+ /, "")}{e.count > 1 && <span className="hist-count">×{e.count}</span>}</span>
                  {/* An entry about a circle already names it. */}
                  {e.kind !== "circle" && circleName(e.circle_id) && <span className="kit-sub">{circleName(e.circle_id)}</span>}
                </button>
                <span className="hist-time">{fmtTime(e.created_at, tz)}</span>
              </li>
            ))}
          </ol>
        </section>
      ))}
      {rows && !error && rows.length === 0 && <p className="empty">Nothing here yet.</p>}
      {rows?.length === LIMIT && <p className="hint">Showing the latest {LIMIT}. Filter to narrow down.</p>}
      {rows && rows.length > 0 && <p className="hint">Other people’s private items never show here.</p>}
    </div>
  );
}

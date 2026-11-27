"use client";
import { useEffect, useRef, useState } from "react";
import { DateTime } from "luxon";
import type { PlannerCtx } from "./usePlanner";
import type { MoneyCtx } from "./useMoney";
import type { Appointment, Task } from "@/lib/types";
import type { Circle } from "@/lib/circles";
import type { MoneyItem } from "@/lib/money";

export type Hit =
  | { kind: "appt"; appt: Appointment }
  | { kind: "task"; task: Task }
  | { kind: "type"; id: string; name: string }
  | { kind: "place"; id: string; name: string }
  | { kind: "circle"; id: string; name: string }
  | { kind: "money"; item: MoneyItem };

const SECTIONS: { kind: Hit["kind"]; label: string }[] = [
  { kind: "appt", label: "Appointments" },
  { kind: "task", label: "Tasks" },
  { kind: "money", label: "Money" },
  { kind: "type", label: "Activities" },
  { kind: "place", label: "Places" },
  { kind: "circle", label: "Circles" },
];

/** Searches everything the user can read: appointments and tasks in the database (any date), the rest from what is loaded. */
export default function SearchDialog({ ctx, money, circles, onPick, onClose }: {
  ctx: PlannerCtx; money: MoneyCtx; circles: Circle[]; onPick: (h: Hit) => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [q, setQ] = useState("");
  const [remote, setRemote] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);
  const run = useRef(0);
  const { supabase, tz, typeById, placeById } = ctx;

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  // Characters that would break a PostgREST filter, or act as wildcards, are searched as spaces.
  const term = q.replace(/[,()%*\\"]/g, " ").trim();
  const has = (...xs: (string | null | undefined)[]) => xs.some((x) => x?.toLowerCase().includes(term.toLowerCase()));

  useEffect(() => {
    const n = ++run.current;
    if (!term) { setRemote([]); setBusy(false); return; }
    setBusy(true);
    const t = setTimeout(async () => {
      const like = `%${term}%`;
      // An appointment also matches by the name of its activity or place.
      const typeIds = [...typeById.values()].filter((x) => has(x.name)).map((x) => x.id);
      const placeIds = [...placeById.values()].filter((x) => has(x.name)).map((x) => x.id);
      const ors = (cols: string[]) => [
        ...cols.map((c) => `${c}.ilike.${like}`),
        ...(typeIds.length ? [`activity_type_id.in.(${typeIds.join(",")})`] : []),
        ...(placeIds.length ? [`place_id.in.(${placeIds.join(",")})`] : []),
      ].join(",");
      const appts = (fields: string, cols: string[]) =>
        supabase.from("appointments").select(fields).or(ors(cols)).order("starts_at", { ascending: false }).limit(30);
      // Older databases lack the custom columns or the participants table: step back as usePlanner does.
      const full = ["title", "notes", "team", "custom_activity", "custom_place"];
      let a = await appts("*, participants:appointment_participants(user_id, reply)", full);
      if (a.error) a = await appts("*", full);
      if (a.error) a = await appts("*", full.slice(0, 3));
      const tk = await supabase.from("tasks").select("*").or(`title.ilike.${like},notes.ilike.${like}`).order("due_date", { ascending: false }).limit(30);
      if (n !== run.current) return; // a newer search has started
      if (a.error || tk.error) ctx.toast("error", `Search failed: ${(a.error ?? tk.error)!.message}`);
      setRemote([
        ...((a.data ?? []) as unknown as Appointment[]).map((appt): Hit => ({ kind: "appt", appt })),
        ...((tk.data ?? []) as unknown as Task[]).map((task): Hit => ({ kind: "task", task })),
      ]);
      setBusy(false);
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `has` follows `term`
  }, [term, supabase, typeById, placeById]);

  const local: Hit[] = !term ? [] : [
    ...ctx.types.filter((x) => has(x.name)).map((x): Hit => ({ kind: "type", id: x.id, name: x.name })),
    ...ctx.places.filter((x) => has(x.name, x.notes)).map((x): Hit => ({ kind: "place", id: x.id, name: x.name })),
    ...circles.filter((c) => has(c.name)).map((c): Hit => ({ kind: "circle", id: c.id, name: c.name })),
    ...(money.status === "on" ? money.items.filter((i) => has(i.name, i.notes)).sort((x, y) => y.start_date.localeCompare(x.start_date)).slice(0, 30).map((item): Hit => ({ kind: "money", item })) : []),
  ];
  const hits = [...remote, ...local];

  const label = (h: Hit): { title: string; sub?: string } => {
    if (h.kind === "appt") {
      const a = h.appt;
      const what = a.title || (a.activity_type_id && typeById.get(a.activity_type_id)?.name) || a.custom_activity || "Appointment";
      const where = (a.place_id && placeById.get(a.place_id)?.name) || a.custom_place;
      const when = DateTime.fromISO(a.starts_at, { zone: tz }).toFormat("ccc d LLL yyyy, HH:mm");
      return { title: what, sub: [when, where, a.status === "cancelled" ? "Cancelled" : null].filter(Boolean).join(" · ") };
    }
    if (h.kind === "task") {
      const t = h.task;
      const when = DateTime.fromISO(t.due_date).toFormat("ccc d LLL yyyy") + (t.due_time ? `, ${t.due_time.slice(0, 5)}` : "");
      return { title: t.title, sub: [when, t.state === "completed" ? "Done" : t.state === "dismissed" ? "Dismissed" : null].filter(Boolean).join(" · ") };
    }
    if (h.kind === "money") {
      const i = h.item;
      const from = DateTime.fromISO(i.start_date).toFormat("d LLL yyyy");
      return { title: i.name, sub: [i.kind === "expense" ? "Expense" : "Income", i.freq === "once" ? from : `from ${from}`, i.circle_id ? circles.find((c) => c.id === i.circle_id)?.name : null].filter(Boolean).join(" · ") };
    }
    return { title: h.name };
  };
  const keyOf = (h: Hit) => h.kind === "appt" ? h.appt.id : h.kind === "task" ? h.task.id : h.kind === "money" ? h.item.id : h.id;

  return (
    <dialog ref={ref} className="search-dialog" aria-label="Search" onClose={onClose} onClick={(e) => e.target === ref.current && onClose()}>
      <form className="search-head" onSubmit={(e) => { e.preventDefault(); if (hits[0]) onPick(hits[0]); }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
        <input type="search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search appointments, tasks, money, places…" aria-label="Search" />
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
      </form>
      <div className="search-results" aria-live="polite">
        {!term ? <p className="hint">Type to search everything in your planner.</p>
          : hits.length === 0 ? <p className="hint">{busy ? "Searching…" : `Nothing matches “${q.trim()}”.`}</p>
          : SECTIONS.map((s) => {
            const rows = hits.filter((h) => h.kind === s.kind);
            if (!rows.length) return null;
            return (
              <section key={s.kind}>
                <h3 className="search-section">{s.label}</h3>
                <ul>
                  {rows.map((h) => {
                    const l = label(h);
                    return (
                      <li key={keyOf(h)}>
                        <button className="search-hit" onClick={() => onPick(h)}>
                          <span>{l.title}</span>
                          {l.sub && <small className="muted">{l.sub}</small>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
      </div>
    </dialog>
  );
}

"use client";
import { DateTime } from "luxon";
import type { PlannerCtx } from "./usePlanner";
import { fmtClock, fmtRange, relativeDayLabel, weekFromToday, todayISO, isTaskOverdue, fmtShortTime } from "@/lib/time";
import { TaskChip, visibleAppointments } from "./WeekView";

export default function AgendaView({
  ctx, day, setDay, onOpen, onOpenTask, toggle,
}: {
  ctx: PlannerCtx;
  day: string;
  setDay: (d: string) => void;
  onOpen: (id: string) => void;
  onOpenTask: (id: string) => void;
  toggle: React.ReactNode;
}) {
  const { tz, typeById, placeById, tasks } = ctx;
  const d = DateTime.fromISO(day, { zone: tz });
  const dayStart = d.startOf("day");
  const dayEnd = dayStart.plus({ days: 1 });
  const today = todayISO(tz);
  const ws = weekFromToday(day, tz); // the strip starts at today, like the week view

  const items = visibleAppointments(ctx)
    .filter((a) => DateTime.fromISO(a.starts_at) < dayEnd && DateTime.fromISO(a.ends_at) > dayStart)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const dayTasks = tasks.filter((t) => t.due_date === day && t.state !== "dismissed");
  const overdue = day === today ? tasks.filter((t) => isTaskOverdue(t, tz) && t.due_date < day) : [];

  // Free gaps between active appointments, from 6 AM to 10 PM (or now, for today).
  const active = items.filter((a) => a.status !== "cancelled");
  const gaps: { from: DateTime; to: DateTime }[] = [];
  let cursor = dayStart.set({ hour: 6 });
  if (day === today) {
    const n = DateTime.now().setZone(tz).startOf("minute");
    if (n > cursor) cursor = n;
  }
  const limit = dayStart.set({ hour: 22 });
  for (const a of active) {
    const s = DateTime.fromISO(a.starts_at).setZone(tz);
    const e = DateTime.fromISO(a.ends_at).setZone(tz);
    if (s.diff(cursor, "minutes").minutes >= 30 && s <= limit) gaps.push({ from: cursor, to: s });
    if (e > cursor) cursor = e;
  }
  if (limit.diff(cursor, "minutes").minutes >= 30) gaps.push({ from: cursor, to: limit });

  type Row = { at: string; node: React.ReactNode };
  const rows: Row[] = [
    ...items.map((a) => {
      const t = typeById.get(a.activity_type_id ?? "");
      const p = a.place_id ? placeById.get(a.place_id) : null;
      return {
        at: a.starts_at,
        node: (
          <button key={a.id} className={`agenda-appt act-${t?.color ?? "slate"} status-${a.status} ${a.outcome ? `outcome-${a.outcome}` : ""}`} onClick={() => onOpen(a.id)}>
            <span className="agenda-time">{fmtRange(a.starts_at, a.ends_at, tz)}</span>
            <span className="agenda-title">
              {a.title}
              {a.status !== "confirmed" && <span className="tag">{a.status === "tentative" ? "Tentative" : "Cancelled"}</span>}
            </span>
            <span className="agenda-meta">
              <span className="type-label"><span className="swatch" aria-hidden />{t?.name ?? a.custom_activity}</span>
              {p && <span>· {p.name}</span>}
              {a.team && <span>· {a.team}</span>}
            </span>
          </button>
        ),
      };
    }),
    ...gaps.map((g) => ({
      at: g.from.toUTC().toISO()!,
      node: (
        <div key={"gap" + g.from.toISO()} className="agenda-gap">
          Free {fmtShortTime(g.from, tz)} – {fmtShortTime(g.to, tz)}
        </div>
      ),
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return (
    <div className="agenda">
      <div className="toolbar">
        <div className="toolbar-group">
          <button className="btn" onClick={() => setDay(d.minus({ days: 1 }).toISODate()!)} aria-label="Previous day">‹</button>
          <button className="btn" onClick={() => setDay(today)}>Today</button>
          <button className="btn" onClick={() => setDay(d.plus({ days: 1 }).toISODate()!)} aria-label="Next day">›</button>
        </div>
        <span className="toolbar-end">{toggle}</span>
      </div>

      <div className="daystrip" role="tablist" aria-label="Days this week">
        {Array.from({ length: 7 }, (_, i) => ws.plus({ days: i })).map((x) => {
          const iso = x.toISODate()!;
          return (
            <button key={iso} role="tab" aria-selected={iso === day} className={`daystrip-day ${iso === day ? "is-active" : ""} ${iso === today ? "is-today" : ""}`} onClick={() => setDay(iso)}>
              <span className="dow">{x.toFormat("ccc")}</span>
              <span className="dom">{x.toFormat("d")}</span>
            </button>
          );
        })}
      </div>

      <h1 className="agenda-heading">
        {relativeDayLabel(day, tz)} <span className="muted">{d.toFormat("cccc, d LLLL")}</span>
      </h1>

      {/* Tasks are plain rows: tap the circle to finish one, tap the row to open it. Overdue ones lead, in red. */}
      {overdue.length + dayTasks.length > 0 && (
        <section className="day-tasks">
          <h2 className="section-title">Tasks</h2>
          {[...overdue, ...dayTasks.filter((t) => !overdue.includes(t))].map((t) => {
            const late = isTaskOverdue(t, tz);
            const done = t.state !== "pending";
            return (
              <div key={t.id} className={`day-task ${late ? "is-overdue" : ""} ${done ? "is-done" : ""}`}>
                <button className="day-task-check" disabled={done} aria-label={done ? "Done" : `Mark “${t.title}” done`} onClick={() => ctx.completeTask(t)}>
                  {done && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>}
                </button>
                <button className="day-task-main" onClick={() => onOpenTask(t.id)}>
                  <span className="day-task-title">{t.title}</span>
                  <span className="day-task-when">{late ? `Overdue, ${t.due_date === day && t.due_time ? fmtClock(t.due_time) : relativeDayLabel(t.due_date, tz)}` : t.due_time ? fmtClock(t.due_time) : ""}</span>
                </button>
              </div>
            );
          })}
        </section>
      )}

      <section className="agenda-list">
        <h2 className="section-title">Appointments</h2>
        {items.length === 0 && <p className="empty">Nothing booked. The whole day is free.</p>}
        {rows.map((r) => r.node)}
      </section>
    </div>
  );
}

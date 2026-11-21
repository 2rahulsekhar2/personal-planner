"use client";
import { DateTime } from "luxon";
import type { PlannerCtx } from "./usePlanner";
import { fmtRange, isTaskOverdue, relativeDayLabel, weekFromToday, todayISO } from "@/lib/time";
import { TaskChip, visibleAppointments } from "./WeekView";

export default function WeekSidebar({
  ctx, day, setDay, onOpen, onOpenTask,
}: {
  ctx: PlannerCtx;
  day: string;
  setDay: (d: string) => void;
  onOpen: (id: string) => void;
  onOpenTask: (id: string) => void;
}) {
  const { tz, typeById, tasks, types } = ctx;
  const d = DateTime.fromISO(day, { zone: tz });
  const today = todayISO(tz);
  const ws = weekFromToday(day, tz);
  const we = ws.plus({ days: 7 });
  const gridStart = d.startOf("month").startOf("week");
  const cells = Array.from({ length: 42 }, (_, i) => gridStart.plus({ days: i }));

  const dayStart = d.startOf("day");
  const dayEnd = dayStart.plus({ days: 1 });
  const appts = visibleAppointments(ctx)
    .filter((a) => a.status !== "cancelled" && DateTime.fromISO(a.starts_at) < dayEnd && DateTime.fromISO(a.ends_at) > dayStart)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const dayTasks = tasks.filter((t) => t.state === "pending" && (t.due_date === day || isTaskOverdue(t, tz)));

  return (
    <aside className="sidebar" aria-label="Overview">
      <section className="card">
        <div className="side-head">
          <h2>{d.toFormat("LLLL yyyy")}</h2>
          <div>
            <button className="icon-btn" aria-label="Previous month" onClick={() => setDay(d.minus({ months: 1 }).toISODate()!)}>‹</button>
            <button className="icon-btn" aria-label="Next month" onClick={() => setDay(d.plus({ months: 1 }).toISODate()!)}>›</button>
          </div>
        </div>
        <div className="mini-grid">
          {cells.slice(0, 7).map((x) => <span key={x.weekday} className="mini-dow" aria-hidden>{x.toFormat("ccccc")}</span>)}
          {cells.map((x) => {
            const iso = x.toISODate()!;
            return (
              <button
                key={iso}
                className={`mini-day ${x.month !== d.month ? "is-out" : ""} ${x >= ws && x < we ? "is-week" : ""} ${iso === today ? "is-today" : ""}`}
                aria-label={x.toFormat("cccc d LLLL")}
                aria-current={iso === today ? "date" : undefined}
                onClick={() => setDay(iso)}
              >
                {x.day}
              </button>
            );
          })}
        </div>
      </section>

      <section className="card">
        <div className="side-head">
          <h2>{relativeDayLabel(day, tz)}</h2>
          <span className="muted">{d.toFormat("ccc, d LLL")}</span>
        </div>
        {appts.length === 0 && <p className="empty">Nothing booked.</p>}
        {appts.map((a) => (
          <button key={a.id} className={`side-row act-${typeById.get(a.activity_type_id)?.color ?? "slate"}`} onClick={() => onOpen(a.id)}>
            <span className="swatch" aria-hidden />
            <span className="grow">{a.title}</span>
            <span className="muted">{fmtRange(a.starts_at, a.ends_at, tz)}</span>
          </button>
        ))}
      </section>

      {dayTasks.length > 0 && (
        <section className="card">
          <div className="side-head"><h2>Tasks</h2></div>
          <div className="task-list-inline">
            {dayTasks.map((t) => <TaskChip key={t.id} task={t} tz={tz} onOpen={() => onOpenTask(t.id)} />)}
          </div>
        </section>
      )}

      <section className="card">
        <div className="side-head"><h2>Activities</h2></div>
        <div className="chips">
          {types.filter((t) => !t.archived_at).map((t) => (
            <span key={t.id} className={`side-type act-${t.color}`}><span className="swatch" aria-hidden />{t.name}</span>
          ))}
        </div>
      </section>
    </aside>
  );
}

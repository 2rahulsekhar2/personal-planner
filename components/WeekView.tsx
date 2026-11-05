"use client";
import { DateTime } from "luxon";
import type { PlannerCtx } from "./usePlanner";
import type { Appointment, Task } from "@/lib/types";
import { fmtRange, fmtShortTime, startOfWeek, todayISO, fmtClock, isTaskOverdue } from "@/lib/time";

const HOUR_PX = 48;

interface Segment {
  appt: Appointment;
  top: number;
  height: number;
  lane: number;
  lanes: number;
  continues: boolean;
}

export function visibleAppointments(ctx: PlannerCtx) {
  return ctx.appointments.filter((a) => a.status !== "cancelled" || ctx.profile?.show_cancelled);
}

function layoutDay(appts: Appointment[], dayStart: DateTime, gridStartHour: number, gridEndHour: number): Segment[] {
  const dayEnd = dayStart.plus({ days: 1 });
  const raw = appts
    .map((a) => {
      const s = DateTime.fromISO(a.starts_at).setZone(dayStart.zone);
      const e = DateTime.fromISO(a.ends_at).setZone(dayStart.zone);
      if (!(s < dayEnd && e > dayStart)) return null;
      const cs = s < dayStart ? dayStart : s;
      const ce = e > dayEnd ? dayEnd : e;
      const startMin = Math.max(cs.diff(dayStart, "minutes").minutes, gridStartHour * 60);
      const endMin = Math.min(ce.diff(dayStart, "minutes").minutes, gridEndHour * 60);
      return { appt: a, startMin, endMin: Math.max(endMin, startMin + 20), continues: e > dayEnd };
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);

  // Greedy lane assignment within clusters of overlapping items.
  const out: Segment[] = [];
  let cluster: (typeof raw[number] & { lane: number })[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const lanes = Math.max(1, ...cluster.map((c) => c.lane + 1));
    cluster.forEach((c) =>
      out.push({
        appt: c.appt,
        top: ((c.startMin - gridStartHour * 60) / 60) * HOUR_PX,
        height: ((c.endMin - c.startMin) / 60) * HOUR_PX,
        lane: c.lane,
        lanes,
        continues: c.continues,
      }),
    );
    cluster = [];
  };
  for (const r of raw) {
    if (r.startMin >= clusterEnd) {
      flush();
      clusterEnd = -1;
    }
    const used = new Set(cluster.filter((c) => c.endMin > r.startMin).map((c) => c.lane));
    let lane = 0;
    while (used.has(lane)) lane++;
    cluster.push({ ...r, lane });
    clusterEnd = Math.max(clusterEnd, r.endMin);
  }
  flush();
  return out;
}

export function TaskChip({ task, tz, onOpen }: { task: Task; tz: string; onOpen: () => void }) {
  const overdue = isTaskOverdue(task, tz);
  return (
    <button className={`task-chip ${task.state !== "pending" ? "is-done" : ""} ${overdue ? "is-overdue" : ""}`} onClick={onOpen}>
      <span className="task-box" aria-hidden>{task.state === "completed" ? "✓" : ""}</span>
      <span className="task-chip-title">{task.title}</span>
      {task.due_time && <span className="task-chip-time">{fmtClock(task.due_time)}</span>}
      {overdue && <span className="sr-only">(overdue)</span>}
    </button>
  );
}

export default function WeekView({
  ctx, day, setDay, onOpen, onOpenTask, onCreate, overdueCount, showTasks,
}: {
  ctx: PlannerCtx;
  day: string;
  setDay: (d: string) => void;
  onOpen: (id: string) => void;
  onOpenTask: (id: string) => void;
  onCreate: (date: string, start: string, end: string) => void;
  overdueCount: number;
  showTasks: () => void;
}) {
  const { tz, typeById, placeById, tasks } = ctx;
  const ws = startOfWeek(day, tz);
  const days = Array.from({ length: 7 }, (_, i) => ws.plus({ days: i }));
  const today = todayISO(tz);
  const appts = visibleAppointments(ctx);

  // Grid spans 6 AM–11 PM, widened to fit anything earlier or later.
  let startHour = 6;
  let endHour = 23;
  for (const a of appts) {
    const s = DateTime.fromISO(a.starts_at).setZone(tz);
    const e = DateTime.fromISO(a.ends_at).setZone(tz);
    if (s >= ws && s < ws.plus({ days: 7 })) startHour = Math.min(startHour, s.hour);
    if (e.hasSame(s, "day")) endHour = Math.max(endHour, e.minute ? e.hour + 1 : e.hour);
    else endHour = 24;
  }
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  const nowL = DateTime.now().setZone(tz);
  const nowTop = ((nowL.hour * 60 + nowL.minute - startHour * 60) / 60) * HOUR_PX;

  const bandFor = (h: number) => (h < 12 ? "morning" : h < 17 ? "afternoon" : "evening");

  return (
    <div className="week">
      <div className="toolbar">
        <div className="toolbar-group">
          <button className="btn" onClick={() => setDay(ws.minus({ weeks: 1 }).toISODate()!)} aria-label="Previous week">‹</button>
          <button className="btn" onClick={() => setDay(today)}>Today</button>
          <button className="btn" onClick={() => setDay(ws.plus({ weeks: 1 }).toISODate()!)} aria-label="Next week">›</button>
        </div>
        <h1 className="toolbar-title">
          {ws.toFormat("d LLL")} – {ws.plus({ days: 6 }).toFormat(ws.month === ws.plus({ days: 6 }).month ? "d LLL yyyy" : "d LLL yyyy")}
        </h1>
        <button className={`btn btn-ghost ${overdueCount ? "has-alert" : ""}`} onClick={showTasks}>
          {overdueCount ? `${overdueCount} overdue task${overdueCount > 1 ? "s" : ""}` : "Tasks"}
        </button>
      </div>

      <div className="week-scroll">
        <div className="week-grid" style={{ ["--hours" as string]: hours.length, ["--hour-px" as string]: `${HOUR_PX}px` }}>
          <div className="week-corner" />
          {days.map((d) => {
            const iso = d.toISODate()!;
            return (
              <div key={iso} className={`week-dayhead ${iso === today ? "is-today" : ""}`}>
                <button className="link-plain" onClick={() => setDay(iso)}>
                  <span className="dow">{d.toFormat("ccc")}</span>
                  <span className="dom">{d.toFormat("d")}</span>
                </button>
              </div>
            );
          })}

          <div className="week-taskhead">Tasks</div>
          {days.map((d) => {
            const iso = d.toISODate()!;
            const dayTasks = tasks.filter((t) => t.due_date === iso && t.state !== "dismissed");
            return (
              <div key={iso} className={`week-tasks ${iso === today ? "is-today" : ""}`}>
                {dayTasks.map((t) => <TaskChip key={t.id} task={t} tz={tz} onOpen={() => onOpenTask(t.id)} />)}
              </div>
            );
          })}

          <div className="week-hours">
            {hours.map((h) => (
              <div key={h} className={`hour-label band-${bandFor(h)}`}>
                {(h === startHour || h === 12 || h === 17) && <span className="band-name">{bandFor(h)}</span>}
                <span>{DateTime.fromObject({ hour: h }).toFormat("h a")}</span>
              </div>
            ))}
          </div>
          {days.map((d) => {
            const iso = d.toISODate()!;
            const segs = layoutDay(appts, d.startOf("day"), startHour, endHour);
            return (
              <div
                key={iso}
                className={`week-col ${iso === today ? "is-today" : ""}`}
                onClick={(e) => {
                  if (e.target !== e.currentTarget) return;
                  const y = e.nativeEvent.offsetY;
                  const h = Math.min(23, startHour + Math.floor(y / HOUR_PX));
                  const pad = (n: number) => String(n).padStart(2, "0");
                  onCreate(iso, `${pad(h)}:00`, `${pad((h + 1) % 24)}:00`);
                }}
                aria-label={`${d.toFormat("cccc d LLLL")}`}
              >
                {hours.map((h) => <div key={h} className={`hour-cell band-${bandFor(h)}`} aria-hidden />)}
                {iso === today && nowTop >= 0 && nowTop <= hours.length * HOUR_PX && <div className="now-line" style={{ top: nowTop }} aria-hidden />}
                {segs.map((s) => {
                  const t = typeById.get(s.appt.activity_type_id);
                  const p = s.appt.place_id ? placeById.get(s.appt.place_id) : null;
                  const compact = s.height < 44;
                  return (
                    <button
                      key={s.appt.id + iso}
                      className={`appt act-${t?.color ?? "slate"} status-${s.appt.status} ${compact ? "is-compact" : ""}`}
                      style={{ top: s.top, height: s.height - 2, left: `calc(${(s.lane / s.lanes) * 100}% + 2px)`, width: `calc(${100 / s.lanes}% - 4px)` }}
                      onClick={() => onOpen(s.appt.id)}
                      title={`${s.appt.title}, ${fmtRange(s.appt.starts_at, s.appt.ends_at, tz)}`}
                    >
                      <span className="appt-time">{fmtShortTime(s.appt.starts_at, tz)}</span>
                      <span className="appt-title">
                        {s.appt.title}
                        {s.appt.status === "tentative" && <span className="tag">Tentative</span>}
                        {s.appt.status === "cancelled" && <span className="tag">Cancelled</span>}
                      </span>
                      {!compact && p && <span className="appt-place">{p.name}</span>}
                      {!compact && s.height > 80 && s.appt.team && <span className="appt-team">{s.appt.team}</span>}
                      {!compact && s.height > 60 && <span className="appt-type">{t?.name}</span>}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

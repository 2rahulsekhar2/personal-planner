"use client";
import { useLayoutEffect, useRef, useState } from "react";
import { DateTime } from "luxon";
import type { PlannerCtx } from "./usePlanner";
import type { Appointment, Task } from "@/lib/types";
import { fmtRange, fmtShortTime, weekFromToday, todayISO, fmtClock, isTaskOverdue } from "@/lib/time";

const TASK_PX = 18; // height a task chip takes in the grid, including its gap
const MIN_APPT_PX = 15; // shortest an appointment is drawn, so it stays readable and tappable

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

function layoutDay(appts: Appointment[], dayStart: DateTime, gridStartHour: number, gridEndHour: number, HOUR_PX: number): Segment[] {
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
      return { appt: a, startMin, endMin: Math.max(endMin, startMin + (MIN_APPT_PX / HOUR_PX) * 60), continues: e > dayEnd };
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

export function TaskChip({ task, tz, onOpen, top }: { task: Task; tz: string; onOpen: () => void; top?: number }) {
  const overdue = isTaskOverdue(task, tz);
  return (
    <button className={`task-chip ${task.state !== "pending" ? "is-done" : ""} ${overdue ? "is-overdue" : ""}`} style={top === undefined ? undefined : { top }} onClick={onOpen}>
      <span className="task-box" aria-hidden>{task.state === "completed" ? "✓" : ""}</span>
      <span className="task-chip-title">{task.title}</span>
      {task.due_time && <span className="task-chip-time">{fmtClock(task.due_time)}</span>}
      {overdue && <span className="sr-only">(overdue)</span>}
    </button>
  );
}

export default function WeekView({
  ctx, day, setDay, onOpen, onOpenTask, onCreate, toggle,
}: {
  ctx: PlannerCtx;
  day: string;
  setDay: (d: string) => void;
  onOpen: (id: string) => void;
  onOpenTask: (id: string) => void;
  onCreate: (date: string, start: string, end: string) => void;
  toggle: React.ReactNode;
}) {
  const { tz, typeById, placeById, tasks } = ctx;
  const ws = weekFromToday(day, tz);
  const days = Array.from({ length: 7 }, (_, i) => ws.plus({ days: i }));

  const today = todayISO(tz);
  const appts = visibleAppointments(ctx);

  // The grid shows the whole day, midnight to midnight.
  const startHour = 0;
  const endHour = 24;
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  const nowL = DateTime.now().setZone(tz);
  // The whole day fits the window: each hour gets an equal share of the height left under the day headers.
  const gridRef = useRef<HTMLDivElement>(null);
  const [HOUR_PX, setHourPx] = useState(24);
  useLayoutEffect(() => {
    const fit = () => {
      const col = gridRef.current?.querySelector(".week-col");
      const content = gridRef.current?.closest(".content");
      if (!col || !content) return;
      const top = col.getBoundingClientRect().top + window.scrollY;
      const reserved = parseFloat(getComputedStyle(content).paddingBottom) + 6; // the content padding, plus a little air
      setHourPx(Math.max(14, Math.floor(((window.innerHeight - top - reserved) / 24) * 10) / 10));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  const nowTop = ((nowL.hour * 60 + nowL.minute - startHour * 60) / 60) * HOUR_PX;


  // "21 – 27 Nov", or "28 Nov – 4 Dec" across months; the year only when it is not this year.
  const we = ws.plus({ days: 6 });
  const rangeLabel = `${ws.toFormat(ws.month === we.month ? "d" : "d LLL")} – ${we.toFormat(we.year === nowL.year ? "d LLL" : "d LLL yyyy")}`;

  return (
    <div className="week">
      <div className="toolbar toolbar-compact">
        <button className="btn btn-sm btn-ghost" onClick={() => setDay(ws.minus({ weeks: 1 }).toISODate()!)} aria-label="Previous week">‹</button>
        <h1 className="toolbar-title">{rangeLabel}</h1>
        <button className="btn btn-sm btn-ghost" onClick={() => setDay(ws.plus({ weeks: 1 }).toISODate()!)} aria-label="Next week">›</button>
        <button className="btn btn-sm btn-ghost toolbar-end" onClick={() => setDay(today)}>Today</button>
        {toggle}
      </div>

      <div className="week-scroll" ref={gridRef}>
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

          <div className="week-hours">
            {hours.map((h) => (
              <div key={h} className="hour-label">
                <span>{DateTime.fromObject({ hour: h }).toFormat("h a")}</span>
              </div>
            ))}
          </div>
          {days.map((d) => {
            const iso = d.toISODate()!;
            const segs = layoutDay(appts, d.startOf("day"), startHour, endHour, HOUR_PX);
            // Tasks sit at their due time; ones without a time start the day. Each is pushed below the previous so none overlap.
            let free = 0;
            const dayTasks = tasks
              .filter((t) => t.due_date === iso && t.state !== "dismissed")
              .map((t) => ({ t, at: t.due_time ? (Number(t.due_time.slice(0, 2)) + Number(t.due_time.slice(3, 5)) / 60) * HOUR_PX : 0 }))
              .sort((a, b) => a.at - b.at)
              .map(({ t, at }) => {
                const top = Math.max(at, free);
                free = top + TASK_PX;
                return { t, top };
              });
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
                {hours.map((h) => <div key={h} className="hour-cell" aria-hidden />)}
                {iso === today && nowTop >= 0 && nowTop <= hours.length * HOUR_PX && <div className="now-line" style={{ top: nowTop }} aria-hidden />}
                {dayTasks.map(({ t, top }) => <TaskChip key={t.id} task={t} tz={tz} top={top} onOpen={() => onOpenTask(t.id)} />)}
                {segs.map((s) => {
                  const t = typeById.get(s.appt.activity_type_id ?? "");
                  const p = s.appt.place_id ? placeById.get(s.appt.place_id) : null;
                  // What fits: under 30px one line; taller cards add the place, then the end time at the bottom edge.
                  const compact = s.height < 30;
                  const placeName = p?.name ?? s.appt.custom_place;
                  const showPlace = !!placeName && s.height > 50;
                  const showEnd = s.height > 66;
                  const titleLines = Math.max(1, Math.floor((s.height - 19 - (showPlace ? 11 : 0) - (showEnd ? 11 : 0)) / 12));
                  return (
                    <button
                      key={s.appt.id + iso}
                      className={`appt act-${t?.color ?? "slate"} status-${s.appt.status} ${s.appt.outcome ? `outcome-${s.appt.outcome}` : ""} ${compact ? "is-compact" : ""}`}
                      style={{ top: s.top, height: s.height - 2, left: `calc(${(s.lane / s.lanes) * 100}% + 2px)`, width: `calc(${100 / s.lanes}% - 4px)` }}
                      onClick={() => onOpen(s.appt.id)}
                      title={`${s.appt.title}, ${fmtRange(s.appt.starts_at, s.appt.ends_at, tz)}${placeName ? `, ${placeName}` : ""}`}
                    >
                      <span className="appt-time">{fmtShortTime(s.appt.starts_at, tz)}</span>
                      <span className="appt-title" style={compact ? undefined : { WebkitLineClamp: titleLines }}>
                        {s.appt.title}
                        {s.appt.status === "tentative" && <span className="tag">Tentative</span>}
                        {s.appt.status === "cancelled" && <span className="tag">Cancelled</span>}
                      </span>
                      {showPlace && (
                        <span className="appt-place">
                          <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M12 22s-7-6-7-12a7 7 0 0 1 14 0c0 6-7 12-7 12zm0-9.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" /></svg>
                          {placeName}
                        </span>
                      )}
                      {showEnd && <span className="appt-end">until {fmtShortTime(s.appt.ends_at, tz)}</span>}
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

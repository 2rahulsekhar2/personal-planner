"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import SlotMenu, { type Slot } from "./SlotMenu";
import { DateTime } from "luxon";
import type { PlannerCtx } from "./usePlanner";
import type { Appointment, Task } from "@/lib/types";
import { fmtRange, fmtShortTime, weekFromToday, todayISO, fmtClock, isTaskOverdue } from "@/lib/time";

const HOLD_MS = 450; // how long a finger must rest before its drag selects time instead of scrolling
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
  ctx, day, setDay, onOpen, onOpenTask, onCreate, onCreateTask, toggle, whoOf, scopeBar,
}: {
  ctx: PlannerCtx;
  day: string;
  setDay: (d: string) => void;
  onOpen: (id: string) => void;
  onOpenTask: (id: string) => void;
  onCreate: (date: string, start: string, end: string) => void;
  onCreateTask: (date: string, time: string) => void;
  toggle: React.ReactNode;
  whoOf: (userId: string) => { color: string; letter: string; email: string } | undefined; // set in a circle view: marks whose item it is
  scopeBar: React.ReactNode;
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
  // The empty hour that was pressed, and where: it lights up in the grid and asks what to put there.
  // `from` and `to` are minutes into the day: a pressed hour, or a stretch dragged out with the mouse.
  const [slot, setSlot] = useState<(Slot & { from: number; to: number }) | null>(null);
  const closeSlot = useCallback(() => setSlot(null), []);
  // Dragging down (or up) an empty column marks out a stretch of time, in half-hour steps.
  const [sel, setSel] = useState<{ iso: string; from: number; to: number } | null>(null);
  const drag = useRef<{ iso: string; x0: number; y0: number; top: number; moved: boolean } | null>(null);
  const hold = useRef<number | undefined>(undefined); // the press-and-hold timer on a touch screen
  const dragged = useRef(false); // the click that ends a drag is not a press on an hour
  const clockOf = (m: number) => DateTime.fromObject({ hour: Math.floor(m / 60) % 24, minute: m % 60 }).toFormat(m % 60 ? "h:mm a" : "h a");
  const hhmmOf = (m: number) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
  const lengthOf = (m: number) => `${m >= 60 ? `${Math.floor(m / 60)} h` : ""}${m >= 60 && m % 60 ? " " : ""}${m % 60 ? `${m % 60} min` : ""}`;
  const pad = (n: number) => String(n).padStart(2, "0");
  const [HOUR_PX, setHourPx] = useState(24);
  // Where a pointer is in the day, in minutes, snapped to the half hour.
  const minutesAt = (g: { top: number }, y: number) => Math.max(0, Math.min(1440, Math.round(((y - g.top) / HOUR_PX) * 2) * 30));
  // While a finger is selecting, its movement must not scroll the grid. Only a non-passive touchmove listener can stop that.
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const stop = (e: TouchEvent) => { if (drag.current?.moved && e.cancelable) e.preventDefault(); };
    el.addEventListener("touchmove", stop, { passive: false });
    return () => el.removeEventListener("touchmove", stop);
  }, []);
  const hasScopeBar = !!scopeBar; // the scope bar adds a row above the grid
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
  }, [hasScopeBar]);
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
      {scopeBar}

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
                  if (dragged.current) return void (dragged.current = false);
                  if (e.target !== e.currentTarget) return;
                  const y = e.nativeEvent.offsetY;
                  const h = Math.min(23, startHour + Math.floor(y / HOUR_PX));
                  setSlot({ iso, from: h * 60, to: h * 60 + 60, start: `${pad(h)}:00`, end: `${pad((h + 1) % 24)}:00`, x: e.clientX, y: e.clientY });
                }}
                // A mouse or pen drags straight away. A finger must press and hold first, because a finger's drag is how the page scrolls.
                onPointerDown={(e) => {
                  if (e.target !== e.currentTarget || e.button !== 0) return;
                  const el = e.currentTarget, id = e.pointerId;
                  const g = { iso, x0: e.clientX, y0: e.clientY, top: el.getBoundingClientRect().top, moved: false };
                  drag.current = g;
                  if (e.pointerType !== "touch") return el.setPointerCapture(id); // keep following the pointer if it leaves the column
                  hold.current = window.setTimeout(() => {
                    if (drag.current !== g) return; // lifted, or moved off to scroll
                    g.moved = true; // from here the finger selects; the touchmove listener above stops the scroll
                    try { el.setPointerCapture(id); } catch { /* the touch ended this instant */ }
                    navigator.vibrate?.(10);
                    const from = Math.min(minutesAt(g, g.y0), 1380);
                    setSlot(null);
                    setSel({ iso, from, to: from + 60 }); // an hour to start with, as a held press alone should give
                  }, HOLD_MS);
                }}
                onPointerMove={(e) => {
                  const g = drag.current;
                  if (!g || g.iso !== iso) return;
                  if (!g.moved) {
                    const touch = e.pointerType === "touch";
                    if (Math.hypot(e.clientX - g.x0, e.clientY - g.y0) < (touch ? 8 : 5)) return; // a small wobble is still a click, or still a hold
                    if (touch) { window.clearTimeout(hold.current); drag.current = null; return; } // moved before the hold was up: a scroll
                  }
                  g.moved = true;
                  const a = minutesAt(g, g.y0), b = minutesAt(g, e.clientY);
                  const from = Math.min(a, b, 1410);
                  setSlot(null);
                  setSel({ iso, from, to: Math.max(a, b, from + 30) });
                }}
                onPointerUp={(e) => {
                  window.clearTimeout(hold.current);
                  const g = drag.current;
                  drag.current = null;
                  if (!g?.moved || !sel) return;
                  // Swallow the click this release produces, and only that one: it may land elsewhere, come late on a touch screen, or not come at all.
                  dragged.current = true;
                  setTimeout(() => { dragged.current = false; }, e.pointerType === "touch" ? 400 : 0);
                  setSlot({ ...sel, start: hhmmOf(sel.from), end: hhmmOf(sel.to), x: e.clientX, y: e.clientY });
                  setSel(null);
                }}
                onPointerCancel={() => { window.clearTimeout(hold.current); drag.current = null; setSel(null); }}
                onContextMenu={(e) => { if (drag.current) e.preventDefault(); }} // a held press must not open the browser's own menu
                aria-label={`${d.toFormat("cccc d LLLL")}`}
              >
                {hours.map((h) => <div key={h} className="hour-cell" aria-hidden />)}
                {[sel, slot].map((g, n) => g?.iso === iso && (
                  <div key={n} className={`slot-ghost ${n === 0 ? "is-dragging" : ""}`} style={{ top: (g.from / 60 - startHour) * HOUR_PX, height: ((g.to - g.from) / 60) * HOUR_PX }} aria-hidden>
                    {g.to - g.from === 60 && g.from % 60 === 0 && n === 1 ? clockOf(g.from) : <>{clockOf(g.from)} – {clockOf(g.to)}{n === 0 && <span className="slot-length">{lengthOf(g.to - g.from)}</span>}</>}
                  </div>
                ))}
                {iso === today && nowTop >= 0 && nowTop <= hours.length * HOUR_PX && <div className="now-line" style={{ top: nowTop }} aria-hidden />}
                {dayTasks.map(({ t, top }) => <TaskChip key={t.id} task={t} tz={tz} top={top} onOpen={() => onOpenTask(t.id)} />)}
                {segs.map((s) => {
                  const t = typeById.get(s.appt.activity_type_id ?? "");
                  const p = s.appt.place_id ? placeById.get(s.appt.place_id) : null;
                  // What fits: under 30px one line; taller cards add the place, then the end time at the bottom edge.
                  const compact = s.height < 30;
                  const placeName = p?.name ?? s.appt.custom_place;
                  const who = whoOf(s.appt.user_id);
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
                      <span className="appt-time">{who && <span className={`who act-${who.color}`} title={who.email}>{who.letter}</span>} {fmtShortTime(s.appt.starts_at, tz)}</span>
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
      {slot && <SlotMenu slot={slot} onClose={closeSlot} onAppointment={() => { setSlot(null); onCreate(slot.iso, slot.start, slot.end); }} onTask={() => { setSlot(null); onCreateTask(slot.iso, slot.start); }} />}
    </div>
  );
}

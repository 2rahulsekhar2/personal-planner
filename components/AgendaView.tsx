"use client";
import { useCallback, useState } from "react";
import { DateTime } from "luxon";
import SlotMenu, { type Slot } from "./SlotMenu";
import type { PlannerCtx } from "./usePlanner";
import { fmtClock, fmtRange, relativeDayLabel, weekFromToday, todayISO, isTaskOverdue, fmtShortTime } from "@/lib/time";
import { visibleAppointments } from "./WeekView";
import DayBar from "./DayBar";
import { expected, inr, type Line } from "@/lib/money";

const PIN = <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.3" /></svg>;
/** "45m", "2h", "5h 55m". */
function lengthOf(from: DateTime, to: DateTime) {
  const m = Math.round(to.diff(from, "minutes").minutes);
  return m < 60 ? `${m}m` : m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m / 60}h`;
}

export default function AgendaView({
  ctx, day, setDay, onOpen, onOpenTask, onCreate, onCreateTask, toggle, whoOf, mayFinish, scopeBar, bills = [], onPayBill, onOpenBills,
}: {
  bills?: Line[]; // incomes and expenses that fall due on this day, when Money is on
  onPayBill?: (l: Line) => void; // absent: this person may look, not mark
  onOpenBills?: () => void;
  onCreate: (date: string, start: string, end: string) => void;
  onCreateTask: (date: string, time: string) => void;
  ctx: PlannerCtx;
  mayFinish: (t: PlannerCtx["tasks"][number]) => boolean; // may this person mark the task done
  day: string;
  setDay: (d: string) => void;
  onOpen: (id: string) => void;
  onOpenTask: (id: string) => void;
  toggle: React.ReactNode;
  whoOf: (userId: string) => { color: string; letter: string; email: string } | undefined; // set in a circle view: marks whose item it is
  scopeBar: React.ReactNode;
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

  // Pressing free time asks what to put there. It starts on the next quarter hour and runs an hour, or to the end of the gap.
  const [slot, setSlot] = useState<Slot | null>(null);
  const closeSlot = useCallback(() => setSlot(null), []);
  const ask = (e: React.MouseEvent, from: DateTime, to: DateTime) => {
    const up = from.plus({ minutes: (15 - (from.minute % 15)) % 15 }).startOf("minute");
    const start = up < to ? up : from;
    const end = DateTime.min(start.plus({ hours: 1 }), to);
    // A press from the keyboard has no pointer position: open beside the row instead.
    const r = e.currentTarget.getBoundingClientRect();
    setSlot({ iso: day, start: start.toFormat("HH:mm"), end: end.toFormat("HH:mm"), x: e.clientX || r.left, y: e.clientY || r.bottom });
  };
  // With no gap left to press (a full day, or late evening today), one row still offers to add something.
  const spare = (day === today ? DateTime.now().setZone(tz) : dayStart.set({ hour: 9 })).startOf("minute");

  const allTasks = [...overdue, ...dayTasks.filter((t) => !overdue.includes(t))];

  type Row = { at: string; node: React.ReactNode };
  const rows: Row[] = [
    ...items.map((a) => {
      const t = typeById.get(a.activity_type_id ?? "");
      const p = a.place_id ? placeById.get(a.place_id) : null;
      const who = whoOf(a.user_id);
      return {
        at: a.starts_at,
        node: (
          <button key={a.id} className={`agenda-appt act-${t?.color ?? "slate"} status-${a.status} ${a.outcome ? `outcome-${a.outcome}` : ""}`} onClick={() => onOpen(a.id)}>
            {/* When, as a block: the start over the end. */}
            <span className="agenda-when" aria-label={fmtRange(a.starts_at, a.ends_at, tz)}>
              <strong>{fmtShortTime(a.starts_at, tz)}</strong>
              <span>{fmtShortTime(a.ends_at, tz)}</span>
            </span>
            <span className="agenda-body">
              <span className="agenda-title">
                {a.title}
                {a.status !== "confirmed" && <span className="tag">{a.status === "tentative" ? "Tentative" : "Cancelled"}</span>}
              </span>
              <span className="agenda-meta">
                <span className="type-label"><span className="swatch" aria-hidden />{t?.name ?? a.custom_activity}</span>
                {(p?.name ?? a.custom_place) && <span className="agenda-place">{PIN}{p?.name ?? a.custom_place}</span>}
                {a.team && <span>{a.team}</span>}
                {who && <span className={`who act-${who.color}`} title={who.email}>{who.letter}</span>}
              </span>
            </span>
          </button>
        ),
      };
    }),
    ...gaps.map((g) => ({
      at: g.from.toUTC().toISO()!,
      node: (
        <button key={"gap" + g.from.toISO()} className="agenda-gap" aria-label={`Free ${fmtShortTime(g.from, tz)} to ${fmtShortTime(g.to, tz)}. Add an appointment or task`} onClick={(e) => ask(e, g.from, g.to)}>
          <span>{fmtShortTime(g.from, tz)} – {fmtShortTime(g.to, tz)}</span>
          <span className="agenda-gap-len">{lengthOf(g.from, g.to)} free</span>
          <svg className="agenda-gap-plus" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg>
        </button>
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
      {scopeBar}

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

      <DayBar appts={active} typeById={typeById} day={day} tz={tz} />

      {/* Tasks are plain rows: tap the circle to finish one, tap the row to open it. Overdue ones lead, in red. */}
      {allTasks.length > 0 && (
        <section className="day-tasks">
          <div className="page-head line-head"><h2>Tasks</h2><span className="bank-dots" role="img" aria-label={`${allTasks.filter((t) => t.state !== "pending").length} of ${allTasks.length} done`}>{allTasks.map((t) => <i key={t.id} className={t.state !== "pending" ? "is-paid" : isTaskOverdue(t, tz) ? "is-late" : ""} />)}</span></div>
          {allTasks.map((t) => {
            const late = isTaskOverdue(t, tz);
            const done = t.state !== "pending";
            const canDo = mayFinish(t);
            return (
              <div key={t.id} className={`day-task ${late ? "is-overdue" : ""} ${done ? "is-done" : ""}`}>
                <button className="day-task-check" disabled={done || !canDo} aria-label={done ? "Done" : !canDo ? "Not yours to mark done" : `Mark “${t.title}” done`} onClick={() => ctx.completeTask(t)}>
                  {done && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>}
                </button>
                <button className="day-task-main" onClick={() => onOpenTask(t.id)}>
                  <span className="day-task-title">{t.title}</span>
                  {whoOf(t.user_id) && <span className={`who act-${whoOf(t.user_id)!.color}`} title={whoOf(t.user_id)!.email}>{whoOf(t.user_id)!.letter}</span>}
                  <span className="day-task-when">{late ? `Overdue, ${t.due_date === day && t.due_time ? fmtClock(t.due_time) : relativeDayLabel(t.due_date, tz)}` : t.due_time ? fmtClock(t.due_time) : ""}</span>
                </button>
              </div>
            );
          })}
        </section>
      )}

      {/* Money due today, from the budget: tap the circle to mark it paid or received, the row to open Money. */}
      {bills.length > 0 && (
        <section className="day-tasks">
          <div className="page-head line-head"><h2>Money</h2><span className="bank-dots" role="img" aria-label={`${bills.filter((l) => l.paid).length} of ${bills.length} settled`}>{bills.map((l) => <i key={l.item.id} className={l.paid ? "is-paid" : ""} />)}</span></div>
          {bills.map((l) => {
            const out = l.item.kind === "expense";
            const word = out ? "paid" : "received";
            return (
              <div key={l.item.id} className={`day-task day-bill ${l.paid ? "is-done" : ""}`}>
                <button className="day-task-check" disabled={!onPayBill} aria-pressed={l.paid} aria-label={`${l.item.name}: ${l.paid ? `mark not ${word}` : `mark ${word}`}`} onClick={() => onPayBill?.(l)}>
                  {l.paid && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>}
                </button>
                <button className="day-task-main" onClick={onOpenBills}>
                  <span className="day-task-title">{l.item.name}</span>
                  <span className="day-task-when">{inr(expected(l))} {l.paid ? word : out ? "to pay" : "to come"}</span>
                </button>
              </div>
            );
          })}
        </section>
      )}

      <section className="agenda-list">
        <div className="page-head line-head"><h2>Appointments</h2><span className="bank-dots" aria-hidden>{items.map((a) => <i key={a.id} className={a.status === "cancelled" ? "is-skipped" : `act-${typeById.get(a.activity_type_id ?? "")?.color ?? "slate"}`} />)}</span></div>
        {items.length === 0 && <p className="empty">Nothing booked.</p>}
        {rows.map((r) => r.node)}
        {gaps.length === 0 && day >= today && (
          <button className="agenda-gap" onClick={(e) => ask(e, spare, DateTime.min(spare.plus({ hours: 2 }), dayEnd.minus({ minutes: 1 })))}>
            <span>Add to this day</span>
            <svg className="agenda-gap-plus" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg>
          </button>
        )}
      </section>
      {slot && <SlotMenu slot={slot} onClose={closeSlot} onAppointment={() => { setSlot(null); onCreate(slot.iso, slot.start, slot.end); }} onTask={() => { setSlot(null); onCreateTask(slot.iso, slot.start); }} />}
    </div>
  );
}

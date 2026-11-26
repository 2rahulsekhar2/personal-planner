"use client";
import { useEffect, useRef, useState } from "react";
import { DateTime } from "luxon";
import { todayISO } from "@/lib/time";

/** A month as a grid of days, Monday first. `mark` adds classes to a day; today is always marked. */
export function MonthGrid({ month, tz, mark, onPick }: { month: DateTime; tz: string; mark?: (x: DateTime) => string; onPick: (iso: string) => void }) {
  const today = todayISO(tz);
  const gridStart = month.startOf("month").startOf("week");
  const cells = Array.from({ length: 42 }, (_, i) => gridStart.plus({ days: i }));
  return (
    <div className="mini-grid">
      {cells.slice(0, 7).map((x) => <span key={x.weekday} className="mini-dow" aria-hidden>{x.toFormat("ccccc")}</span>)}
      {cells.map((x) => {
        const iso = x.toISODate()!;
        return (
          <button
            type="button" key={iso}
            className={`mini-day ${x.month !== month.month ? "is-out" : ""} ${mark?.(x) ?? ""} ${iso === today ? "is-today" : ""}`}
            aria-label={x.toFormat("cccc d LLLL")}
            aria-current={iso === today ? "date" : undefined}
            onClick={() => onPick(iso)}
          >
            {x.day}
          </button>
        );
      })}
    </div>
  );
}

// A button that opens a month to jump to any day, past or future. The month can be turned without leaving the day shown.
// The month hangs from the nearest positioned ancestor (the toolbar or heading), so it never runs off a phone's edge.
export default function DayPicker({ day, tz, onPick, className, label, children }: { day: string; tz: string; onPick: (iso: string) => void; className?: string; label?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => DateTime.fromISO(day, { zone: tz }));
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  return (
    <span className="day-pick" ref={ref}>
      <button type="button" className={className} aria-label={label} title="Choose a date" aria-haspopup="dialog" aria-expanded={open}
        onClick={() => { setMonth(DateTime.fromISO(day, { zone: tz })); setOpen(!open); }}>
        {children}
      </button>
      {open && (
        <div className="day-pick-pop card" role="dialog" aria-label="Choose a date">
          <div className="side-head">
            <h2>{month.toFormat("LLLL yyyy")}</h2>
            <div>
              <button type="button" className="icon-btn" aria-label="Previous month" onClick={() => setMonth(month.minus({ months: 1 }))}>‹</button>
              <button type="button" className="icon-btn" aria-label="Next month" onClick={() => setMonth(month.plus({ months: 1 }))}>›</button>
            </div>
          </div>
          <MonthGrid month={month} tz={tz} mark={(x) => (x.toISODate() === day ? "is-picked" : "")} onPick={(iso) => { setOpen(false); onPick(iso); }} />
        </div>
      )}
    </span>
  );
}

"use client";
import { useState } from "react";
import { MAX_REMINDER_MINUTES, MAX_REMINDERS, REMINDER_UNITS, reminderLabel, reminderShort, tidyReminders, type ReminderUnit } from "@/lib/types";

const USUAL = [0, 15, 60, 1440];

// An appointment's reminders, as chips to switch on and off: the usual times, any others already chosen, and ＋ for another.
// Each value is minutes before the start. None switched on means no reminder.
// `many` is false until the database can hold more than one (0023_multi_reminders.sql): choosing one then replaces the last.
// `zero` renames the chip for 0 minutes: a task is "due", it does not "start".
export default function ReminderChips({ value, onChange, many, zero }: { value: number[]; onChange: (minutes: number[]) => void; many: boolean; zero?: string }) {
  const [other, setOther] = useState<{ n: string; unit: ReminderUnit } | null>(null);
  const full = many && value.length >= MAX_REMINDERS;
  const toggle = (m: number) => onChange(value.includes(m) ? value.filter((x) => x !== m) : many ? tidyReminders([...value, m]) : [m]);

  function add() {
    if (!other) return;
    const size = REMINDER_UNITS[other.unit].minutes;
    const m = Math.max(1, Math.min(Math.floor(MAX_REMINDER_MINUTES / size), Math.floor(Number(other.n)) || 1)) * size;
    if (!value.includes(m)) toggle(m);
    setOther(null);
  }

  return (
    <div className="reminder" role="group" aria-label="Reminders">
      <div className="chips chips-xs" style={{ marginTop: 0 }}>
        {[...new Set([...USUAL, ...value])].sort((a, b) => a - b).map((m) => {
          const on = value.includes(m);
          return <button type="button" key={m} className={`chip ${on ? "is-selected" : ""}`} aria-pressed={on} aria-label={m === 0 && zero ? zero : reminderLabel(m)} title={m === 0 && zero ? zero : reminderLabel(m)} disabled={!on && full} onClick={() => toggle(m)}>{m === 0 && zero ? zero : reminderShort(m)}</button>;
        })}
        {!other && !full && <button type="button" className="chip chip-dashed" aria-label="Another time" title="Another time" onClick={() => setOther({ n: "30", unit: "minutes" })}>＋</button>}
      </div>
      {other && (
        <div className="repeat-row subfields">
          <input
            type="number" className="input-inline days-input" min={1} autoFocus aria-label={`How many ${other.unit} before`}
            value={other.n} onChange={(e) => setOther({ ...other, n: e.target.value })}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          />
          <span className="chips chips-xs" role="group" aria-label="Unit" style={{ marginTop: 0 }}>
            {(Object.keys(REMINDER_UNITS) as ReminderUnit[]).map((u) => (
              <button type="button" key={u} className={`chip ${other.unit === u ? "is-selected" : ""}`} aria-pressed={other.unit === u} onClick={() => setOther({ ...other, unit: u })}>{REMINDER_UNITS[u].label}</button>
            ))}
          </span>
          <button type="button" className="btn btn-sm" onClick={add}>Add</button>
          <button type="button" className="icon-btn" aria-label="Cancel" onClick={() => setOther(null)}>✕</button>
        </div>
      )}
    </div>
  );
}

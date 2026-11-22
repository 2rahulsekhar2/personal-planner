"use client";
import { useLayoutEffect, useState } from "react";
import { useReveal } from "./useReveal";
import { MAX_REMINDER_MINUTES, REMINDER_UNITS, reminderParts, type ReminderUnit } from "@/lib/types";

/** The middle of a chip, measured from the left of its row: where the settings box under it draws its pointer. */
export const notchOf = (chip: HTMLElement) => chip.getBoundingClientRect().left - chip.parentElement!.getBoundingClientRect().left + chip.offsetWidth / 2;

// When to be reminded: not at all, at the start, or an amount of minutes, hours or days before.
// The value is minutes before the start (null: no reminder), which is what the database stores.
export default function ReminderPicker({ id, value, onChange }: { id?: string; value: number | null; onChange: (minutes: number | null) => void }) {
  const parts = reminderParts(value);
  // The unit is kept here: 60 minutes must stay "minutes" while it is being typed, not jump to "1 hour".
  const [unit, setUnit] = useState<ReminderUnit>(parts?.unit ?? "minutes");
  // The amount as typed. It is applied on leaving the field or pressing Enter, so half-typed numbers are never saved.
  const [draft, setDraft] = useState<string | null>(null);
  const [notch, setNotch] = useState(0); // where the chosen unit's chip sits, so the amount box can point back at it
  const before = value !== null && value > 0;
  const size = REMINDER_UNITS[unit].minutes;
  const most = Math.floor(MAX_REMINDER_MINUTES / size);
  const amount = before ? Math.max(1, Math.round(value / size)) : 1;

  const set = (n: number, u = unit) => onChange(Math.max(1, Math.min(Math.floor(MAX_REMINDER_MINUTES / REMINDER_UNITS[u].minutes), Math.floor(n) || 1)) * REMINDER_UNITS[u].minutes);
  const apply = () => { if (draft !== null) { set(Number(draft)); setDraft(null); } };
  // A new unit starts from its usual amount (15 minutes, 1 hour, 1 day): 45 minutes should not turn into 45 hours.
  const pick = (u: ReminderUnit) => { if (before && u === unit) return; setUnit(u); setDraft(null); set(REMINDER_UNITS[u].start, u); };

  const ref = useReveal<HTMLDivElement>(before); // the amount row opens under the chips
  // Measured, not taken from the click: a saved reminder opens with its unit already chosen.
  useLayoutEffect(() => {
    const chip = ref.current?.querySelector<HTMLElement>(".chip.is-selected");
    if (chip) setNotch(notchOf(chip));
  }, [before, unit, ref]);

  return (
    <div className="reminder reveal" ref={ref} id={id} role="group" aria-label="Reminder">
      <div className="chips chips-xs" style={{ marginTop: 0 }}>
        <button type="button" className={`chip ${value === null ? "is-selected" : ""}`} aria-pressed={value === null} onClick={() => onChange(null)}>None</button>
        <button type="button" className={`chip ${value === 0 ? "is-selected" : ""}`} aria-pressed={value === 0} onClick={() => onChange(0)}>At start</button>
        {(Object.keys(REMINDER_UNITS) as ReminderUnit[]).map((u) => (
          <button type="button" key={u} className={`chip ${before && unit === u ? "is-selected" : ""}`} aria-pressed={before && unit === u} onClick={() => pick(u)}>{REMINDER_UNITS[u].label}</button>
        ))}
      </div>
      {before && (
        <div className="repeat-row subfields" style={{ ["--notch" as string]: `${notch}px` }}>
          <input
            type="number" className="input-inline days-input" min={1} max={most} aria-label={`How many ${unit} before`}
            value={draft ?? amount} onChange={(e) => setDraft(e.target.value)} onBlur={apply}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); apply(); } }}
          />
          <span className="muted">{amount === 1 && draft === null ? REMINDER_UNITS[unit].one : unit} before{amount >= most ? ` (the most is ${most})` : ""}</span>
        </div>
      )}
    </div>
  );
}

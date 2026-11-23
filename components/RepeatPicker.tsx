"use client";
import { useMemo, useState } from "react";
import { DateTime } from "luxon";
import { describeRule, expandRule, monthByChoices, toRule, MAX_OCCURRENCES, WEEKDAY_LABELS, type Freq, type RepeatChoice } from "@/lib/recurrence";
import { notchOf } from "./ReminderPicker";
import { useReveal } from "./useReveal";
import { Named } from "./FormBits";

const UNIT = { daily: "day", weekly: "week", monthly: "month", yearly: "year" } as const;
// How far a new repeat runs until the person says otherwise.
const DEFAULT_RUN = { daily: { weeks: 2 }, weekly: { weeks: 8 }, monthly: { months: 6 }, yearly: { years: 5 } } as const;

// How often something repeats, shared by the appointment and task forms. Each line reads as a clause
// (Every 2 weeks / on Mon, Wed / Ends after 10 times), then the rule is said back whole with what it comes to.
export default function RepeatPicker({
  value, onChange, date, startTime, endTime, tz, noun, note, neverLabel = "Never",
}: {
  neverLabel?: string; // what the first chip says: on an existing run, choosing nothing means "keep the dates"
  value: RepeatChoice;
  onChange: (c: RepeatChoice) => void;
  date: string; // the first date, yyyy-MM-dd
  startTime: string;
  endTime: string;
  tz: string;
  noun: string; // what is being repeated: "appointment", "task"
  note?: React.ReactNode; // shown under the picker
}) {
  const { freq, every, weekdays, ends, until, count } = value;
  const set = (patch: Partial<RepeatChoice>) => onChange({ ...value, ...patch });
  const [notch, setNotch] = useState(0); // where the chosen chip sits, so its settings box can point back at it
  const [untilSet, setUntilSet] = useState(!!until); // the person chose the end date; do not move it for them
  // Choosing how often, or how it ends, opens fields below the fold: bring them into view.
  const ref = useReveal<HTMLFieldSetElement>(`${freq}${ends}`);

  // Choosing how often fills in sensible starting values: the start date's weekday, and an end a fitting distance away.
  function pickFreq(f: Freq | "") {
    const d = DateTime.fromISO(date, { zone: tz });
    if (!f || !d.isValid) return set({ freq: f });
    set({ freq: f, ...(f === "weekly" && weekdays.length === 0 ? { weekdays: [d.weekday] } : {}), ...(untilSet ? {} : { until: d.plus(DEFAULT_RUN[f]).toISODate()! }) });
  }

  const monthChoices = monthByChoices(date);
  const rule = toRule(value, date, startTime, endTime, tz);
  const ruleKey = JSON.stringify(rule);
  // What the rule comes to, shown under it while choosing.
  const preview = useMemo(() => {
    if (!freq || !date || !startTime || !endTime) return [];
    try { return expandRule(rule); } catch { return []; }
  }, [ruleKey, freq]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <fieldset className="field reveal" ref={ref}>
      <legend><Named icon="repeat">Repeat</Named></legend>
      <div className="chips chips-xs" role="group" aria-label="How often" style={{ marginTop: 0 }}>
        {([["", neverLabel], ["daily", "Daily"], ["weekly", "Weekly"], ["monthly", "Monthly"], ["yearly", "Yearly"]] as const).map(([f, label]) => (
          <button type="button" key={f} className={`chip ${freq === f ? "is-selected" : ""}`} aria-pressed={freq === f} onClick={(e) => { setNotch(notchOf(e.currentTarget)); pickFreq(f); }}>{label}</button>
        ))}
      </div>
      {freq && (
        <div className="repeat subfields" style={{ ["--notch" as string]: `${notch}px` }}>
          <div className="repeat-row">
            <span className="muted">Every</span>
            <input type="number" className="input-inline days-input" min={1} max={99} aria-label={`Every how many ${UNIT[freq]}s`} value={every} onChange={(e) => set({ every: Math.max(1, Math.min(99, Math.floor(Number(e.target.value)) || 1)) })} />
            <span className="muted">{UNIT[freq]}{every > 1 ? "s" : ""}</span>
          </div>

          {freq === "weekly" && (
            <div className="repeat-row">
              <span className="chips chips-xs" role="group" aria-label="Weekdays" style={{ marginTop: 0 }}>
                {WEEKDAY_LABELS.map((w) => (
                  <button type="button" key={w.n} className={`chip ${weekdays.includes(w.n) ? "is-selected" : ""}`} aria-pressed={weekdays.includes(w.n)} aria-label={w.long}
                    onClick={() => set({ weekdays: weekdays.includes(w.n) ? weekdays.filter((x) => x !== w.n) : [...weekdays, w.n].sort() })}>
                    {w.short}
                  </button>
                ))}
              </span>
              <button type="button" className="link" onClick={() => set({ weekdays: [1, 2, 3, 4, 5] })}>Mon to Fri</button>
            </div>
          )}

          {(freq === "monthly" || freq === "yearly") && monthChoices.length > 1 && (
            <div className="chips chips-xs" role="group" aria-label="Which day" style={{ marginTop: 0 }}>
              {monthChoices.map((c) => (
                <button type="button" key={c.by} className={`chip ${rule.monthBy === c.by ? "is-selected" : ""}`} aria-pressed={rule.monthBy === c.by} onClick={() => set({ monthBy: c.by })}>
                  {c.label}{freq === "yearly" && c.by !== "date" ? ` of ${DateTime.fromISO(date).monthLong}` : ""}
                </button>
              ))}
            </div>
          )}

          <div className="repeat-row">
            <span className="muted">Ends</span>
            <span className="chips chips-xs" role="group" aria-label="How it ends" style={{ marginTop: 0 }}>
              <button type="button" className={`chip ${ends === "on" ? "is-selected" : ""}`} aria-pressed={ends === "on"} onClick={() => set({ ends: "on" })}>On a date</button>
              <button type="button" className={`chip ${ends === "after" ? "is-selected" : ""}`} aria-pressed={ends === "after"} onClick={() => set({ ends: "after" })}>After</button>
            </span>
            {ends === "on"
              ? <input type="date" className="input-inline" aria-label="Last date" value={until} min={date} onChange={(e) => { set({ until: e.target.value }); setUntilSet(true); }} />
              : <><input type="number" className="input-inline days-input" min={1} max={MAX_OCCURRENCES} aria-label="How many times" value={count} onChange={(e) => set({ count: Math.max(1, Math.min(MAX_OCCURRENCES, Math.floor(Number(e.target.value)) || 1)) })} /><span className="muted">times</span></>}
          </div>

          {/* The rule read back as a sentence, with what it comes to. */}
          <p className={`repeat-summary ${preview.length ? "" : "is-empty"}`} role="status">
            <strong>{describeRule(rule)}</strong>
            {preview.length > 0
              ? <span>{preview.length} {noun}{preview.length > 1 ? "s" : ""}, the last on {DateTime.fromISO(preview[preview.length - 1].date).toFormat("ccc d LLL yyyy")}.{preview.length === MAX_OCCURRENCES ? " That is the most one series can hold." : ""}</span>
              : <span>No date matches yet. {freq === "weekly" && !weekdays.length ? "Pick at least one weekday." : "Check when it ends."}</span>}
          </p>
        </div>
      )}
      {note}
    </fieldset>
  );
}

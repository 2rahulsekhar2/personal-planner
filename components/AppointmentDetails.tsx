"use client";
import { useState } from "react";
import { DateTime } from "luxon";
import type { PlannerCtx } from "./usePlanner";
import type { Appointment } from "@/lib/types";
import { REMINDER_CHOICES } from "@/lib/types";
import { fmtRange } from "@/lib/time";
import { isOverlapError } from "@/lib/conflicts";
import type { Circle } from "@/lib/circles";

const Icon = ({ d }: { d: string }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>
);

export default function AppointmentDetails({
  ctx, circles, appt, onEdit, onClose,
}: {
  ctx: PlannerCtx;
  circles: Circle[];
  appt: Appointment;
  onEdit: () => void;
  onClose: () => void;
}) {
  const { tz, typeById, placeById, supabase, refresh, toast } = ctx;
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null); // the draft while adding or editing notes here; null when not editing

  const [reason, setReason] = useState<string | null>(null); // the draft reason while marking "not done"; null when not asking

  async function setOutcome(outcome: "done" | "not_done" | null, why?: string) {
    if (busy) return;
    setBusy(true);
    const { error } = await supabase.from("appointments").update({ outcome, outcome_reason: outcome === "not_done" ? why?.trim() || null : null }).eq("id", appt.id);
    setBusy(false);
    if (error) {
      return setError(error.code === "42703" || error.code === "PGRST204"
        ? "This needs a one-time database update first: run supabase/migrations/0002_appointment_outcome.sql in the Supabase SQL editor."
        : `Couldn’t save: ${error.message}`);
    }
    await refresh();
    setReason(null);
    setError(null);
    toast("ok", outcome === "done" ? "Marked done" : outcome === "not_done" ? "Marked not done" : "Mark cleared");
  }

  async function saveNote() {
    if (note === null || busy) return;
    setBusy(true);
    const { error } = await supabase.from("appointments").update({ notes: note.trim() || null }).eq("id", appt.id);
    setBusy(false);
    if (error) return setError(`Couldn’t save the notes: ${error.message}`);
    await refresh();
    setNote(null);
    setError(null);
    toast("ok", "Notes saved");
  }
  const t = typeById.get(appt.activity_type_id ?? "");
  const mine = appt.user_id === ctx.userId; // only the creator can change it
  const sharedIn = circles.find((c) => c.id === appt.circle_id);
  const by = sharedIn?.circle_members.find((m) => m.user_id === appt.user_id)?.email;
  const p = appt.place_id ? placeById.get(appt.place_id) : null;
  const start = DateTime.fromISO(appt.starts_at).setZone(tz);
  const reminderLabel =
    appt.reminder_minutes === null
      ? "No reminder"
      : REMINDER_CHOICES.find((c) => c.value === appt.reminder_minutes)?.label ?? `${appt.reminder_minutes} minutes before`;

  async function cancel(scope: "one" | "series") {
    if (busy) return;
    setBusy(true);
    setError(null);
    let q = supabase.from("appointments").update({ status: "cancelled" });
    q = scope === "series" && appt.series_id ? q.eq("series_id", appt.series_id).gte("starts_at", appt.starts_at) : q.eq("id", appt.id);
    const { error } = await q;
    setBusy(false);
    if (error) return setError(`Couldn’t cancel: ${error.message}`);
    await refresh();
    toast("ok", scope === "series" ? "Cancelled this and following appointments" : "Appointment cancelled; reminder stopped");
    onClose();
  }

  async function restore() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.from("appointments").update({ status: "confirmed" }).eq("id", appt.id);
    setBusy(false);
    if (error) {
      return setError(isOverlapError(error) ? `Can’t restore: another ${t?.name ?? ""} appointment now uses this time.` : `Couldn’t restore: ${error.message}`);
    }
    await refresh();
    toast("ok", "Appointment restored");
  }

  return (
    <div className="details">
      <div className={`details-head act-${t?.color ?? "slate"} status-${appt.status}`}>
        <span className="type-label"><span className="swatch" aria-hidden />{t?.name ?? appt.custom_activity}{t?.archived_at ? " (archived)" : ""}</span>
        <h3>{appt.title}</h3>
        <p className="details-when">
          {start.toFormat("cccc, d LLLL yyyy")}
          <br />
          {fmtRange(appt.starts_at, appt.ends_at, tz)}
        </p>
        <span className={`status-badge status-${appt.status}`}>
          {appt.status === "confirmed" ? "● Confirmed" : appt.status === "tentative" ? "◌ Tentative" : "✕ Cancelled"}
        </span>
      </div>

      {/* Did it happen? Two switches; pressing the lit one again clears the mark. */}
      {mine && appt.status !== "cancelled" && (
        <div className="outcome">
          <div className="outcome-toggle" role="group" aria-label="Did this appointment happen?">
            <button className={`outcome-btn is-done ${appt.outcome === "done" ? "is-on" : ""}`} aria-pressed={appt.outcome === "done"} disabled={busy} onClick={() => { setReason(null); setOutcome(appt.outcome === "done" ? null : "done"); }}>
              <Icon d="M5 12.5l4.5 4.5L19 7.5" /> Done
            </button>
            <button className={`outcome-btn is-not ${appt.outcome === "not_done" || reason !== null ? "is-on" : ""}`} aria-pressed={appt.outcome === "not_done"} disabled={busy} onClick={() => (appt.outcome === "not_done" ? setOutcome(null) : setReason(reason === null ? "" : null))}>
              <Icon d="M6 6l12 12M18 6L6 18" /> Not done
            </button>
          </div>
          {reason !== null ? (
            <div className="outcome-reason">
              <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason it was not done (optional)" placeholder="Reason (optional)" autoFocus />
              <div className="row">
                <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => setOutcome("not_done", reason)}>Save as not done</button>
                <button className="btn btn-sm btn-ghost" onClick={() => setReason(null)}>Cancel</button>
              </div>
            </div>
          ) : appt.outcome === "not_done" && (
            <p className="outcome-reason">
              {appt.outcome_reason ? <span className="pre">{appt.outcome_reason} </span> : <span className="muted">No reason given. </span>}
              <button className="link" onClick={() => setReason(appt.outcome_reason ?? "")}>{appt.outcome_reason ? "Edit reason" : "Add a reason"}</button>
            </p>
          )}
        </div>
      )}

      {/* Each row leads with an icon; the term stays in the markup for screen readers. */}
      <dl className="details-list">
        <dt><Icon d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11zM12 12.3a2.3 2.3 0 1 0 0-4.6 2.3 2.3 0 0 0 0 4.6z" /><span className="sr-only">Place</span></dt>
        <dd>
          {p ? (
            <>
              <span>{p.name}{p.archived_at ? " (archived)" : ""}</span>
              {p.notes && <span className="muted">{p.notes}</span>}
              <a className="link" href={p.maps_url} target="_blank" rel="noopener noreferrer">Open in Google Maps</a>
            </>
          ) : appt.custom_place ? (
            <span>{appt.custom_place}</span>
          ) : (
            <span className="muted">No place</span>
          )}
        </dd>
        <dt><Icon d="M6 9.5a6 6 0 0 1 12 0c0 4.5 2 5.5 2 6.5H4c0-1 2-2 2-6.5zM10 19.5a2 2 0 0 0 4 0" /><span className="sr-only">Reminder</span></dt>
        <dd>{appt.status === "cancelled" ? <span className="muted">Reminder stopped (cancelled)</span> : appt.reminder_minutes === null ? <span className="muted">No reminder</span> : `Reminder ${reminderLabel.toLowerCase()}`}</dd>
        {appt.team && (<><dt><Icon d="M8.5 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 19a5.5 5.5 0 0 1 11 0M16 11a2.5 2.5 0 1 0 0-5M17 14.5a4.5 4.5 0 0 1 4 4.5" /><span className="sr-only">Team</span></dt><dd>{appt.team}</dd></>)}
        {appt.series_id && (<><dt><Icon d="M17 3l3 3-3 3M20 6H9a5 5 0 0 0-5 5M7 21l-3-3 3-3M4 18h11a5 5 0 0 0 5-5" /><span className="sr-only">Repeats</span></dt><dd>Part of a weekly series</dd></>)}
        <dt><Icon d="M5 4h14v11l-5 5H5zM14 20v-5h5M8.5 9h7M8.5 12.5h4" /><span className="sr-only">Notes</span></dt>
        <dd>
          {note !== null ? (
            <>
              <textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)} aria-label="Notes" autoFocus />
              <div className="row">
                <button className="btn btn-sm btn-primary" disabled={busy} onClick={saveNote}>Save notes</button>
                <button className="btn btn-sm btn-ghost" onClick={() => setNote(null)}>Cancel</button>
              </div>
            </>
          ) : appt.notes ? (
            <>
              <div className="note-block">{appt.notes}</div>
              {mine && <button className="link" onClick={() => setNote(appt.notes ?? "")}>Edit notes</button>}
            </>
          ) : mine ? (
            <button className="link" onClick={() => setNote("")}>Add notes</button>
          ) : (
            <span className="muted">No notes</span>
          )}
        </dd>
      </dl>

      {/* Who can see it, and whose it is. */}
      {sharedIn && <p className="hint">Shared with {sharedIn.name}{mine ? ". Everyone in it can see this." : `, added by ${by ?? "another member"}. Only they can change it.`}</p>}
      {!mine && appt.outcome && <p className="hint">Marked {appt.outcome === "done" ? "done" : "not done"}{appt.outcome_reason ? `: ${appt.outcome_reason}` : ""}.</p>}

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      {mine && <div className="form-actions">
        {appt.status !== "cancelled" ? (
          <>
            <button className="btn btn-primary" onClick={onEdit}>Edit</button>
            {!confirmCancel ? (
              <button className="btn btn-ghost btn-danger" onClick={() => setConfirmCancel(true)}>Cancel appointment</button>
            ) : (
              <div className="confirm-box">
                <p>Cancel {appt.series_id ? "which appointments" : "this appointment"}? The record is kept and its reminder stops.</p>
                <div className="row">
                  <button className="btn btn-danger" disabled={busy} onClick={() => cancel("one")}>{appt.series_id ? "Only this one" : "Yes, cancel it"}</button>
                  {appt.series_id && <button className="btn btn-danger" disabled={busy} onClick={() => cancel("series")}>This and following</button>}
                  <button className="btn btn-ghost" onClick={() => setConfirmCancel(false)}>Keep</button>
                </div>
              </div>
            )}
          </>
        ) : (
          <button className="btn" disabled={busy} onClick={restore}>Restore appointment</button>
        )}
      </div>}
    </div>
  );
}

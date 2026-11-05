"use client";
import { useState } from "react";
import { DateTime } from "luxon";
import type { PlannerCtx } from "./usePlanner";
import type { Appointment } from "@/lib/types";
import { REMINDER_CHOICES } from "@/lib/types";
import { fmtRange } from "@/lib/time";
import { isOverlapError } from "@/lib/conflicts";

export default function AppointmentDetails({
  ctx, appt, onEdit, onClose,
}: {
  ctx: PlannerCtx;
  appt: Appointment;
  onEdit: () => void;
  onClose: () => void;
}) {
  const { tz, typeById, placeById, supabase, refresh, toast } = ctx;
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = typeById.get(appt.activity_type_id);
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
        <span className="type-label"><span className="swatch" aria-hidden />{t?.name}{t?.archived_at ? " (archived)" : ""}</span>
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

      <dl className="details-list">
        <dt>Place</dt>
        <dd>
          {p ? (
            <>
              {p.name}{p.archived_at ? " (archived)" : ""}
              {p.notes && <div className="muted">{p.notes}</div>}
              <a className="btn btn-sm" href={p.maps_url} target="_blank" rel="noopener noreferrer">Open in Google Maps ↗</a>
            </>
          ) : (
            <span className="muted">No place</span>
          )}
        </dd>
        <dt>Reminder</dt>
        <dd>{appt.status === "cancelled" ? <span className="muted">Stopped (cancelled)</span> : reminderLabel}</dd>
        {appt.team && (<><dt>Team</dt><dd>{appt.team}</dd></>)}
        {appt.notes && (<><dt>Notes</dt><dd className="pre">{appt.notes}</dd></>)}
        {appt.series_id && (<><dt>Repeats</dt><dd>Part of a weekly series</dd></>)}
      </dl>

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      <div className="form-actions">
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
      </div>
    </div>
  );
}

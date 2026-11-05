"use client";
import { useRef, useState } from "react";
import { DateTime } from "luxon";
import type { PlannerCtx } from "./usePlanner";
import type { Task } from "@/lib/types";
import { hhmm, isTaskOverdue, localToDateTime, todayISO } from "@/lib/time";

export default function TaskForm({ ctx, existing, date, onDone }: { ctx: PlannerCtx; existing?: Task; date?: string; onDone: () => void }) {
  const { tz, supabase, refresh, toast } = ctx;
  const today = todayISO(tz);
  const tomorrow = DateTime.fromISO(today, { zone: tz }).plus({ days: 1 }).toISODate()!;
  const exNotify = existing?.notify_at ? DateTime.fromISO(existing.notify_at).setZone(tz) : null;

  const [title, setTitle] = useState(existing?.title ?? "");
  const [due, setDue] = useState(existing?.due_date ?? date ?? today);
  const [dueTime, setDueTime] = useState(hhmm(existing?.due_time));
  const [notify, setNotify] = useState(!!exNotify);
  const [notifyDate, setNotifyDate] = useState(exNotify?.toISODate() ?? existing?.due_date ?? date ?? today);
  const [notifyTime, setNotifyTime] = useState(exNotify?.toFormat("HH:mm") ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef<string>(crypto.randomUUID());

  function toggleNotify(on: boolean) {
    setNotify(on);
    if (on && !notifyTime) {
      setNotifyDate(due);
      setNotifyTime(dueTime || "09:00");
    }
  }

  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    if (saving) return;
    if (!title.trim()) return setError("Give the task a title.");
    if (!due) return setError("Choose a due date.");
    let notifyAt: string | null = null;
    if (notify) {
      if (!notifyDate || !notifyTime) return setError("Choose when to be notified, or turn the notification off.");
      const n = localToDateTime(notifyDate, notifyTime, tz);
      if (!n.isValid) return setError("That notification time isn’t valid.");
      if (n < DateTime.now().minus({ minutes: 1 })) return setError("The notification time has already passed.");
      notifyAt = n.toUTC().toISO();
    }
    setSaving(true);
    setError(null);
    const row = { title: title.trim(), due_date: due, due_time: dueTime || null, notify_at: notifyAt, notes: notes.trim() || null };
    const { error } = existing
      ? await supabase.from("tasks").update(row).eq("id", existing.id)
      : await supabase.from("tasks").insert({ ...row, client_request_id: requestId.current });
    setSaving(false);
    if (error && error.code !== "23505") return setError(`Couldn’t save: ${error.message}. Try again.`);
    await refresh();
    toast("ok", existing ? "Task updated" : "Task saved");
    onDone();
  }

  async function setState(state: Task["state"]) {
    if (!existing || saving) return;
    setSaving(true);
    const { error } = await supabase
      .from("tasks")
      .update({ state, completed_at: state === "completed" ? new Date().toISOString() : null })
      .eq("id", existing.id);
    setSaving(false);
    if (error) return setError(`Couldn’t update: ${error.message}`);
    await refresh();
    toast("ok", state === "completed" ? "Marked done" : state === "dismissed" ? "Task dismissed" : "Task reopened");
    onDone();
  }

  const overdue = existing ? isTaskOverdue(existing, tz) : false;

  return (
    <form className="form" onSubmit={save} noValidate>
      {existing && (
        <p className={`status-badge ${overdue ? "is-overdue" : ""}`}>
          {existing.state === "completed" ? "✓ Completed" : existing.state === "dismissed" ? "Dismissed" : overdue ? "! Overdue" : "Pending"}
        </p>
      )}
      <label className="field">
        <span>Task</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Call Rahul" autoFocus={!existing} />
      </label>
      <fieldset className="field">
        <legend>Due</legend>
        <div className="chips">
          <button type="button" className={`chip ${due === today ? "is-selected" : ""}`} aria-pressed={due === today} onClick={() => setDue(today)}>Today</button>
          <button type="button" className={`chip ${due === tomorrow ? "is-selected" : ""}`} aria-pressed={due === tomorrow} onClick={() => setDue(tomorrow)}>Tomorrow</button>
          <input type="date" aria-label="Due date" value={due} onChange={(e) => setDue(e.target.value)} className="input-inline" />
        </div>
      </fieldset>
      <label className="field">
        <span>Due time <span className="muted">(optional)</span></span>
        <div className="row">
          <input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
          {dueTime && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDueTime("")}>Clear</button>}
        </div>
      </label>
      <fieldset className="field">
        <legend>Notification</legend>
        <label className="check"><input type="checkbox" checked={notify} onChange={(e) => toggleNotify(e.target.checked)} /> Notify me</label>
        {notify && (
          <div className="field-row">
            <label className="field"><span>Date</span><input type="date" value={notifyDate} onChange={(e) => setNotifyDate(e.target.value)} /></label>
            <label className="field"><span>Time</span><input type="time" value={notifyTime} onChange={(e) => setNotifyTime(e.target.value)} /></label>
          </div>
        )}
        {notify && <p className="hint">Browser reminders can arrive a minute or so late. For time-critical tasks like Tatkal booking, set the notification a few minutes early.</p>}
      </fieldset>
      <label className="field"><span>Notes <span className="muted">(optional)</span></span><textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : existing ? "Save changes" : "Save"}</button>
        {existing && existing.state === "pending" && (
          <>
            <button type="button" className="btn" disabled={saving} onClick={() => setState("completed")}>✓ Mark done</button>
            <button type="button" className="btn btn-ghost" disabled={saving} onClick={() => setState("dismissed")}>Dismiss</button>
          </>
        )}
        {existing && existing.state !== "pending" && (
          <button type="button" className="btn" disabled={saving} onClick={() => setState("pending")}>Reopen</button>
        )}
      </div>
    </form>
  );
}

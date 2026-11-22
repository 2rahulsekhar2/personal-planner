"use client";
import { useRef, useState } from "react";
import { DateTime } from "luxon";
import type { PlannerCtx } from "./usePlanner";
import type { Task } from "@/lib/types";
import { isCurrent, seatsOf, type Circle } from "@/lib/circles";
import { hhmm, isTaskOverdue, localToDateTime, todayISO } from "@/lib/time";
import { expandRule, toRule, NO_REPEAT, type RepeatChoice } from "@/lib/recurrence";
import RepeatPicker from "./RepeatPicker";

export default function TaskForm({ ctx, circles, circleId: startCircle, existing, date, time, onDone }: { ctx: PlannerCtx; circles: Circle[]; circleId?: string; existing?: Task; date?: string; time?: string; onDone: () => void }) {
  const { tz, supabase, refresh, toast } = ctx;
  const today = todayISO(tz);
  const tomorrow = DateTime.fromISO(today, { zone: tz }).plus({ days: 1 }).toISODate()!;
  const exNotify = existing?.notify_at ? DateTime.fromISO(existing.notify_at).setZone(tz) : null;

  const [title, setTitle] = useState(existing?.title ?? "");
  const [due, setDue] = useState(existing?.due_date ?? date ?? today);
  const [dueTime, setDueTime] = useState(existing ? hhmm(existing.due_time) : time ?? "");
  const [notify, setNotify] = useState(!!exNotify);
  const [notifyDate, setNotifyDate] = useState(exNotify?.toISODate() ?? existing?.due_date ?? date ?? today);
  const [notifyTime, setNotifyTime] = useState(exNotify?.toFormat("HH:mm") ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  // Shared with this circle, or "" for private. New ones start in the circle being viewed.
  const [circleId, setCircleId] = useState(existing ? existing.circle_id ?? "" : startCircle ?? "");
  // On a shared task: the member it is for, or "" for anyone in the circle.
  const [assignee, setAssignee] = useState(existing?.assignee_id ?? "");
  // Viewers, and people whose access has ended, cannot be given a task.
  const members = seatsOf(circles.find((c) => c.id === circleId) ?? { id: "", name: "", owner_id: "", circle_members: [] }).filter((m) => m.role !== "viewer" && isCurrent(m));
  const share = (id: string) => { setCircleId(id); setAssignee(""); };
  const [rep, setRep] = useState<RepeatChoice>(NO_REPEAT); // new tasks only: one task is made for each date
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
    // A repeating task becomes one task per date. The times do not matter here: only the dates are used.
    const dates = !existing && rep.freq ? expandRule(toRule(rep, due, "00:00", "00:01", tz)).map((o) => o.date) : [due];
    if (!dates.length) return setError("No date matches that repeat before it ends.");
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
    // circle_id is sent only when the database has the sharing columns.
    const row = { title: title.trim(), due_date: due, due_time: dueTime || null, notify_at: notifyAt, notes: notes.trim() || null, ...(ctx.sharing ? { circle_id: circleId || null } : {}), ...(ctx.people ? { assignee_id: circleId ? assignee || null : null } : {}) };
    let error;
    if (existing) ({ error } = await supabase.from("tasks").update(row).eq("id", existing.id));
    else if (dates.length === 1 && !rep.freq) ({ error } = await supabase.from("tasks").insert({ ...row, client_request_id: requestId.current }));
    else {
      // Each date gets its own task, with its notification the same distance from its due date as on the first.
      const shift = notifyAt ? DateTime.fromISO(notifyDate).diff(DateTime.fromISO(due), "days").days : 0;
      const series = crypto.randomUUID();
      const rows = dates.map((d) => {
        const n = notifyAt ? localToDateTime(DateTime.fromISO(d).plus({ days: shift }).toISODate()!, notifyTime, tz) : null;
        return { ...row, due_date: d, notify_at: n && n > DateTime.now() ? n.toUTC().toISO() : null, client_request_id: crypto.randomUUID() };
      });
      ({ error } = await supabase.from("tasks").insert(rows.map((r) => ({ ...r, series_id: series }))));
      // Without 0014_series_edit.sql there is no series_id column: save them as separate tasks.
      if (error && (error.code === "42703" || error.code === "PGRST204")) ({ error } = await supabase.from("tasks").insert(rows));
    }
    setSaving(false);
    if (error && error.code !== "23505") return setError(`Couldn’t save: ${error.message}. Try again.`);
    await refresh();
    toast("ok", existing ? "Task updated" : dates.length > 1 ? `Saved ${dates.length} tasks` : "Task saved");
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

  // A repeating task: dismiss this one and every later one still pending, in one go.
  async function dismissFollowing() {
    if (!existing?.series_id || saving) return;
    setSaving(true);
    const { error } = await supabase.from("tasks").update({ state: "dismissed", completed_at: null }).eq("series_id", existing.series_id).eq("state", "pending").gte("due_date", existing.due_date);
    setSaving(false);
    if (error) return setError(`Couldn’t update: ${error.message}`);
    await refresh();
    toast("ok", "Dismissed this task and the following ones");
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
      {ctx.sharing && circles.length > 0 && (
        <fieldset className="field">
          <legend>Share with</legend>
          <div className="chips chips-xs" style={{ marginTop: 0 }}>
            <button type="button" className={`chip ${!circleId ? "is-selected" : ""}`} aria-pressed={!circleId} onClick={() => share("")}>Just me</button>
            {circles.map((c) => (
              <button type="button" key={c.id} className={`chip ${circleId === c.id ? "is-selected" : ""}`} aria-pressed={circleId === c.id} onClick={() => share(c.id)}>{c.name}</button>
            ))}
          </div>
          {circleId && <span className="hint">Everyone in {circles.find((c) => c.id === circleId)?.name} can see this. Only you can change it.</span>}
        </fieldset>
      )}

      {ctx.people && circleId && members.length > 1 && (
        <fieldset className="field">
          <legend>Who does it</legend>
          <div className="chips chips-xs" style={{ marginTop: 0 }}>
            <button type="button" className={`chip ${!assignee ? "is-selected" : ""}`} aria-pressed={!assignee} onClick={() => setAssignee("")}>Anyone</button>
            {members.map((m) => (
              <button type="button" key={m.user_id} className={`chip ${assignee === m.user_id ? "is-selected" : ""}`} aria-pressed={assignee === m.user_id} title={m.email} onClick={() => setAssignee(m.user_id)}>
                <span className={`who act-${m.color}`} aria-hidden>{m.letter}</span> {m.user_id === ctx.userId ? "Me" : m.email.split("@")[0]}
              </button>
            ))}
          </div>
          <span className="hint">{assignee ? "They can mark it done, and so can you." : "Whoever does it can mark it done."}</span>
        </fieldset>
      )}

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
      {!existing && <RepeatPicker value={rep} onChange={setRep} date={due} startTime="00:00" endTime="00:01" tz={tz} noun="task" />}
      {existing?.series_id && <p className="hint">One of a repeating set of tasks. Changes here apply to this one only.</p>}
      <label className="field"><span>Notes <span className="muted">(optional)</span></span><textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : existing ? "Save changes" : "Save"}</button>
        {existing && existing.state === "pending" && (
          <>
            <button type="button" className="btn" disabled={saving} onClick={() => setState("completed")}>✓ Mark done</button>
            <button type="button" className="btn btn-ghost" disabled={saving} onClick={() => setState("dismissed")}>Dismiss</button>
            {existing.series_id && <button type="button" className="btn btn-ghost" disabled={saving} onClick={dismissFollowing}>Dismiss this and following</button>}
          </>
        )}
        {existing && existing.state !== "pending" && (
          <button type="button" className="btn" disabled={saving} onClick={() => setState("pending")}>Reopen</button>
        )}
      </div>
    </form>
  );
}

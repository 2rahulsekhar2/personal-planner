"use client";
import { useRef, useState } from "react";
import { DateTime } from "luxon";
import type { PlannerCtx } from "./usePlanner";
import type { Task } from "@/lib/types";
import { minutesBefore, splitReminders, tidyReminders } from "@/lib/types";
import ReminderChips from "./ReminderChips";
import { isCurrent, seatsOf, type Circle } from "@/lib/circles";
import { hhmm, isTaskOverdue, localToDateTime, todayISO } from "@/lib/time";
import { expandRule, toRule, NO_REPEAT, type RepeatChoice } from "@/lib/recurrence";
import RepeatPicker from "./RepeatPicker";
import { Named, Step } from "./FormBits";

export default function TaskForm({ ctx, circles, circleId: startCircle, existing, date, time, onDone }: { ctx: PlannerCtx; circles: Circle[]; circleId?: string; existing?: Task; date?: string; time?: string; onDone: () => void }) {
  const { tz, supabase, refresh, toast } = ctx;
  const today = todayISO(tz);
  const tomorrow = DateTime.fromISO(today, { zone: tz }).plus({ days: 1 }).toISODate()!;

  const [title, setTitle] = useState(existing?.title ?? "");
  const [due, setDue] = useState(existing?.due_date ?? date ?? today);
  const [dueTime, setDueTime] = useState(existing ? hhmm(existing.due_time) : time ?? "");
  // A task with no time counts its reminders from this time on the due day.
  const NO_TIME = "09:00";
  // When the task due on `d` is due, as a moment: what its reminders are counted back from.
  const dueAt = (d: string, t = dueTime) => localToDateTime(d, t || NO_TIME, tz);
  // Minutes before it is due, one for each reminder; empty for none. The database holds the moments themselves.
  const [reminders, setReminders] = useState<number[]>(() => {
    if (!existing) return [];
    const ref = dueAt(existing.due_date, hhmm(existing.due_time)).toUTC().toISO()!;
    return tidyReminders([existing.notify_at, ...(existing.extra_notify_at ?? [])].map((n) => (n ? minutesBefore(ref, n) : null)));
  });
  const [notes, setNotes] = useState(existing?.notes ?? "");
  // Shared with this circle, or "" for private. New ones start in the circle being viewed.
  const [circleId, setCircleId] = useState(existing ? existing.circle_id ?? "" : startCircle ?? "");
  // On a shared task: the member it is for, or "" for anyone in the circle.
  const [assignee, setAssignee] = useState(existing?.assignee_id ?? "");
  // Viewers, and people whose access has ended, cannot be given a task.
  const members = seatsOf(circles.find((c) => c.id === circleId) ?? { id: "", name: "", owner_id: "", circle_members: [] }).filter((m) => m.role !== "viewer" && isCurrent(m));
  const share = (id: string) => { setCircleId(id); setAssignee(""); };
  const [rep, setRep] = useState<RepeatChoice>(NO_REPEAT); // one task is made for each date
  // On a pending task from a repeat: change only this one, or this and the later ones still pending.
  const inRun = !!existing?.series_id && existing.state === "pending";
  const [scope, setScope] = useState<"one" | "series">("one");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef<string>(crypto.randomUUID());


  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    if (saving) return;
    if (!title.trim()) return setError("Give the task a title.");
    if (!due) return setError("Choose a due date.");
    // On a task from a repeat: "one" changes this task; "series" also reaches the later ones still pending.
    const run = !!existing?.series_id && scope === "series";
    const remake = run && !!rep.freq; // a new repeat was chosen: the run from here on is made again
    // A repeating task becomes one task per date. The times do not matter here: only the dates are used.
    const dates = (!existing || remake) && rep.freq ? expandRule(toRule(rep, due, "00:00", "00:01", tz)).map((o) => o.date) : [due];
    if (!dates.length) return setError("No date matches that repeat before it ends.");
    // The reminders of the task due on `d`. One whose time has already passed is left out.
    const remindersFor = (d: string) => {
      const at = reminders.map((m) => dueAt(d).minus({ minutes: m }));
      const { first, rest } = splitReminders(tidyReminders(at.filter((n) => n.isValid && n > DateTime.now().minus({ minutes: 1 })).map((n) => n.toUTC().toISO())));
      return { notify_at: first, ...(ctx.manyReminders ? { extra_notify_at: rest } : {}) };
    };
    setSaving(true);
    setError(null);
    // What every task of a run has in common. circle_id is sent only when the database has the sharing columns.
    const shared = { title: title.trim(), due_time: dueTime || null, notes: notes.trim() || null, ...(ctx.sharing ? { circle_id: circleId || null } : {}), ...(ctx.people ? { assignee_id: circleId ? assignee || null : null } : {}) };
    const row = { ...shared, due_date: due, ...remindersFor(due) };
    // One row per date.
    const rows = dates.map((d) => ({ ...shared, due_date: d, ...remindersFor(d), client_request_id: crypto.randomUUID() }));
    let error;
    let done = "Task saved";
    if (remake) {
      // The new run is saved before the old one is removed, so a failure in between leaves too many tasks, never too few.
      const old = await supabase.from("tasks").select("id").eq("series_id", existing!.series_id).eq("state", "pending").gte("due_date", existing!.due_date);
      error = old.error;
      if (!error) ({ error } = await supabase.from("tasks").insert(rows.map((r) => ({ ...r, series_id: existing!.series_id }))));
      if (!error) ({ error } = await supabase.from("tasks").delete().in("id", (old.data ?? []).map((t: { id: string }) => t.id)));
      done = `Replaced with ${rows.length} task${rows.length > 1 ? "s" : ""}`;
    } else if (existing) {
      ({ error } = await supabase.from("tasks").update(row).eq("id", existing.id));
      done = "Task updated";
      if (!error && run) {
        // The later ones keep their own dates and notifications.
        const later = await supabase.from("tasks").update(shared).eq("series_id", existing.series_id).eq("state", "pending").gt("due_date", existing.due_date).select("id");
        error = later.error;
        done = `Updated this and ${later.data?.length ?? 0} following`;
      }
    } else if (!rep.freq) ({ error } = await supabase.from("tasks").insert({ ...row, client_request_id: requestId.current }));
    else {
      const series = crypto.randomUUID(); // one id for the whole run
      ({ error } = await supabase.from("tasks").insert(rows.map((r) => ({ ...r, series_id: series }))));
      // Without 0014_series_edit.sql there is no series_id column: save them as separate tasks.
      if (error && (error.code === "42703" || error.code === "PGRST204")) ({ error } = await supabase.from("tasks").insert(rows));
      done = `Saved ${rows.length} tasks`;
    }
    setSaving(false);
    if (error && error.code !== "23505") return setError(`Couldn’t save: ${error.message}. Try again.`);
    await refresh();
    toast("ok", done);
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
      {inRun && (
        <fieldset className="field">
          <legend><Named icon="repeat">Apply changes to</Named></legend>
          <div className="segmented">
            <button type="button" className={scope === "one" ? "is-active" : ""} aria-pressed={scope === "one"} onClick={() => setScope("one")}>This task</button>
            <button type="button" className={scope === "series" ? "is-active" : ""} aria-pressed={scope === "series"} onClick={() => setScope("series")}>This and following</button>
          </div>
        </fieldset>
      )}
      {/* The same stops as an appointment: what, when, who, and the rest. Each mark fills once its stop is answered. */}
      <div className="steps act-slate">
        <Step icon="check" name="What" set={!!title.trim()}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Call Rahul" aria-label="Task" autoFocus={!existing} />
        </Step>

        {/* When it is due: the day, and a time if it has one, kept together. */}
        <Step icon="clock" name="When" set={!!due}>
          <div className="chips">
            <button type="button" className={`chip ${due === today ? "is-selected" : ""}`} aria-pressed={due === today} onClick={() => setDue(today)}>Today</button>
            <button type="button" className={`chip ${due === tomorrow ? "is-selected" : ""}`} aria-pressed={due === tomorrow} onClick={() => setDue(tomorrow)}>Tomorrow</button>
            <input type="date" aria-label="Due date" value={due} onChange={(e) => setDue(e.target.value)} className="input-inline" />
          </div>
          <div className="row">
            <input type="time" aria-label="Due time, optional" className="input-inline" value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
            {dueTime ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDueTime("")}>No time</button> : <span className="muted">Any time</span>}
          </div>
        </Step>

        {ctx.sharing && circles.length > 0 && (
          <Step icon="people" name="Who" set={!!circleId}>
            <div className="chips chips-xs" role="group" aria-label="Share with">
              <button type="button" className={`chip ${!circleId ? "is-selected" : ""}`} aria-pressed={!circleId} onClick={() => share("")}>Just me</button>
              {circles.map((c) => (
                <button type="button" key={c.id} className={`chip ${circleId === c.id ? "is-selected" : ""}`} aria-pressed={circleId === c.id} onClick={() => share(c.id)}>{c.name}</button>
              ))}
            </div>
            {ctx.people && circleId && members.length > 1 && (
              <div className="chips chips-xs" role="group" aria-label="Who does it">
                <button type="button" className={`chip ${!assignee ? "is-selected" : ""}`} aria-pressed={!assignee} onClick={() => setAssignee("")}>Anyone</button>
                {members.map((m) => (
                  <button type="button" key={m.user_id} className={`chip ${assignee === m.user_id ? "is-selected" : ""}`} aria-pressed={assignee === m.user_id} title={m.email} onClick={() => setAssignee(m.user_id)}>
                    <span className={`who act-${m.color}`} aria-hidden>{m.letter}</span> {m.user_id === ctx.userId ? "Me" : m.email.split("@")[0]}
                  </button>
                ))}
              </div>
            )}
          </Step>
        )}

        <Step icon="more" name="More" set={reminders.length > 0 || !!rep.freq || !!notes.trim()}>
          <div className="stack">
            <fieldset className="field">
              <legend><Named icon="bell">Reminder</Named></legend>
              <ReminderChips value={reminders} onChange={setReminders} many={ctx.manyReminders} zero="When due" />
              {reminders.length > 0 && !dueTime && <p className="hint">Counted from 9 AM, as it has no time.</p>}
            </fieldset>
            {!existing && <RepeatPicker value={rep} onChange={setRep} date={due} startTime="00:00" endTime="00:01" tz={tz} noun="task" />}
            {inRun && scope === "series" && (
              <RepeatPicker
                value={rep} onChange={setRep} date={due} startTime="00:00" endTime="00:01" tz={tz} noun="task" neverLabel="Keep dates"
                note={<span className="hint">{rep.freq
                  ? "Saving replaces this task and the later pending ones with this new run. Done and dismissed ones stay."
                  : "The title, time, sharing and notes also go to the later tasks still pending. Their dates and notifications stay as they are."}</span>}
              />
            )}
            <label className="field"><span><Named icon="note">Notes</Named></span><textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
          </div>
        </Step>
      </div>

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : existing ? "Save changes" : "Save"}</button>
        {existing && existing.state === "pending" && (
          <>
            <button type="button" className="btn" disabled={saving} onClick={() => setState("completed")}>✓ Mark done</button>
            {/* Dismiss follows the choice above, like Save: this task, or this and the later ones. */}
            {inRun && scope === "series"
              ? <button type="button" className="btn btn-ghost" disabled={saving} onClick={dismissFollowing}>Dismiss this and following</button>
              : <button type="button" className="btn btn-ghost" disabled={saving} onClick={() => setState("dismissed")}>Dismiss</button>}
          </>
        )}
        {existing && existing.state !== "pending" && (
          <button type="button" className="btn" disabled={saving} onClick={() => setState("pending")}>Reopen</button>
        )}
      </div>
    </form>
  );
}

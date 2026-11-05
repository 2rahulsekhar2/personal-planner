"use client";
import { useState } from "react";
import { DateTime } from "luxon";
import type { PlannerCtx } from "./usePlanner";
import type { Task } from "@/lib/types";
import { fmtClock, isTaskOverdue, relativeDayLabel } from "@/lib/time";

export default function TasksView({ ctx, onOpen, onNew }: { ctx: PlannerCtx; onOpen: (id: string) => void; onNew: () => void }) {
  const { tasks, tz, supabase, refresh, toast } = ctx;
  const [showDone, setShowDone] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const overdue = tasks.filter((t) => isTaskOverdue(t, tz));
  const pending = tasks.filter((t) => t.state === "pending" && !isTaskOverdue(t, tz));
  const done = tasks.filter((t) => t.state !== "pending").sort((a, b) => b.due_date.localeCompare(a.due_date));

  async function complete(t: Task) {
    if (busy) return;
    setBusy(t.id);
    const { error } = await supabase.from("tasks").update({ state: "completed", completed_at: new Date().toISOString() }).eq("id", t.id);
    setBusy(null);
    if (error) return toast("error", `Couldn’t update: ${error.message}`);
    await refresh();
    toast("ok", `Done: ${t.title}`);
  }

  const Row = ({ t }: { t: Task }) => {
    const od = isTaskOverdue(t, tz);
    return (
      <li className={`task-row ${od ? "is-overdue" : ""} ${t.state !== "pending" ? "is-done" : ""}`}>
        {t.state === "pending" ? (
          <button className="task-check" aria-label={`Mark “${t.title}” done`} disabled={busy === t.id} onClick={() => complete(t)} />
        ) : (
          <span className="task-check is-checked" aria-hidden>{t.state === "completed" ? "✓" : "–"}</span>
        )}
        <button className="task-main" onClick={() => onOpen(t.id)}>
          <span className="task-title">{t.title}</span>
          <span className="task-due">
            {od && <strong className="overdue-label">Overdue · </strong>}
            {relativeDayLabel(t.due_date, tz)}
            {t.due_time && `, ${fmtClock(t.due_time)}`}
            {t.notify_at && t.state === "pending" && ` · 🔔 ${DateTime.fromISO(t.notify_at).setZone(tz).toFormat("ccc h:mm a")}`}
            {t.state === "dismissed" && " · Dismissed"}
          </span>
        </button>
      </li>
    );
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>Tasks</h1>
        <button className="btn btn-primary" onClick={onNew}>＋ New task</button>
      </div>

      {overdue.length > 0 && (
        <section className="card card-alert">
          <h2 className="section-title">Overdue ({overdue.length})</h2>
          <p className="hint">These stay here until you mark them done, reschedule or dismiss them.</p>
          <ul className="task-list">{overdue.map((t) => <Row key={t.id} t={t} />)}</ul>
        </section>
      )}

      <section className="card">
        <h2 className="section-title">Pending</h2>
        {pending.length === 0 ? <p className="empty">Nothing pending.</p> : <ul className="task-list">{pending.map((t) => <Row key={t.id} t={t} />)}</ul>}
      </section>

      <section className="card">
        <button className="disclosure" aria-expanded={showDone} onClick={() => setShowDone(!showDone)}>
          {showDone ? "▾" : "▸"} Completed and dismissed ({done.length})
        </button>
        {showDone && (done.length === 0 ? <p className="empty">None yet.</p> : <ul className="task-list">{done.map((t) => <Row key={t.id} t={t} />)}</ul>)}
      </section>
    </div>
  );
}

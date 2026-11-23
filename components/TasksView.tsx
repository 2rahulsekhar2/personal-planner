"use client";
import { useState } from "react";
import { DateTime } from "luxon";
import type { PlannerCtx } from "./usePlanner";
import type { Task } from "@/lib/types";
import { fmtClock, isTaskOverdue, relativeDayLabel } from "@/lib/time";

export default function TasksView({ ctx, onOpen, onNew }: { ctx: PlannerCtx; onOpen: (id: string) => void; onNew: () => void }) {
  const { tasks, tz } = ctx;
  const [showDone, setShowDone] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const overdue = tasks.filter((t) => isTaskOverdue(t, tz));
  const pending = tasks.filter((t) => t.state === "pending" && !isTaskOverdue(t, tz));
  const done = tasks.filter((t) => t.state !== "pending").sort((a, b) => b.due_date.localeCompare(a.due_date));

  async function complete(t: Task) {
    if (busy) return;
    setBusy(t.id);
    await ctx.completeTask(t);
    setBusy(null);
  }

  const Row = ({ t }: { t: Task }) => {
    const od = isTaskOverdue(t, tz);
    const due = DateTime.fromISO(t.due_date);
    const bell = t.notify_at && t.state === "pending" ? DateTime.fromISO(t.notify_at).setZone(tz) : null;
    return (
      <li className={`task-row ${od ? "is-overdue" : ""} ${t.state !== "pending" ? "is-done" : ""}`}>
        {t.state === "pending" ? (
          <button className="task-check" aria-label={`Mark “${t.title}” done`} disabled={busy === t.id} onClick={() => complete(t)} />
        ) : (
          <span className="task-check is-checked" aria-hidden>{t.state === "completed" ? "✓" : "–"}</span>
        )}
        {/* The due date as a calendar leaf, red once it has passed. */}
        <span className="line-date" role="img" aria-label={`${od ? "Overdue, " : ""}${relativeDayLabel(t.due_date, tz)}`}><strong>{due.toFormat("d")}</strong><span>{due.toFormat("LLL")}</span></span>
        <button className="task-main" onClick={() => onOpen(t.id)}>
          <span className="task-title">{t.title}</span>
          {(t.due_time || bell || t.state === "dismissed") && (
            <span className="task-due line-meta">
              {t.due_time && fmtClock(t.due_time)}
              {bell && <span className="task-bell" title="Reminder"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6zM10 19a2 2 0 0 0 4 0" /></svg>{bell.toFormat("ccc h:mm a")}</span>}
              {t.state === "dismissed" && "Dismissed"}
            </span>
          )}
        </button>
      </li>
    );
  };
  // A dot a task: red while overdue.
  const dots = (list: Task[], cls: string) => <span className="bank-dots" role="img" aria-label={`${list.length} ${list.length === 1 ? "task" : "tasks"}`}>{list.slice(0, 24).map((t) => <i key={t.id} className={cls} />)}</span>;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Tasks</h1>
        <button className="btn btn-primary" onClick={onNew}>＋ New task</button>
      </div>

      {overdue.length > 0 && (
        <section className="card card-alert">
          <div className="page-head line-head"><h2>Overdue</h2>{dots(overdue, "is-late")}</div>
          <ul className="task-list">{overdue.map((t) => <Row key={t.id} t={t} />)}</ul>
        </section>
      )}

      <section className="card">
        <div className="page-head line-head"><h2>To do</h2>{dots(pending, "")}</div>
        {pending.length === 0 ? <p className="empty">Nothing waiting.</p> : <ul className="task-list">{pending.map((t) => <Row key={t.id} t={t} />)}</ul>}
      </section>

      {done.length > 0 && (
        <section className="card">
          <button className="disclosure page-head line-head" aria-expanded={showDone} onClick={() => setShowDone(!showDone)}>
            <span className="line-title">Done</span>{dots(done, "is-paid")}<span aria-hidden>{showDone ? "▾" : "▸"}</span>
          </button>
          {showDone && <ul className="task-list">{done.map((t) => <Row key={t.id} t={t} />)}</ul>}
        </section>
      )}
    </div>
  );
}

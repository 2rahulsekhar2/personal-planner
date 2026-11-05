"use client";
import { useEffect, useMemo, useState } from "react";
import { DateTime } from "luxon";
import { usePlanner } from "./usePlanner";
import { todayISO, isTaskOverdue, startOfWeek } from "@/lib/time";
import WeekView from "./WeekView";
import AgendaView from "./AgendaView";
import TasksView from "./TasksView";
import ActivityTypesView from "./ActivityTypesView";
import PlacesView from "./PlacesView";
import SettingsView from "./SettingsView";
import AppointmentForm from "./AppointmentForm";
import AppointmentDetails from "./AppointmentDetails";
import TaskForm from "./TaskForm";
import Panel from "./Panel";
import NotificationBadge from "./NotificationBadge";
import { registerServiceWorker } from "@/lib/push-client";

export type View = "week" | "agenda" | "tasks" | "types" | "places" | "settings";

export type PanelState =
  | { kind: "add" }
  | { kind: "new-appt"; typeId?: string; date?: string; start?: string; end?: string }
  | { kind: "edit-appt"; id: string }
  | { kind: "appt"; id: string }
  | { kind: "new-task"; date?: string }
  | { kind: "edit-task"; id: string }
  | null;

const NAV: { view: View; label: string }[] = [
  { view: "week", label: "Week" },
  { view: "agenda", label: "Day" },
  { view: "tasks", label: "Tasks" },
  { view: "types", label: "Activities" },
  { view: "places", label: "Places" },
  { view: "settings", label: "Settings" },
];

export default function Planner() {
  const ctx = usePlanner();
  const { tz, setRange, tasks, types, loading, loadError, toasts, appointments } = ctx;
  const [view, setView] = useState<View | null>(null);
  const [day, setDay] = useState<string>(() => todayISO(tz));
  const [panel, setPanel] = useState<PanelState>(null);

  // Desktop defaults to the week; phones default to today's agenda.
  useEffect(() => {
    setView(window.matchMedia("(min-width: 900px)").matches ? "week" : "agenda");
    registerServiceWorker().catch(() => {});
  }, []);

  useEffect(() => {
    setDay(todayISO(tz));
  }, [tz]);

  // Load appointments for the visible week (agenda uses the same week).
  useEffect(() => {
    const ws = startOfWeek(day, tz);
    setRange({
      from: ws.minus({ days: 1 }).toUTC().toISO()!,
      to: ws.plus({ days: 8 }).toUTC().toISO()!,
    });
  }, [day, tz, setRange]);

  const overdueCount = useMemo(() => tasks.filter((t) => isTaskOverdue(t, tz)).length, [tasks, tz]);
  const activeTypes = types.filter((t) => !t.archived_at);

  const closePanel = () => setPanel(null);

  let panelBody: React.ReactNode = null;
  let panelTitle = "";
  if (panel?.kind === "add") {
    panelTitle = "Add";
    panelBody = (
      <div className="stack">
        <p className="eyebrow">Appointment</p>
        {activeTypes.length === 0 ? (
          <p className="muted">
            Create an activity type first, such as Cricket.{" "}
            <button className="link" onClick={() => { setView("types"); closePanel(); }}>Add activity types</button>
          </p>
        ) : (
          <div className="chips chips-large">
            {activeTypes.map((t) => (
              <button key={t.id} className={`chip act-${t.color}`} onClick={() => setPanel({ kind: "new-appt", typeId: t.id })}>
                <span className="swatch" aria-hidden /> {t.name}
              </button>
            ))}
          </div>
        )}
        <p className="eyebrow">Or</p>
        <button className="chip chip-task" onClick={() => setPanel({ kind: "new-task" })}>✓ Task</button>
      </div>
    );
  } else if (panel?.kind === "new-appt") {
    panelTitle = "New appointment";
    panelBody = <AppointmentForm ctx={ctx} initial={panel} onDone={(id) => setPanel(id ? { kind: "appt", id } : null)} onCancel={closePanel} goTo={setView} />;
  } else if (panel?.kind === "edit-appt") {
    const a = appointments.find((x) => x.id === panel.id);
    panelTitle = "Edit appointment";
    panelBody = a ? <AppointmentForm ctx={ctx} existing={a} onDone={(id) => setPanel(id ? { kind: "appt", id } : null)} onCancel={() => setPanel({ kind: "appt", id: a.id })} goTo={setView} /> : null;
  } else if (panel?.kind === "appt") {
    const a = appointments.find((x) => x.id === panel.id);
    panelTitle = "Appointment";
    panelBody = a ? <AppointmentDetails ctx={ctx} appt={a} onEdit={() => setPanel({ kind: "edit-appt", id: a.id })} onClose={closePanel} /> : <p className="muted">This appointment is no longer in view.</p>;
  } else if (panel?.kind === "new-task") {
    panelTitle = "New task";
    panelBody = <TaskForm ctx={ctx} date={panel.date} onDone={closePanel} />;
  } else if (panel?.kind === "edit-task") {
    const t = tasks.find((x) => x.id === panel.id);
    panelTitle = "Task";
    panelBody = t ? <TaskForm ctx={ctx} existing={t} onDone={closePanel} /> : null;
  }

  if (loading || !view) {
    return <div className="center-screen muted" role="status">Loading your planner…</div>;
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">Planner</div>
        <nav className="nav" aria-label="Main">
          {NAV.map((n) => (
            <button key={n.view} className={`nav-item ${view === n.view ? "is-active" : ""} nav-${n.view}`} aria-current={view === n.view ? "page" : undefined} onClick={() => setView(n.view)}>
              {n.label}
              {n.view === "tasks" && overdueCount > 0 && <span className="count count-alert" aria-label={`${overdueCount} overdue`}>{overdueCount}</span>}
            </button>
          ))}
        </nav>
        <div className="topbar-right">
          <NotificationBadge onClick={() => setView("settings")} />
          <button className="btn btn-primary btn-add" onClick={() => setPanel({ kind: "add" })}>
            <span aria-hidden>＋</span> Add
          </button>
        </div>
      </header>

      {loadError && (
        <div className="alert alert-error banner" role="alert">
          Couldn’t load everything: {loadError}. <button className="link" onClick={() => ctx.refresh()}>Retry</button>
        </div>
      )}

      <main className={`main ${panel ? "has-panel" : ""}`}>
        <section className="content">
          {view === "week" && (
            <WeekView ctx={ctx} day={day} setDay={setDay} onOpen={(id) => setPanel({ kind: "appt", id })} onOpenTask={(id) => setPanel({ kind: "edit-task", id })} onCreate={(date, start, end) => setPanel({ kind: "new-appt", date, start, end })} overdueCount={overdueCount} showTasks={() => setView("tasks")} />
          )}
          {view === "agenda" && (
            <AgendaView ctx={ctx} day={day} setDay={setDay} onOpen={(id) => setPanel({ kind: "appt", id })} onOpenTask={(id) => setPanel({ kind: "edit-task", id })} onWeek={() => setView("week")} />
          )}
          {view === "tasks" && <TasksView ctx={ctx} onOpen={(id) => setPanel({ kind: "edit-task", id })} onNew={() => setPanel({ kind: "new-task" })} />}
          {view === "types" && <ActivityTypesView ctx={ctx} />}
          {view === "places" && <PlacesView ctx={ctx} />}
          {view === "settings" && <SettingsView ctx={ctx} />}
        </section>
        {panel && (
          <Panel title={panelTitle} onClose={closePanel}>
            {panelBody}
          </Panel>
        )}
      </main>

      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`} role={t.kind === "error" ? "alert" : "status"}>{t.text}</div>
        ))}
      </div>
    </div>
  );
}

export function nowLocal(tz: string) {
  return DateTime.now().setZone(tz);
}

"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DateTime } from "luxon";
import { usePlanner } from "./usePlanner";
import { todayISO, isTaskOverdue, startOfWeek } from "@/lib/time";
import WeekView from "./WeekView";
import WeekSidebar from "./WeekSidebar";
import AgendaView from "./AgendaView";
import TasksView from "./TasksView";
import ActivityTypesView from "./ActivityTypesView";
import PlacesView from "./PlacesView";
import SettingsView from "./SettingsView";
import AppointmentForm from "./AppointmentForm";
import AppointmentDetails from "./AppointmentDetails";
import TaskForm from "./TaskForm";
import Panel from "./Panel";
import { useNotificationStatus, STATUS_LABEL } from "./NotificationBadge";
import AccountMenu from "./AccountMenu";
import { useDismiss } from "./useDismiss";
import CirclesView from "./CirclesView";
import ActivityView from "./ActivityView";
import { useCircles } from "./useCircles";
import { canAdd, isCurrent, isOpen, seatsOf } from "@/lib/circles";
import { registerServiceWorker } from "@/lib/push-client";
import MoneyView from "./MoneyView";
import { useMoney, type Mode } from "./useMoney";
import { linesDueOn, monthLines, type Line } from "@/lib/money";

export type View = "week" | "agenda" | "tasks" | "types" | "places" | "settings" | "circles" | "activity";

export type PanelState =
  | { kind: "new-appt"; typeId?: string; date?: string; start?: string; end?: string }
  | { kind: "edit-appt"; id: string }
  | { kind: "appt"; id: string }
  | { kind: "new-task"; date?: string; time?: string }
  | { kind: "edit-task"; id: string }
  | null;

// Week / Day switch, shown in the calendar toolbars.
function ViewToggle({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  return (
    <div className="view-toggle" role="group" aria-label="Calendar view">
      {(["week", "agenda"] as const).map((v) => (
        <button key={v} className={view === v ? "is-active" : ""} aria-pressed={view === v} onClick={() => onChange(v)}>{v === "week" ? "Week" : "Day"}</button>
      ))}
    </div>
  );
}

type AddKey = "event" | "task" | "activity" | "place" | "circles" | "log";
// The Add menu has two tiers: what goes on the calendar (appointment, task), then what those draw on:
// your activities, your places, and the circles of people you plan with.
const ADD_ITEMS: { key: AddKey; label: string; hint?: string; icon: React.ReactNode }[] = [
  { key: "event", label: "Appointment", hint: "A booked time", icon: <><rect x="3" y="4.5" width="18" height="16" rx="3" /><path d="M8 2.5v4M16 2.5v4M3 9.5h18" /></> },
  { key: "task", label: "Task", hint: "Something to do", icon: <><rect x="3.5" y="3.5" width="17" height="17" rx="5" /><path d="M8 12.5l2.8 2.8L16 9.5" /></> },
  { key: "activity", label: "Activities", icon: <><path d="M3 12V4.5A1.5 1.5 0 0 1 4.5 3H12l9 9-8.5 8.5a1.5 1.5 0 0 1-2.1 0L3 12z" /><circle cx="7.5" cy="7.5" r="1.2" /></> },
  { key: "place", label: "Places", icon: <><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.3" /></> },
  { key: "circles", label: "Circles", icon: <path d="M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16.5 11a3 3 0 1 0 0-6M17.5 14.6a5.5 5.5 0 0 1 4 5.4" /> },
  { key: "log", label: "History", icon: <path d="M3 12h4l3-8 4 16 3-8h4" /> },
];

export default function Planner() {
  const ctx = usePlanner();
  const { tz, setRange, tasks, loading, loadError, toasts, appointments } = ctx;
  const [view, setView] = useState<View | null>(null);
  const [day, setDay] = useState<string>(() => todayISO(tz));
  const [panel, setPanel] = useState<PanelState>(null);
  const [menu, setMenu] = useState(false);
  const circles = useCircles(ctx.supabase);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  // The two sides of the app. Null until Money has said which side was open last.
  const money = useMoney(ctx);
  const [mode, setMode] = useState<Mode | null>(null);
  const linked = useRef(false); // arrived by an invite or password link: those open on the Time side
  useEffect(() => {
    if (money.status === "loading") return;
    setMode((m) => m ?? (money.status === "on" && money.lastMode === "money" && !linked.current ? "money" : "time"));
  }, [money.status, money.lastMode]);
  const switchMode = (m: Mode) => {
    setMode(m);
    setPanel(null);
    if (view === "settings") setView(beforeSettings.current);
    // Money that is not on yet is only a visit to its front door: nothing to remember.
    if (m === "time" || money.status === "on") money.rememberMode(m);
  };
  const myEmail = ctx.email?.toLowerCase();
  const pendingInvites = circles.invites.filter((i) => i.email === myEmail && isOpen(i)).length;

  // Whose calendar is showing: "mine" (what I created) or one circle (everything shared with it).
  const [scope, setScope] = useState("mine");
  const [face, setFace] = useState<string | null>(null); // in a circle: show only this member's items
  // Circles I am in now. One where my access has ended still shows on the Circles page, so I can leave it, and nowhere else.
  const live = useMemo(() => circles.circles.filter((c) => c.circle_members.some((m) => m.user_id === ctx.userId && isCurrent(m))), [circles.circles, ctx.userId]);
  const circle = live.find((c) => c.id === scope);
  const seats = useMemo(() => (circle ? seatsOf(circle) : []), [circle]);
  // The circles I may share with: not those where I am a viewer. An item already shared keeps its circle on offer.
  const shareable = (keep?: string | null) => live.filter((c) => canAdd(c, ctx.userId) || c.id === keep);
  const startIn = circle && canAdd(circle, ctx.userId) ? circle.id : undefined;
  // "Mine" is what I created, what I am going to, and what is assigned to me.
  const isMine = (x: { user_id: string; participants?: { user_id: string }[]; assignee_id?: string | null }) =>
    x.user_id === ctx.userId || !!x.participants?.some((p) => p.user_id === ctx.userId) || x.assignee_id === ctx.userId;
  const inScope = (x: { user_id: string; circle_id?: string | null; participants?: { user_id: string }[]; assignee_id?: string | null }) =>
    circle ? x.circle_id === circle.id && (!face || x.user_id === face) : isMine(x);
  // The calendar views read through this; everything else (forms, the Tasks page) keeps the full context.
  const viewCtx = { ...ctx, appointments: appointments.filter(inScope), tasks: tasks.filter(inScope) };
  const myTasks = tasks.filter(isMine);
  // Who may mark a task done: its creator; or, on a shared task that is for me or for anyone, a member who is not a viewer.
  const mayFinish = (t: { user_id: string; circle_id?: string | null; assignee_id?: string | null }) =>
    t.user_id === ctx.userId
    || (ctx.people && (!t.assignee_id || t.assignee_id === ctx.userId) && live.some((c) => c.id === t.circle_id && canAdd(c, ctx.userId)));
  // In a circle view each item carries its owner's initial and colour.
  const whoOf = (userId: string) => (circle ? seats.find((s) => s.user_id === userId) : undefined);

  const scopeBar = ctx.sharing && live.length > 0 && (
    <div className="scope-bar" role="group" aria-label="Whose calendar">
      <button className={`chip ${!circle ? "is-selected" : ""}`} aria-pressed={!circle} onClick={() => { setScope("mine"); setFace(null); }}>Mine</button>
      {live.map((c) => (
        <button key={c.id} className={`chip ${circle?.id === c.id ? "is-selected" : ""}`} aria-pressed={circle?.id === c.id} onClick={() => { setScope(c.id); setFace(null); }}>{c.name}</button>
      ))}
      {circle && seats.length > 1 && (
        <span className="scope-faces">
          {seats.map((s) => (
            <button key={s.user_id} className={`face act-${s.color} ${face && face !== s.user_id ? "is-off" : ""}`} aria-pressed={face === s.user_id} aria-label={`Only ${s.email}`} title={s.email} onClick={() => setFace(face === s.user_id ? null : s.user_id)}>{s.letter}</button>
          ))}
        </span>
      )}
    </div>
  );
  // A dot on the gear warns when this device will not get reminders but could. Unsupported browsers get no dot: nothing to fix there.
  const [status] = useNotificationStatus();
  const remindersOff = !!status && status !== "enabled" && status !== "unsupported";
  const addRef = useDismiss(menu, useCallback(() => setMenu(false), []));

  // Desktop defaults to the week; phones default to today's agenda.
  useEffect(() => {
    // A password-reset link lands on /?password: open Settings, where the password field takes focus.
    const params = new URLSearchParams(window.location.search);
    // An invite link lands on /?invite=TOKEN. If sign-in came first, the login page kept the token for us.
    const invite = params.get("invite") ?? localStorage.getItem("pending-invite");
    localStorage.removeItem("pending-invite");
    linked.current = !!invite || params.has("password");
    if (invite) {
      setInviteToken(invite);
      window.history.replaceState(null, "", "/");
      setView("circles");
    } else if (params.has("password")) setView("settings");
    else setView(window.matchMedia("(min-width: 900px)").matches ? "week" : "agenda");
    registerServiceWorker().catch(() => {});
  }, []);

  useEffect(() => {
    setDay(todayISO(tz));
  }, [tz]);

  // Load appointments for what can be on screen: the agenda's Monday-to-Sunday week and the week view's
  // 7-day block from today, which can start up to 6 days before that Monday or end up to 6 days after that Sunday.
  useEffect(() => {
    const ws = startOfWeek(day, tz);
    setRange({
      from: ws.minus({ days: 7 }).toUTC().toISO()!,
      to: ws.plus({ days: 14 }).toUTC().toISO()!,
    });
  }, [day, tz, setRange]);

  const overdueCount = useMemo(() => tasks.filter((t) => t.user_id === ctx.userId && isTaskOverdue(t, tz)).length, [tasks, tz, ctx.userId]);

  const closePanel = () => setPanel(null);

  // The calendar view last used (Week or Day): where the brand, and saving an appointment, return to.
  const calView = useRef<View>("agenda");
  if (view === "week" || view === "agenda") calView.current = view;
  // Switching to Day lands on today.
  const toggle = view ? <ViewToggle view={view} onChange={(v) => { if (v === "agenda") setDay(todayISO(tz)); setView(v); }} /> : null;

  // After saving an appointment: close the form and show its day on the calendar.
  const showSaved = (date?: string) => {
    setPanel(null);
    if (date) setDay(date);
    setView(calView.current);
  };

  // The gear toggles: a second click returns to the screen Settings was opened from.
  const beforeSettings = useRef<View>("agenda");
  const toggleSettings = () => {
    if (view === "settings") return setView(beforeSettings.current);
    if (view) beforeSettings.current = view;
    setView("settings");
  };

  // Each Add menu row opens its section; Event and Task also start a new one straight away.
  const pick = (key: AddKey) => {
    if (key === "event") return setPanel({ kind: "new-appt" });
    setPanel(key === "task" ? { kind: "new-task" } : null);
    setView(key === "task" ? "tasks" : key === "activity" ? "types" : key === "circles" ? "circles" : key === "log" ? "activity" : "places");
  };

  let panelBody: React.ReactNode = null;
  let panelTitle = "";
  if (panel?.kind === "new-appt") {
    panelTitle = "New appointment";
    panelBody = <AppointmentForm key={`${panel.date}T${panel.start}`} ctx={ctx} circles={shareable()} initial={{ ...panel, circleId: startIn }} onDone={showSaved} onCancel={closePanel} />;
  } else if (panel?.kind === "edit-appt") {
    const a = appointments.find((x) => x.id === panel.id);
    panelTitle = "Edit appointment";
    panelBody = a ? <AppointmentForm ctx={ctx} circles={shareable(a.circle_id)} existing={a} onDone={showSaved} onCancel={() => setPanel({ kind: "appt", id: a.id })} /> : null;
  } else if (panel?.kind === "appt") {
    const a = appointments.find((x) => x.id === panel.id);
    panelTitle = "Appointment";
    panelBody = a ? <AppointmentDetails key={a.id} ctx={ctx} circles={live} appt={a} onEdit={() => setPanel({ kind: "edit-appt", id: a.id })} onClose={closePanel} /> : <p className="muted">This appointment is no longer in view.</p>;
  } else if (panel?.kind === "new-task") {
    panelTitle = "New task";
    panelBody = <TaskForm key={`${panel.date}T${panel.time}`} ctx={ctx} circles={shareable()} circleId={startIn} date={panel.date} time={panel.time} onDone={closePanel} />;
  } else if (panel?.kind === "edit-task") {
    const t = tasks.find((x) => x.id === panel.id);
    panelTitle = "Task";
    const theirs = t && t.user_id !== ctx.userId;
    const from = theirs ? live.find((c) => c.id === t.circle_id) : undefined;
    const emailOf = (id?: string | null) => from?.circle_members.find((m) => m.user_id === id)?.email;
    // The person it is for, or anyone when it is unassigned, may finish it.
    const canFinish = !!t && t.state === "pending" && mayFinish(t);
    // Someone else's shared task: read-only here, apart from marking it done when it is yours to do.
    panelBody = !t ? null : theirs ? (
      <div className="stack">
        <h3>{t.title}</h3>
        <p className="muted">
          Due {t.due_date}{t.due_time ? `, ${t.due_time.slice(0, 5)}` : ""}.{" "}
          {t.state === "pending" ? "Not done yet." : t.state === "completed" ? `Done${t.completed_by ? ` by ${t.completed_by === ctx.userId ? "you" : emailOf(t.completed_by) ?? "a member"}` : ""}.` : "Dismissed."}
        </p>
        {ctx.people && <p>{t.assignee_id ? (t.assignee_id === ctx.userId ? "This one is for you." : `For ${emailOf(t.assignee_id) ?? "another member"}.`) : "For anyone in the circle."}</p>}
        {t.notes && <div className="note-block">{t.notes}</div>}
        {canFinish && <div><button className="btn btn-primary" onClick={async () => { await ctx.completeTask(t); closePanel(); }}>Mark done</button></div>}
        <p className="hint">Shared in {from?.name ?? "a circle"} by {emailOf(t.user_id) ?? "another member"}. Only they can edit it.{from && !canAdd(from, ctx.userId) ? " You are a viewer here, so you cannot mark it done." : ""}</p>
      </div>
    ) : <TaskForm ctx={ctx} circles={shareable(t.circle_id)} existing={t} onDone={closePanel} />;
  }

  // Money due on the day in view, from the budget that matches the calendar's scope: mine, or the circle's shared one.
  const bills = useMemo(() => {
    if (money.status !== "on" || (circle && !money.family.includes(circle.id))) return [];
    const here = <T extends { circle_id?: string | null }>(rows: T[]) => rows.filter((r) => (r.circle_id ?? null) === (circle?.id ?? null));
    return linesDueOn(monthLines(here(money.items), money.entries, here(money.increases), day.slice(0, 7)), day);
  }, [money.status, money.family, money.items, money.entries, money.increases, circle, day]);
  const payBill = async (l: Line) => {
    const word = l.item.kind === "expense" ? "paid" : "received";
    const { error } = await ctx.supabase.from("money_entries").upsert({ item_id: l.item.id, month: `${day.slice(0, 7)}-01`, paid_at: l.paid ? null : new Date().toISOString() });
    if (error) return ctx.toast("error", `Couldn’t save: ${error.message}`);
    await money.reload();
    ctx.toast("ok", l.paid ? `${l.item.name} marked not ${word}` : `${l.item.name} ${word}`);
  };

  // Settings belongs to both sides; everything else on screen follows the mode.
  const showMoney = mode === "money" && view !== "settings";

  if (loading || !view || !mode) {
    return (
      <div className="center-screen muted" role="status">
        <div className="loading-mark">
          <img src="/icon.svg" alt="" width={48} height={48} />
          <p>Loading your planner…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" title="Back to calendar" onClick={() => setView(calView.current)}>
          <img src="/icon.svg" alt="" width={26} height={26} />
          Planner
        </button>
        <div className="topbar-right">
          <button className={`icon-btn nav-settings ${view === "settings" ? "is-active" : ""}`} aria-label={remindersOff ? `Settings: ${STATUS_LABEL[status!]}` : "Settings"} title={remindersOff ? STATUS_LABEL[status!] : "Settings"} aria-current={view === "settings" ? "page" : undefined} onClick={toggleSettings}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            {remindersOff && <span className="alert-dot" aria-hidden />}
          </button>
          <AccountMenu ctx={ctx} />
        </div>
      </header>

      {/* The two sides of the app: in the middle of the header on a wide screen, the bottom bar on a phone, where
          the Add button sits in the notch between them. Money shows a lock until it has been turned on.
          Outside the header for the same reason as the Add button: a blurred ancestor would pin it to itself. */}
      <div className="mode-switch" role="group" aria-label="Side of the planner" data-mode={mode}>
        <button className={mode === "time" ? "is-active" : ""} aria-pressed={mode === "time"} onClick={() => switchMode("time")}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>
          Time
        </button>
        <button className={mode === "money" ? "is-active" : ""} aria-pressed={mode === "money"} aria-label={money.status === "off" ? "Money, not turned on yet" : undefined} onClick={() => switchMode("money")}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            {money.status === "off"
              ? <path d="M6.5 11h11v9h-11zM8.5 11V8a3.5 3.5 0 0 1 7 0v3" />
              : <path d="M4 7.5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 7.5v-1a2 2 0 0 1 2-2h10M16 13.5h.01" />}
          </svg>
          Money
        </button>
      </div>
      {/* Outside the header: the header blurs what is behind it, and a blurred ancestor would pin this fixed button to itself. */}
      {!showMoney && <div className="add-wrap" ref={addRef}>
        <button className="btn btn-primary btn-add" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
          <svg className="add-plus" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg>
          <span className="add-text">Add</span>
          {overdueCount > 0 && <span className="count count-alert" aria-label={`${overdueCount} overdue tasks`}>{overdueCount}</span>}
          {pendingInvites > 0 && <span className="alert-dot invite-dot" role="img" aria-label="A circle invite is waiting" />}
        </button>
        {menu && (
          <div className="pop-menu add-menu" role="menu" aria-label="Add">
            {[ADD_ITEMS.slice(0, 2), ADD_ITEMS.slice(2)].map((tier, n) => (
              <div key={n} className={n === 0 ? "add-primary" : "add-support"}>
                {tier.map((it, i) => (
                  <button key={it.key} className={n === 0 ? "add-tile" : "add-mini"} role="menuitem" autoFocus={n === 0 && i === 0} onClick={() => { setMenu(false); pick(it.key); }}>
                    <span className="add-icon" aria-hidden>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{it.icon}</svg>
                    </span>
                    <span className="add-label">{it.label}</span>
                    {it.hint && <span className="add-hint">{it.hint}</span>}
                    {it.key === "task" && overdueCount > 0 && <span className="count count-alert" aria-label={`${overdueCount} overdue`}>{overdueCount}</span>}
                        {it.key === "circles" && pendingInvites > 0 && <span className="count count-alert" aria-label={`${pendingInvites} invite${pendingInvites > 1 ? "s" : ""} waiting`}>{pendingInvites}</span>}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>}

      {loadError && (
        <div className="alert alert-error banner" role="alert">
          Couldn’t load everything: {loadError}. <button className="link" onClick={() => ctx.refresh()}>Retry</button>
        </div>
      )}

      {showMoney ? <MoneyView ctx={ctx} money={money} circles={live} /> : <main className={`main ${panel ? "has-panel" : ""}`}>
        <section className="content">
          {view === "week" && (
            <div className="week-layout">
              <WeekSidebar ctx={viewCtx} day={day} setDay={setDay} onOpen={(id) => setPanel({ kind: "appt", id })} onOpenTask={(id) => setPanel({ kind: "edit-task", id })} />
              <WeekView ctx={viewCtx} whoOf={whoOf} scopeBar={scopeBar} day={day} setDay={setDay} onOpen={(id) => setPanel({ kind: "appt", id })} onOpenTask={(id) => setPanel({ kind: "edit-task", id })} onCreate={(date, start, end) => setPanel({ kind: "new-appt", date, start, end })} onCreateTask={(date, time) => setPanel({ kind: "new-task", date, time })} toggle={toggle} />
            </div>
          )}
          {view === "agenda" && (
            <AgendaView ctx={viewCtx} bills={bills} onPayBill={!circle || canAdd(circle, ctx.userId) ? payBill : undefined} onOpenBills={() => switchMode("money")} mayFinish={mayFinish} whoOf={whoOf} onCreate={(date, start, end) => setPanel({ kind: "new-appt", date, start, end })} onCreateTask={(date, time) => setPanel({ kind: "new-task", date, time })} scopeBar={scopeBar} day={day} setDay={setDay} onOpen={(id) => setPanel({ kind: "appt", id })} onOpenTask={(id) => setPanel({ kind: "edit-task", id })} toggle={toggle} />
          )}
          {view === "tasks" && <TasksView ctx={{ ...ctx, tasks: myTasks }} onOpen={(id) => setPanel({ kind: "edit-task", id })} onNew={() => setPanel({ kind: "new-task" })} />}
          {view === "types" && <ActivityTypesView ctx={ctx} />}
          {view === "places" && <PlacesView ctx={ctx} />}
          {view === "settings" && <SettingsView ctx={ctx} />}
          {view === "circles" && <CirclesView ctx={ctx} state={circles} linkToken={inviteToken} clearLink={() => setInviteToken(null)} />}
          {view === "activity" && <ActivityView ctx={ctx} circles={live} />}
        </section>
        {panel && (
          <Panel title={panelTitle} onClose={closePanel}>
            {panelBody}
          </Panel>
        )}
      </main>}

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

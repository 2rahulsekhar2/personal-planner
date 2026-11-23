"use client";
import { useEffect, useMemo, useState } from "react";
import { DateTime } from "luxon";
import type { PlannerCtx } from "./usePlanner";
import type { MoneyCtx } from "./useMoney";
import Panel from "./Panel";
import MoneySetup, { TONES } from "./MoneySetup";
import { MoneyItemForm, MoneyLineForm } from "./MoneyItemForm";
import { bankPosition, byPerson, byType, expected, forecast, FREQ_LABELS, inr, monthLabel, monthLines, shiftMonth, totals, waitingOn, type Line, type MoneyKind, type Proposal } from "@/lib/money";
import { canAdd, isCurrent, type Circle } from "@/lib/circles";
import { todayISO } from "@/lib/time";

type Tab = "month" | "banks" | "insights" | "setup";
// `again`: a rejected request, opened to be changed and sent once more.
type PanelState = { kind: "item"; id?: string; as?: MoneyKind; again?: Proposal } | { kind: "line"; id: string } | null;

/** Money is off: explain it, email a code, and turn it on when the code comes back right. */
function MoneyGate({ ctx, money }: { ctx: PlannerCtx; money: MoneyCtx }) {
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const call = async (path: string, body?: unknown) => {
    setBusy(true);
    setError(null);
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) }).catch(() => null);
    const json = await res?.json().catch(() => null);
    setBusy(false);
    if (!res?.ok) setError(json?.error ?? "Couldn’t reach the server. Check your connection and try again.");
    return !!res?.ok;
  };
  const send = async () => { if (await call("/api/money/code")) setSent(true); };
  const turnOn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!(await call("/api/money/activate", { code }))) return;
    await money.rememberMode("money");
    await money.reload();
    ctx.toast("ok", "Money is on");
  };

  return (
    <div className="page">
      <div className="page-head"><h1>Money</h1></div>
      <div className="card stack">
        <p style={{ margin: 0 }}>Plan each month before it starts: what comes in, what goes out, from which bank, and for whom. Then record what really happened and see what each account has left.</p>
        <p className="muted" style={{ margin: 0 }}>Money is separate from your calendar and stays private to you. To turn it on, confirm with a code sent to {ctx.email}.</p>
        {!sent ? (
          <div><button className="btn btn-primary" disabled={busy} onClick={send}>{busy ? "Sending…" : "Email me a code"}</button></div>
        ) : (
          <form className="form" onSubmit={turnOn} noValidate>
            <label className="field">
              <span>Code from the email</span>
              <input className="input-inline" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="6 digits" autoFocus />
            </label>
            <div className="form-actions">
              <button className="btn btn-primary" disabled={busy || code.length !== 6}>{busy ? "Checking…" : "Turn on Money"}</button>
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={send}>Send a new code</button>
            </div>
          </form>
        )}
        {error && <div className="alert alert-error" role="alert">{error}</div>}
      </div>
    </div>
  );
}

const dueLabel = (l: Line) => {
  const d = DateTime.fromISO(l.dates[0]);
  return l.dates.length > 1 ? `${l.dates.length} times, from ${d.toFormat("d LLL")}` : d.toFormat("ccc d LLL");
};

/** A month's income or expense lines. The box marks a line paid or received; the row opens that month's figures. */
// `flat`: inside another card (the bills of a bank), so drawn without a card of its own.
function Lines({ lines, meta, onToggle, onOpen, empty, locked, flat }: { lines: Line[]; meta?: (l: Line) => React.ReactNode; onToggle: (l: Line) => void; onOpen: (l: Line) => void; empty: string; locked?: boolean; flat?: boolean }) {
  if (!lines.length) return <p className="empty card">{empty}</p>;
  return (
    <ul className={`task-list money-lines ${flat ? "is-flat" : "card"}`}>
      {lines.map((l) => {
        const verb = l.item.kind === "expense" ? "paid" : "received";
        return (
          <li key={l.item.id} className={`task-row ${l.paid ? "is-done" : ""} ${l.skipped ? "is-skipped" : ""}`}>
            <button className={`task-check ${l.paid ? "is-checked" : ""}`} disabled={l.skipped || locked} aria-pressed={l.paid} aria-label={`${l.item.name}: ${l.paid ? `mark not ${verb}` : `mark ${verb}`}`} onClick={() => onToggle(l)}>{l.paid ? "✓" : ""}</button>
            {/* The due date as a small calendar leaf: the day over its weekday. An item due many times shows how many. */}
            <span className="line-date" role="img" aria-label={dueLabel(l)}>
              {l.dates.length > 1 ? <><strong>×{l.dates.length}</strong><span>times</span></> : <><strong>{DateTime.fromISO(l.dates[0]).toFormat("d")}</strong><span>{DateTime.fromISO(l.dates[0]).toFormat("ccc")}</span></>}
            </span>
            <button className="task-main" onClick={() => onOpen(l)}>
              <span className="task-title">{l.item.name}</span>
              {(l.skipped || meta) && <span className="task-due line-meta">{l.skipped ? "Skipped" : meta!(l)}</span>}
            </button>
            <span className="money-amt">
              <strong>{inr(expected(l))}</strong>
              {l.actual !== null && l.actual !== l.budget && <span className={l.item.kind === "expense" && l.actual > l.budget ? "is-over" : ""}>of {inr(l.budget)}</span>}
              {l.actual === null && l.budget !== l.rule && <span>usually {inr(l.rule)}</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

type Part = { key: string; tone: string | null; value: number };
/** A ring cut into shares, largest first from the top. What sits in the middle is the caller's. */
function Ring({ parts, children }: { parts: Part[]; children: React.ReactNode }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  const gap = parts.length > 1 ? 1.2 : 0;
  let at = 0;
  return (
    <div className="ins-ring">
      {/* r = 15.915 makes the circle 100 units round, so a share's length is its percentage. */}
      <svg viewBox="0 0 42 42" aria-hidden>
        <circle className="ins-ring-track" cx="21" cy="21" r="15.915" />
        {total > 0 && parts.map((p) => {
          const pct = (p.value / total) * 100;
          const arc = <circle key={p.key} className={p.tone ? `act-${p.tone}` : "is-none"} cx="21" cy="21" r="15.915" strokeDasharray={`${Math.max(0.5, pct - gap)} ${100 - Math.max(0.5, pct - gap)}`} strokeDashoffset={-at} transform="rotate(-90 21 21)" />;
          at += pct;
          return arc;
        })}
      </svg>
      <div className="ins-ring-mid">{children}</div>
    </div>
  );
}

/** What the budget in view says, drawn: who the month's money goes on, where it goes, what each bank is left with, and the year ahead. */
function Insights({ lines, view, ym }: { lines: Line[]; view: MoneyCtx; ym: string }) {
  const [pick, setPick] = useState(0); // the month of the year ahead whose figures are spelled out
  const people = byPerson(lines);
  const types = byType(lines);
  const total = people.reduce((s, p) => s + p.amount, 0);
  // The same colours as in Setup: a person or a type keeps its colour across the two screens.
  const personAt = new Map(view.people.map((p, n) => [p.id, { name: p.name, tone: TONES[n % TONES.length] }]));
  const typeAt = new Map([...view.types].sort((a, b) => a.kind.localeCompare(b.kind)).map((t, n) => [t.id, { name: t.name, tone: TONES[n % TONES.length] }]));
  const banks = view.banks.filter((b) => !b.archived_at).map((b, n) => ({ b, pos: bankPosition(b, lines), tone: TONES[view.banks.indexOf(b) % TONES.length], n }));
  const ahead = forecast(view.items, view.entries, view.increases, ym);
  const reach = Math.max(...ahead.map((m) => Math.abs(m.left)), 1);
  const year = ahead.reduce((s, m) => s + m.left, 0);
  const shown = ahead[Math.min(pick, ahead.length - 1)];
  const typeMax = Math.max(...types.map((t) => Math.max(t.budget, t.actual + t.due)), 1);
  if (!view.items.length) return <p className="empty card">Nothing to show yet. Add an income or an expense first.</p>;

  return (
    <div className="ins">
      <section className="card ins-card">
        <h2>Who it is for</h2>
        {people.length === 0 ? <p className="empty">No expenses in {monthLabel(ym)}.</p> : (
          <div className="ins-split">
            <Ring parts={people.map((p) => ({ key: p.id ?? "none", tone: p.id ? personAt.get(p.id)?.tone ?? null : null, value: p.amount }))}>
              <strong>{inr(total)}</strong>
              <span>spent</span>
            </Ring>
            <ul className="ins-legend">
              {people.map((p) => {
                const who = p.id ? personAt.get(p.id) : undefined;
                const name = p.id ? who?.name ?? "Someone removed" : "Nobody in particular";
                return (
                  <li key={p.id ?? "none"}>
                    <span className={`ins-face ${who ? `act-${who.tone}` : "is-none"}`} aria-hidden>{who ? name[0].toUpperCase() : ""}</span>
                    <span className="ins-name">{name}</span>
                    <strong>{total > 0 ? Math.round((p.amount / total) * 100) : 0}%</strong>
                    <span className="ins-amt">{inr(p.amount)}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>

      <section className="card ins-card">
        <h2>Where it goes</h2>
        {types.length === 0 ? <p className="empty">No expenses in {monthLabel(ym)}.</p> : (
          <ul className="ins-types">
            {types.map((t) => {
              const kind = t.id ? typeAt.get(t.id) : undefined;
              const end = t.actual + t.due; // what the month will come to
              const over = end - t.budget;
              return (
                <li key={t.id ?? "none"} className={over > 0 ? "is-over" : ""}>
                  <span className="ins-row"><span className="ins-name">{t.id ? kind?.name ?? "A removed type" : "No type"}</span>{over > 0 && <span className="ins-over">+{inr(over)}</span>}<strong>{inr(Math.max(t.budget, end))}</strong></span>
                  {/* The track is the budget, sized against the largest type. The solid part is paid; anything past the budget runs on in red. */}
                  <span className={`ins-track ${kind ? `act-${kind.tone}` : "is-none"}`} style={{ width: `${Math.max(6, (Math.max(t.budget, end) / typeMax) * 100)}%` }} role="img" aria-label={`${inr(t.actual)} paid of ${inr(t.budget)} budgeted${over > 0 ? `, ${inr(over)} over` : ""}`}>
                    <span className="ins-paid" style={{ width: `${Math.max(t.budget, end) > 0 ? (Math.min(t.actual, t.budget) / Math.max(t.budget, end)) * 100 : 0}%` }} />
                    {over > 0 && <span className="ins-spill" style={{ width: `${(over / end) * 100}%` }} />}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <p className="ins-key"><span><i className="is-paid" />paid</span><span><i className="is-plan" />still to pay</span><span><i className="is-spill" />over budget</span></p>
      </section>

      {banks.length > 0 && (
        <section className="ins-wide">
          <h2>What each bank is left with</h2>
          <ul className="ins-banks">
            {banks.map(({ b, pos, tone }) => {
              const full = Math.max(Number(b.balance) + pos.incomeDue, pos.expenseDue, 1);
              const short = pos.after < 0;
              return (
                <li key={b.id} className={`card ${short ? "is-short" : ""}`}>
                  <span className="ins-bank-top"><span className={`kit-mono act-${tone}`}>{b.name.trim()[0]?.toUpperCase()}</span><span className="ins-name">{b.name}</span></span>
                  <strong className="ins-bank-left">{short ? "− " : ""}{inr(Math.abs(pos.after))}</strong>
                  {/* A tank: what the account holds and expects, with this month's unpaid bills drained off the top. */}
                  <span className="ins-tank" role="img" aria-label={`${inr(Number(b.balance))} now${pos.incomeDue ? `, ${inr(pos.incomeDue)} to come` : ""}, ${inr(pos.expenseDue)} still to pay`}>
                    <span className="ins-tank-keep" style={{ width: `${short ? 0 : (pos.after / full) * 100}%` }} />
                    <span className="ins-tank-out" style={{ width: `${(Math.min(pos.expenseDue, full) / full) * 100}%` }} />
                  </span>
                  <span className="ins-sub">{short ? "short after bills" : pos.expenseDue > 0 ? `after ${inr(pos.expenseDue)} of bills` : "nothing left to pay"}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="card ins-card ins-wide">
        <div className="ins-row"><h2>The year ahead</h2><strong className={year < 0 ? "is-short" : "is-left"}>{year < 0 ? "− " : "+ "}{inr(Math.abs(year))}</strong></div>
        {/* A column a month, from a middle line: up is what the month leaves, down is what it falls short by. */}
        <ol className="ins-year">
          {ahead.map((m, n) => (
            <li key={m.ym}>
              <button className={`${m.left < 0 ? "is-short" : ""} ${n === pick ? "is-picked" : ""}`} aria-pressed={n === pick} aria-label={`${monthLabel(m.ym)}: ${m.left < 0 ? `short by ${inr(-m.left)}` : `${inr(m.left)} left`}`} onClick={() => setPick(n)}>
                <span className="ins-col"><span style={{ height: `${Math.max(m.left === 0 ? 0 : 2, (Math.abs(m.left) / reach) * 50)}%` }} /></span>
                <span className="ins-month">{DateTime.fromISO(`${m.ym}-01`).toFormat("LLLLL")}</span>
              </button>
            </li>
          ))}
        </ol>
        <dl className="ins-picked">
          <div><dt>{monthLabel(shown.ym)}</dt><dd className={shown.left < 0 ? "is-short" : "is-left"}>{shown.left < 0 ? "− " : "+ "}{inr(Math.abs(shown.left))}</dd></div>
          <div><dt>In</dt><dd>{inr(shown.income)}</dd></div>
          <div><dt>Out</dt><dd>{inr(shown.expense)}</dd></div>
        </dl>
      </section>
    </div>
  );
}

const nameOf = (c: Circle, userId: string, me: string | null) => (userId === me ? "You" : c.circle_members.find((m) => m.user_id === userId)?.email.split("@")[0] ?? "A member");

/** A circle's open requests: each waits for every other member to approve, or has been rejected with a reason. */
function Requests({ ctx, money, scope, canEdit, onAgain }: { ctx: PlannerCtx; money: MoneyCtx; scope: Circle; canEdit: boolean; onAgain: (p: Proposal) => void }) {
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const list = money.proposals.filter((p) => p.circle_id === scope.id);
  if (!list.length) return null;
  const me = ctx.userId;
  const isAdmin = scope.owner_id === me;

  const run = async (fn: string, args: Record<string, unknown>, said: (result: unknown) => string) => {
    setBusy(true);
    const { data, error } = await ctx.supabase.rpc(fn, args);
    setBusy(false);
    if (error) return ctx.toast("error", error.message);
    setRejecting(null);
    setReason("");
    await money.reload();
    ctx.toast("ok", said(data));
  };
  const approve = (p: Proposal) => run("money_decide", { p_proposal: p.id, p_approve: true }, (r) => (r === "approved" ? "Approved. It is now in the budget" : "Approved. Waiting for the others"));
  const withdraw = (p: Proposal) => run("money_withdraw", { p_proposal: p.id }, () => "Request withdrawn");

  return (
    <section className="stack">
      <div className="page-head"><h2>Waiting for approval</h2></div>
      <ul className="card list">
        {list.map((p) => {
          const item = money.items.find((i) => i.id === p.item_id);
          const mine = p.created_by === me;
          const waiting = waitingOn(p, scope.circle_members, money.approvals);
          const amount = p.payload.amount != null ? Number(p.payload.amount) : null;
          const was = item && amount !== null && Number(item.amount) !== amount ? `${inr(Number(item.amount))} to ` : "";
          return (
            <li key={p.id} className="list-row">
              <span className="grow">
                <strong>{p.action === "add" ? "Add" : p.action === "change" ? "Change" : "Delete"} {p.payload.name ?? item?.name ?? "an item"}</strong>
                {amount !== null && <span className="muted"> · {was}{inr(amount)}{p.payload.freq ? `, ${FREQ_LABELS[p.payload.freq].toLowerCase()}` : ""}</span>}
                <br />
                <span className={p.status === "rejected" ? "overdue-label" : "muted"}>
                  {p.status === "rejected"
                    ? `Rejected: ${p.reason ?? "no reason given"}`
                    : `Asked by ${nameOf(scope, p.created_by, me).replace("You", "you")}. Waiting for ${waiting.map((id) => nameOf(scope, id, me).replace("You", "you")).join(", ") || "nobody"}.`}
                </span>
              </span>
              <span className="row-actions">
                {p.status === "pending" && !mine && canEdit && me && waiting.includes(me) && (
                  <>
                    <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => approve(p)}>Approve</button>
                    <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { setRejecting(p.id); setReason(""); }}>Reject</button>
                  </>
                )}
                {p.status === "rejected" && !mine && isAdmin && <button className="btn btn-sm" disabled={busy} onClick={() => approve(p)}>Approve anyway</button>}
                {p.status === "rejected" && mine && p.action !== "delete" && <button className="btn btn-sm" onClick={() => onAgain(p)}>Change and send again</button>}
                {mine && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => withdraw(p)}>Withdraw</button>}
              </span>
              {rejecting === p.id && (
                <form className="confirm-box" onSubmit={(e) => { e.preventDefault(); run("money_decide", { p_proposal: p.id, p_approve: false, p_reason: reason }, () => "Rejected. It goes back to the person who asked"); }}>
                  <label className="field"><span>Why are you rejecting it?</span><input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></label>
                  <div className="row">
                    <button className="btn btn-danger" disabled={busy || !reason.trim()}>Reject it</button>
                    <button type="button" className="btn btn-ghost" onClick={() => setRejecting(null)}>Cancel</button>
                  </div>
                </form>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default function MoneyView({ ctx, money, circles }: { ctx: PlannerCtx; money: MoneyCtx; circles: Circle[] }) {
  const [tab, setTab] = useState<Tab>("month");
  const [panel, setPanel] = useState<PanelState>(null);
  // The month on show follows the calendar until one is picked by hand.
  const [picked, setPicked] = useState<string | null>(null);
  const nowYm = todayISO(ctx.tz).slice(0, 7);
  const ym = picked ?? nowYm;

  // Whose budget is showing: mine, or one circle's that has a family plan.
  const [scopeId, setScopeId] = useState<string | null>(null);
  const families = circles.filter((c) => money.family.includes(c.id));
  const scope = families.find((c) => c.id === scopeId) ?? null;
  const sid = scope?.id ?? null;
  const canEdit = !scope || canAdd(scope, ctx.userId); // a viewer reads a shared budget and changes nothing
  // Everything below reads this: the budget in view only.
  const view = useMemo(() => {
    const here = <T extends { circle_id?: string | null }>(rows: T[]) => rows.filter((r) => (r.circle_id ?? null) === sid);
    return { ...money, banks: here(money.banks), types: here(money.types), increases: here(money.increases), people: here(money.people), items: here(money.items) };
  }, [money, sid]);
  const lines = useMemo(() => monthLines(view.items, view.entries, view.increases, ym), [view, ym]);

  // Every member of the circle is a family person without being typed in. Whoever opens the budget first adds the missing ones.
  const { supabase } = ctx;
  const { people, reload } = money;
  useEffect(() => {
    if (!scope || !canAdd(scope, ctx.userId)) return;
    const missing = scope.circle_members.filter((m) => isCurrent(m) && !people.some((p) => p.circle_id === scope.id && p.member_id === m.user_id));
    if (!missing.length) return;
    supabase.from("money_people")
      .upsert(missing.map((m) => ({ circle_id: scope.id, member_id: m.user_id, name: m.email.split("@")[0], relationship: "Member" })), { onConflict: "circle_id,member_id", ignoreDuplicates: true })
      .then(({ error }: { error: unknown }) => { if (!error) reload(); });
  }, [scope, people, supabase, reload, ctx.userId]);

  if (money.status !== "on") {
    return (
      <main className="main">
        <section className="content">
          {money.status === "off" ? <MoneyGate ctx={ctx} money={money} /> : (
            <div className="page">
              <div className="page-head"><h1>Money</h1></div>
              <div className="alert alert-warn">Money needs a database update before it can be used here. Run <code>supabase/migrations/0015_money.sql</code> in the Supabase SQL editor, then reload.</div>
            </div>
          )}
        </section>
      </main>
    );
  }

  const income = totals(lines, "income");
  const spend = totals(lines, "expense");
  const bankAt = new Map(view.banks.map((b, n) => [b.id, { name: b.name, tone: TONES[n % TONES.length] }]));
  const typeName = new Map(view.types.map((t) => [t.id, t.name]));
  // Under a line's name: its bank as the coloured letter it has everywhere else, then its type.
  const meta = (l: Line) => {
    const bank = l.item.bank_id ? bankAt.get(l.item.bank_id) : undefined;
    const type = l.item.type_id ? typeName.get(l.item.type_id) : undefined;
    if (!bank && !type) return null;
    return <>{bank && <span className={`kit-mono is-mini act-${bank.tone}`} title={bank.name} aria-label={bank.name}>{bank.name.trim()[0]?.toUpperCase()}</span>}{type ?? bank?.name}</>;
  };
  const scale = Math.max(income.budget, spend.budget, 1);
  // One row of the month's summary: a track as long as the budget, solid for what has already moved.
  const flow = (label: string, t: typeof income, cls: string, done: string) => (
    <div className={`sum-row ${cls}`}>
      <span>{label}</span>
      <span className="sum-track" style={{ width: `${Math.max(3, (t.budget / scale) * 100)}%` }} role="img" aria-label={`${inr(t.actual)} ${done} of ${inr(t.budget)}`}>
        <span style={{ width: `${t.budget > 0 ? Math.min(100, (t.actual / t.budget) * 100) : 0}%` }} />
      </span>
      <strong>{inr(t.budget)}</strong>
    </div>
  );
  // A section's heading: its name, a dot a line (filled once paid or received), and the button that adds one.
  const head = (title: string, kind: MoneyKind) => {
    const own = lines.filter((l) => l.item.kind === kind);
    return (
      <div className="page-head line-head">
        <h2>{title}</h2>
        {own.length > 0 && <span className="bank-dots" role="img" aria-label={`${own.filter((l) => l.paid).length} of ${own.length} ${kind === "expense" ? "paid" : "received"}`}>{own.map((l) => <i key={l.item.id} className={l.paid ? "is-paid" : l.skipped ? "is-skipped" : ""} />)}</span>}
        {canEdit && <button className="btn btn-sm" aria-label={`Add ${kind === "expense" ? "an expense" : "an income"}`} onClick={() => setPanel({ kind: "item", as: kind })}>＋</button>}
      </div>
    );
  };
  const left = income.budget - spend.budget;
  const next = shiftMonth(nowYm, 1);

  // A private month is planned when I say so. A shared month, when every owner and member has said so.
  const approvers = scope ? scope.circle_members.filter((m) => m.role !== "viewer" && isCurrent(m)) : [];
  const marked = (month: string) => money.months.filter((x) => x.month === month && x.circle_id === sid).map((x) => x.user_id);
  const iMarked = (month: string) => marked(month).includes(ctx.userId ?? "");
  const isPlanned = (month: string) => (scope ? approvers.every((m) => marked(month).includes(m.user_id)) : iMarked(month));
  const notYet = scope ? approvers.filter((m) => !marked(ym).includes(m.user_id)).map((m) => nameOf(scope, m.user_id, ctx.userId).replace("You", "you")) : [];

  const write = async (q: PromiseLike<{ error: { message: string; code?: string } | null }>, done: string) => {
    const { error } = await q;
    if (error && error.code !== "23505") return ctx.toast("error", `Couldn’t save: ${error.message}`);
    await money.reload();
    ctx.toast("ok", done);
  };
  const togglePaid = (l: Line) => {
    const word = l.item.kind === "expense" ? "paid" : "received";
    return write(supabase.from("money_entries").upsert({ item_id: l.item.id, month: `${ym}-01`, paid_at: l.paid ? null : new Date().toISOString() }), l.paid ? `${l.item.name} marked not ${word}` : `${l.item.name} ${word}`);
  };
  const setPlanned = (on: boolean) => {
    if (on) return write(supabase.from("money_months").insert({ month: `${ym}-01`, ...(money.shared ? { circle_id: sid } : {}) }), `${monthLabel(ym)} marked as planned`);
    const mine = supabase.from("money_months").delete().eq("month", `${ym}-01`).eq("user_id", ctx.userId ?? "");
    return write(!money.shared ? mine : sid ? mine.eq("circle_id", sid) : mine.is("circle_id", null), `${monthLabel(ym)} reopened`);
  };

  const monthBar = (
    <div className="toolbar">
      <div className="toolbar-group">
        <button className="btn" onClick={() => setPicked(shiftMonth(ym, -1))} aria-label="Previous month">‹</button>
        <button className="btn" onClick={() => setPicked(shiftMonth(ym, 1))} aria-label="Next month">›</button>
      </div>
      <h1 className="toolbar-title">{monthLabel(ym)}</h1>
      {ym !== nowYm && <button className="btn" onClick={() => setPicked(null)}>This month</button>}
    </div>
  );

  const panelLine = panel?.kind === "line" ? lines.find((l) => l.item.id === panel.id) : undefined;
  const panelItem = panel?.kind === "item" && panel.id ? view.items.find((i) => i.id === panel.id) : undefined;
  const close = () => setPanel(null);
  const openLine = (l: Line) => setPanel({ kind: "line", id: l.item.id });
  const pick = (id: string | null) => { setScopeId(id); setPanel(null); };

  return (
    <>
      {canEdit && (
        <button className="btn btn-primary btn-add" onClick={() => setPanel({ kind: "item" })}>
          <svg className="add-plus" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg>
          <span className="add-text">Add income or expense</span>
        </button>
      )}

      <main className={`main ${panel ? "has-panel" : ""}`}>
        <section className="content">
          <div className="page">
            <div className="view-toggle money-tabs" role="group" aria-label="Money section">
              {([["month", "Month"], ["banks", "Banks"], ["insights", "Insights"], ["setup", "Setup"]] as const).map(([t, label]) => (
                <button key={t} className={tab === t ? "is-active" : ""} aria-pressed={tab === t} onClick={() => setTab(t)}>{label}</button>
              ))}
            </div>
            {families.length > 0 && (
              <div className="scope-bar" role="group" aria-label="Whose budget">
                <button className={`chip ${!scope ? "is-selected" : ""}`} aria-pressed={!scope} onClick={() => pick(null)}>Mine</button>
                {families.map((c) => <button key={c.id} className={`chip ${scope?.id === c.id ? "is-selected" : ""}`} aria-pressed={scope?.id === c.id} onClick={() => pick(c.id)}>{c.name}</button>)}
                {scope && !canEdit && <span className="hint" style={{ margin: 0 }}>You are a viewer here: you can look, not change.</span>}
              </div>
            )}
            {money.error && <div className="alert alert-error" role="alert">Couldn’t load your budget: {money.error}. <button className="link" onClick={() => money.reload()}>Retry</button></div>}

            {tab === "month" && (
              <>
                {monthBar}
                <section className={`card month-sum ${left < 0 ? "is-short" : ""}`}>
                  <p className="sum-left"><strong>{left < 0 ? "− " : ""}{inr(Math.abs(left))}</strong> {left < 0 ? "short" : "left"}</p>
                  {flow("In", income, "is-in", "received")}
                  {flow("Out", spend, "is-out", "paid")}
                  <p className="ins-key"><span><i className="is-paid" />done</span><span><i className="is-plan" />still to come</span></p>
                </section>

                {isPlanned(ym) ? (
                  <p className="money-plan"><span className="plan-pill is-on">✓ Planned{scope ? " by everyone" : ""}</span>{canEdit && <button className="link" onClick={() => setPlanned(false)}>Reopen</button>}</p>
                ) : iMarked(ym) ? (
                  <p className="money-plan"><span className="plan-pill">✓ You</span><span className="muted">Waiting for {notYet.join(", ")}</span><button className="link" onClick={() => setPlanned(false)}>Undo</button></p>
                ) : ym > nowYm && canEdit ? (
                  <p className="money-plan"><button className="btn" disabled={!lines.length} onClick={() => setPlanned(true)}>Mark {monthLabel(ym).split(" ")[0]} as planned</button>{scope && <span className="muted">Everyone in {scope.name} marks it</span>}</p>
                ) : ym === nowYm && !isPlanned(next) && view.items.length > 0 ? (
                  <p className="money-plan"><button className="chip chip-dashed" onClick={() => setPicked(next)}>Plan {monthLabel(next).split(" ")[0]}</button></p>
                ) : null}

                {scope && <Requests ctx={ctx} money={money} scope={scope} canEdit={canEdit} onAgain={(p) => setPanel({ kind: "item", id: p.item_id ?? undefined, again: p })} />}

                {head("Income", "income")}
                <Lines lines={lines.filter((l) => l.item.kind === "income")} meta={meta} onToggle={togglePaid} onOpen={openLine} locked={!canEdit} empty={`No income in ${monthLabel(ym)}.`} />
                {head("Expenses", "expense")}
                <Lines lines={lines.filter((l) => l.item.kind === "expense")} meta={meta} onToggle={togglePaid} onOpen={openLine} locked={!canEdit} empty={`No expenses in ${monthLabel(ym)}.`} />
              </>
            )}

            {tab === "banks" && (
              <>
                {monthBar}
                {view.banks.every((b) => b.archived_at) && <p className="empty card">No banks yet. {canEdit && <button className="link" onClick={() => setTab("setup")}>Add one in Setup</button>}</p>}
                {view.banks.filter((b) => !b.archived_at).map((b) => {
                  const pos = bankPosition(b, lines);
                  const out = lines.filter((l) => l.item.bank_id === b.id && l.item.kind === "expense");
                  const balance = Number(b.balance);
                  const full = Math.max(balance + pos.incomeDue, 1); // everything the account holds or expects this month
                  const short = pos.after < 0;
                  return (
                    <section key={b.id} className={`card bank ${short ? "is-short" : ""}`}>
                      <div className="bank-head">
                        <span className={`kit-mono act-${TONES[view.banks.indexOf(b) % TONES.length]}`} aria-hidden>{b.name.trim()[0]?.toUpperCase()}</span>
                        <h2>{b.name}</h2>
                        <span className="bank-date">{b.balance_at ? DateTime.fromISO(b.balance_at).toFormat("d LLL") : "no balance yet"}{scope ? `, ${nameOf(scope, b.user_id ?? "", ctx.userId).replace("You", "you")}` : ""}</span>
                      </div>
                      <p className="bank-left"><strong>{short ? "− " : ""}{inr(Math.abs(pos.after))}</strong> {short ? "short" : "left"}</p>
                      {/* One bar for the month: what is in the account, what is still to arrive, and the unpaid bills struck off the end. */}
                      <div className="bank-bar" role="img" aria-label={`${inr(balance)} in the account, ${inr(pos.incomeDue)} still to come, ${inr(pos.expenseDue)} still to pay`}>
                        <span className="is-now" style={{ width: `${(Math.max(balance, 0) / full) * 100}%` }} />
                        <span className="is-coming" style={{ width: `${(pos.incomeDue / full) * 100}%` }} />
                        <span className="is-bills" style={{ width: `${Math.min(100, (pos.expenseDue / full) * 100)}%` }} />
                      </div>
                      <ul className="bank-key">
                        <li><i className="is-now" />{inr(balance)} now</li>
                        {pos.incomeDue > 0 && <li><i className="is-coming" />{inr(pos.incomeDue)} coming</li>}
                        {pos.expenseDue > 0 && <li><i className="is-bills" />{inr(pos.expenseDue)} to pay</li>}
                      </ul>
                      {out.length > 0 && (
                        <>
                          {/* A dot a bill, filled once it is paid. */}
                          <p className="bank-dots" role="img" aria-label={`${out.filter((l) => l.paid).length} of ${out.length} bills paid`}>{out.map((l) => <i key={l.item.id} className={l.paid ? "is-paid" : l.skipped ? "is-skipped" : ""} />)}</p>
                          <Lines flat lines={out} onToggle={togglePaid} onOpen={openLine} locked={!canEdit} empty="" />
                        </>
                      )}
                    </section>
                  );
                })}
                {lines.some((l) => !l.item.bank_id) && (
                  <section className="card bank">
                    <div className="bank-head"><span className="kit-mono is-none" aria-hidden>?</span><h2>No bank chosen</h2></div>
                    <Lines flat lines={lines.filter((l) => !l.item.bank_id)} onToggle={togglePaid} onOpen={openLine} locked={!canEdit} empty="" />
                  </section>
                )}
              </>
            )}

            {tab === "insights" && (
              <>
                {monthBar}
                <Insights lines={lines} view={view} ym={ym} />
              </>
            )}

            {tab === "setup" && <MoneySetup ctx={ctx} money={view} scope={scope} canEdit={canEdit} circles={circles} />}
          </div>
        </section>
        {panel && (
          <Panel title={panel.kind === "line" ? monthLabel(ym) : panelItem ? "Edit item" : "New item"} onClose={close}>
            {panel.kind === "line"
              ? panelLine ? <MoneyLineForm key={`${panelLine.item.id}-${ym}-${panelLine.paid}-${panelLine.skipped}-${panelLine.actual}-${panelLine.budget}`} ctx={ctx} money={money} line={panelLine} ym={ym} shared={!!scope} canEdit={canEdit} onEditItem={() => setPanel({ kind: "item", id: panelLine.item.id })} onDone={close} /> : <p className="muted">This item is not in {monthLabel(ym)}.</p>
              : <MoneyItemForm key={panel.again?.id ?? panel.id ?? `new-${panel.as}-${sid}`} ctx={ctx} money={view} scope={scope} canEdit={canEdit} existing={panelItem} again={panel.again} kind={panel.as} onDone={close} />}
          </Panel>
        )}
      </main>
    </>
  );
}

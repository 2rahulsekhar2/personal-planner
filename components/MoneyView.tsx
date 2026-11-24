"use client";
import { Fragment, useEffect, useMemo, useState } from "react";
import { DateTime } from "luxon";
import type { PlannerCtx } from "./usePlanner";
import type { MoneyCtx } from "./useMoney";
import Panel from "./Panel";
import Select from "./Select";
import MoneySetup, { TONES } from "./MoneySetup";
import { MoneyItemForm, MoneyLineForm } from "./MoneyItemForm";
import { amountOn, loanNow, bankPosition, byPerson, byType, expected, forecast, formulaItems, FREQ_LABELS, inr, monthLabel, monthLines, partIds, shiftMonth, totals, waitingOn, withParts, yearRows, type Line, type MoneyFreq, type MoneyKind, type Proposal } from "@/lib/money";
import { canAdd, isCurrent, type Circle } from "@/lib/circles";
import { todayISO } from "@/lib/time";

type Tab = "month" | "year" | "items" | "banks" | "insights" | "setup";
const TABS: { value: Tab; label: string }[] = [{ value: "month", label: "Month" }, { value: "year", label: "Year" }, { value: "items", label: "Items" }, { value: "banks", label: "Banks" }, { value: "insights", label: "Insights" }, { value: "setup", label: "Setup" }];
// `again`: a rejected request, opened to be changed and sent once more.
// `date`: the first date a new item starts with. `ym`: the month of the line, when it is not the month on show.
type PanelState = { kind: "item"; id?: string; as?: MoneyKind; again?: Proposal; date?: string } | { kind: "line"; id: string; ym?: string } | null;

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

// What is still open comes first, then what is settled, then what was skipped; by date within each.
const lineRank = (l: Line) => (l.skipped ? 2 : l.paid ? 1 : 0);
const inOrder = (lines: Line[]) => [...lines].sort((a, b) => lineRank(a) - lineRank(b) || a.dates[0].localeCompare(b.dates[0]) || a.item.name.localeCompare(b.item.name));
/** The one day every line falls on, when they all share it: then the day is said once, not on every row. */
const sharedDay = (lines: Line[]) => (lines.length > 1 && lines.every((l) => l.dates.length === 1 && l.dates[0] === lines[0].dates[0]) ? lines[0].dates[0] : null);

/**
 * A month's income or expense lines. The box marks a line paid or received; the row opens that month's figures.
 * `flat`: inside another card (the bills of a bank), so drawn without a card of its own.
 * `groupBy`: gather the lines under their type, each group with its own total and progress. A group that is all
 * settled starts folded to its heading. With fewer than two types in the list there is nothing to group.
 */
function Lines({ lines, meta, onToggle, onOpen, empty, locked, flat, groupBy }: {
  lines: Line[]; meta?: (l: Line) => React.ReactNode; onToggle: (l: Line) => void; onOpen: (l: Line) => void; empty: string; locked?: boolean; flat?: boolean;
  groupBy?: (typeId: string | null) => { name: string; tone: string | null };
}) {
  const [flipped, setFlipped] = useState<string[]>([]); // groups whose fold was changed by hand
  if (!lines.length) return <p className="empty card">{empty}</p>;
  const verb = lines[0].item.kind === "expense" ? "paid" : "received";
  // `noLeaf`: every line around this one falls on the same day, which is said once above them instead.
  const row = (l: Line, noLeaf: boolean) => (
    <Fragment key={l.item.id}>
    <li className={`task-row ${l.paid ? "is-done" : ""} ${l.skipped ? "is-skipped" : ""}`}>
      <button className={`task-check ${l.paid ? "is-checked" : ""}`} disabled={l.skipped || locked} aria-pressed={l.paid} aria-label={`${l.item.name}: ${l.paid ? `mark not ${verb}` : `mark ${verb}`}`} onClick={() => onToggle(l)}>
        {l.paid && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>}
      </button>
      {/* The due date as a small calendar leaf: the day over its weekday. An item due many times shows how many. */}
      {!noLeaf && (
        <span className="line-date" role="img" aria-label={dueLabel(l)}>
          {l.dates.length > 1 ? <><strong>×{l.dates.length}</strong><span>times</span></> : <><strong>{DateTime.fromISO(l.dates[0]).toFormat("d")}</strong><span>{DateTime.fromISO(l.dates[0]).toFormat("ccc")}</span></>}
        </span>
      )}
      <button className="task-main" onClick={() => onOpen(l)}>
        <span className="task-title">{l.item.name}</span>
        {(l.skipped || l.warn || meta?.(l)) && <span className="task-due line-meta">{l.skipped ? "Skipped" : l.warn ? <span className="items-fix">{l.warn}</span> : meta!(l)}</span>}
      </button>
      <span className="money-amt">
        <strong>{inr(expected(l))}</strong>
        {l.actual !== null && l.actual !== l.budget && <span className={l.item.kind === "expense" && l.actual > l.budget ? "is-over" : ""}>of {inr(l.budget)}</span>}
        {/* Under a rupee apart is rounding from an import, not a change worth pointing at. */}
        {l.actual === null && Math.abs(l.budget - l.rule) >= 1 && <span>usually {inr(l.rule)}</span>}
      </span>
    </li>
    {/* A computed item's parts, under it: each opens its own month, where what it really came to is recorded. */}
    {withParts(l.parts ?? []).map((p) => (
      <li key={p.item.id} className={`task-row line-part ${p.skipped ? "is-skipped" : ""}`}>
        <button className="task-main" onClick={() => onOpen(p)} aria-label={`${p.item.name}, part of ${l.item.name}`}>
          <span className="task-title">{p.item.name}</span>
          {p.skipped && <span className="task-due line-meta">Skipped</span>}
        </button>
        <span className="money-amt"><span>{inr(expected(p))}</span></span>
      </li>
    ))}
    </Fragment>
  );

  const typeIds = [...new Set(lines.map((l) => l.item.type_id))];
  if (!groupBy || typeIds.length < 2) return <ul className={`task-list money-lines ${flat ? "is-flat" : "card"}`}>{inOrder(lines).map((l) => row(l, !!sharedDay(lines)))}</ul>;

  const groups = typeIds.map((id) => {
    const own = lines.filter((l) => l.item.type_id === id);
    const live = own.filter((l) => !l.skipped);
    const total = live.reduce((sum, l) => sum + expected(l), 0);
    const done = live.filter((l) => l.paid);
    return { key: id ?? "none", ...groupBy(id), own, live, total, done, settled: done.reduce((sum, l) => sum + expected(l), 0) };
  }).sort((a, b) => b.total - a.total);

  return (
    <div className="money-groups">
      {groups.map((g) => {
        const allDone = g.live.length > 0 && g.done.length === g.live.length;
        const open = flipped.includes(g.key) ? allDone : !allDone;
        const day = sharedDay(g.own);
        return (
          <section key={g.key} className={`card money-group ${allDone ? "is-done" : ""}`}>
            <button className="money-group-head" aria-expanded={open} onClick={() => setFlipped(flipped.includes(g.key) ? flipped.filter((k) => k !== g.key) : [...flipped, g.key])}>
              <span className={`kit-mono ${g.tone ? `act-${g.tone}` : "is-none"}`} aria-hidden>{g.name[0]?.toUpperCase()}</span>
              <span className="grow money-group-what">
                <span className="money-group-name"><span className="kit-name">{g.name}</span>{day && <span className="line-day">{DateTime.fromISO(day).toFormat("d LLL")}</span>}</span>
                {/* How much of the group is settled. */}
                <span className={`money-group-track ${g.tone ? `act-${g.tone}` : ""}`} aria-hidden><span style={{ width: `${g.total > 0 ? (g.settled / g.total) * 100 : 0}%` }} /></span>
              </span>
              <span className="money-group-sum">
                <strong>{inr(g.total)}</strong>
                <span>{g.live.length === 0 ? "skipped" : allDone ? `all ${verb}` : `${g.done.length} of ${g.live.length} ${verb}`}</span>
              </span>
              <svg className="money-group-fold" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M6 9.5l6 6 6-6" /></svg>
            </button>
            {open && <ul className="task-list money-lines is-flat">{inOrder(g.own).map((l) => row(l, !!day))}</ul>}
          </section>
        );
      })}
    </div>
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
function Insights({ lines, view, ym, today }: { lines: Line[]; view: MoneyCtx; ym: string; today: string }) {
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
  const loans = view.items.filter((i) => i.loan).map((i, n) => ({ i, tone: TONES[n % TONES.length], now: loanNow(i, Number(view.increases.find((x) => x.id === i.increase_id)?.percent ?? 0), today) }));
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

      {loans.length > 0 && (
        <section className="ins-wide">
          <h2>Loans</h2>
          <ul className="ins-banks">
            {loans.map(({ i, tone, now }) => {
              const taken = Number(i.loan!.principal);
              const repaid = Math.max(0, Math.min(1, taken > 0 ? 1 - now.balance / taken : 1));
              return (
                <li key={i.id} className="card">
                  <span className="ins-bank-top"><span className={`kit-mono act-${tone}`}>{i.name.trim()[0]?.toUpperCase()}</span><span className="ins-name">{i.name}</span></span>
                  <strong className="ins-bank-left">{inr(now.balance)}</strong>
                  {/* The track is the amount taken; the solid part is what has been paid back. */}
                  <span className={`ins-track act-${tone}`} role="img" aria-label={`${inr(now.balance)} still owed of ${inr(taken)} taken`}>
                    <span className="ins-paid" style={{ width: `${repaid * 100}%` }} />
                  </span>
                  <span className="ins-sub">{now.balance <= 0 ? "paid off" : now.endless ? "owed, and the EMI does not cover the interest" : `owed of ${inr(taken)}, ends ${now.ends ? DateTime.fromISO(now.ends).toFormat("LLL yyyy") : ""}`}</span>
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

const plain = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const amt = (n: number) => (n ? plain.format(n) : "");
/**
 * Twelve months side by side, a row an item: a filled cell is a month the item falls due, so a row's pattern is
 * how often it comes. A filled cell opens that month of the item; an empty one, or a month's name, adds an item there.
 */
function Year({ view, from, nowYm, canEdit, groupBy, onLine, onItem, onAdd }: {
  view: MoneyCtx; from: string; nowYm: string; canEdit: boolean; groupBy: (typeId: string | null) => { name: string; tone: string | null };
  onLine: (id: string, ym: string) => void; onItem: (id: string) => void; onAdd: (ym: string, kind?: MoneyKind) => void;
}) {
  const { months, rows } = useMemo(() => yearRows(view.items, view.entries, view.increases, from), [view.items, view.entries, view.increases, from]);
  // The types folded shut, each down to its row of totals.
  const [shut, setShut] = useState<Set<string>>(new Set());
  if (!view.items.length) return <p className="empty card">No items yet. Add an income or an expense, and the months it falls in show here.</p>;
  const sums = (rs: typeof rows) => months.map((_, n) => rs.reduce((s, r) => s + r.values[n], 0));
  const now = (ym: string) => (ym === nowYm ? "is-now" : "");
  const short = (ym: string) => DateTime.fromISO(`${ym}-01`);
  const figures = (values: number[]) => <>{values.map((v, n) => <td key={months[n]} className={now(months[n])}>{amt(v)}</td>)}<td className="yr-total">{amt(values.reduce((s, v) => s + v, 0))}</td></>;

  const section = (kind: MoneyKind, title: string) => {
    const own = rows.filter((r) => r.item.kind === kind);
    const word = kind === "expense" ? "paid" : "received";
    const groups = [...new Set(own.map((r) => r.item.type_id))]
      .map((id) => ({ id, ...groupBy(id), rows: own.filter((r) => r.item.type_id === id) }))
      .sort((a, b) => b.rows.reduce((s, r) => s + r.total, 0) - a.rows.reduce((s, r) => s + r.total, 0));
    return (
      <tbody className={kind === "income" ? "yr-in" : "yr-out"}>
        {/* A break in the table between money in and money out. */}
        {kind === "expense" && <tr className="yr-gap" aria-hidden><td colSpan={months.length + 2} /></tr>}
        <tr className="yr-kind"><th scope="rowgroup">{title}</th>{figures(sums(own))}</tr>
        {own.length === 0 && <tr><th scope="row" className="yr-none">Nothing in these months</th><td colSpan={months.length + 1} /></tr>}
        {groups.map((g) => (
          <Fragment key={g.id ?? "none"}>
            {groups.length > 1 && (
              <tr className={`yr-type ${g.tone ? `act-${g.tone}` : ""}`}>
                <th scope="rowgroup">
                  <button className="yr-fold" aria-expanded={!shut.has(`${kind}:${g.id}`)} onClick={() => setShut((was) => { const next = new Set(was); if (!next.delete(`${kind}:${g.id}`)) next.add(`${kind}:${g.id}`); return next; })}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M6 9l6 6 6-6" /></svg>
                    <span className={`kit-mono is-mini ${g.tone ? `act-${g.tone}` : "is-none"}`} aria-hidden>{g.name[0]?.toUpperCase()}</span>
                    <span>{g.name}</span>
                  </button>
                </th>
                {figures(sums(g.rows))}
              </tr>
            )}
            {!(groups.length > 1 && shut.has(`${kind}:${g.id}`)) && g.rows.map((r) => (
              <tr key={r.item.id}>
                <th scope="row"><button className="yr-name" title={r.item.name} onClick={() => onItem(r.item.id)}>{r.item.name}</button></th>
                {r.cells.map((l, n) => {
                  const ym = months[n];
                  const late = !!l && !l.paid && !l.skipped && ym < nowYm;
                  return (
                    <td key={ym} className={now(ym)}>
                      {l ? (
                        <button className={`yr-cell ${g.tone ? `act-${g.tone}` : "is-none"} ${l.paid ? "is-paid" : ""} ${l.skipped ? "is-skipped" : ""} ${late ? "is-late" : ""}`} aria-label={`${r.item.name}, ${monthLabel(ym)}: ${inr(expected(l))}, ${l.skipped ? "skipped" : l.paid ? word : late ? `not ${word}, overdue` : `not ${word}`}`} onClick={() => onLine(r.item.id, ym)}>
                          {l.paid && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>}
                          {plain.format(expected(l))}
                        </button>
                      ) : canEdit ? <button className="yr-add" aria-label={`Add ${kind === "expense" ? "an expense" : "an income"} in ${monthLabel(ym)}`} onClick={() => onAdd(ym, kind)}>＋</button> : null}
                    </td>
                  );
                })}
                <td className="yr-total">{amt(r.total)}</td>
              </tr>
            ))}
          </Fragment>
        ))}
      </tbody>
    );
  };
  const inSums = sums(rows.filter((r) => r.item.kind === "income"));
  const outSums = sums(rows.filter((r) => r.item.kind === "expense"));
  const left = months.map((_, n) => inSums[n] - outSums[n]);
  const leftAll = left.reduce((s, v) => s + v, 0);
  const signed = (v: number) => `${v < 0 ? "− " : ""}${plain.format(Math.abs(v))}`;

  return (
    <div className="card yr" tabIndex={0} role="region" aria-label="The year, month by month">
      <table>
        <thead>
          <tr>
            <th scope="col">Item</th>
            {months.map((ym, n) => {
              // The year is said where it starts: on the first column, and on each January.
              const label = <>{short(ym).toFormat("LLL")}{(n === 0 || ym.endsWith("-01")) && <span>{ym.slice(0, 4)}</span>}</>;
              return <th key={ym} scope="col" className={now(ym)}>{canEdit ? <button className="yr-month" aria-label={`Add an income or expense in ${monthLabel(ym)}`} title={`Add in ${monthLabel(ym)}`} onClick={() => onAdd(ym)}>{label}</button> : <span className="yr-month">{label}</span>}</th>;
            })}
            <th scope="col" className="yr-total">12 months</th>
          </tr>
        </thead>
        {section("income", "Income")}
        {section("expense", "Expenses")}
        <tfoot>
          <tr className="yr-gap" aria-hidden><td colSpan={months.length + 2} /></tr>
          <tr className="yr-kind">
            <th scope="row">Left</th>
            {left.map((v, n) => <td key={months[n]} className={`${now(months[n])} ${v < 0 ? "is-short" : ""}`}>{signed(v)}</td>)}
            <td className={`yr-total ${leftAll < 0 ? "is-short" : ""}`}>{signed(leftAll)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

type ItemFilter = "all" | "income" | "expense" | "fix";
const FREQ_MARK: Record<MoneyFreq, string> = { once: "1", daily: "D", weekly: "W", monthly: "M", yearly: "Y" };
/** What an amount each time comes to in an average month. A one-time item has no monthly weight. */
const perMonth = (amount: number, freq: MoneyFreq) => (freq === "daily" ? (amount * 365) / 12 : freq === "weekly" ? (amount * 52) / 12 : freq === "monthly" ? amount : freq === "yearly" ? amount / 12 : 0);

/**
 * Every income and expense item in the budget in view, whatever the month, drawn rather than described: a bar
 * for how much of the month each one is, a letter for how often, a monogram for its type and its bank. Parts sit
 * under the item that uses them. What a mark means is in its tooltip, and the whole row is read out in words.
 */
function Items({ view, today, canEdit, onOpen, onNew }: { view: MoneyCtx; today: string; canEdit: boolean; onOpen: (id: string) => void; onNew: () => void }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<ItemFilter>("all");
  type Item = MoneyCtx["items"][number];
  const pct = new Map(view.increases.map((i) => [i.id, Number(i.percent)]));
  const bankAt = new Map(view.banks.map((b, n) => [b.id, { name: b.name, tone: TONES[n % TONES.length] }]));
  // The same colours as in Insights and Setup.
  const typeAt = new Map([...view.types].sort((a, b) => a.kind.localeCompare(b.kind)).map((t, n) => [t.id, { name: t.name, tone: TONES[n % TONES.length] }]));
  const broken = (i: Item) => !i.bank_id || !bankAt.has(i.bank_id) || !i.type_id || !typeAt.has(i.type_id);
  const counts = { all: view.items.length, income: view.items.filter((i) => i.kind === "income").length, expense: view.items.filter((i) => i.kind === "expense").length, fix: view.items.filter(broken).length };
  const parts = partIds(view.items);
  const parentOf = new Map(view.items.flatMap((i) => formulaItems(i.formula).map((id) => [id, i] as const)));
  const thisMonth = new Map(withParts(monthLines(view.items, view.entries, view.increases, today.slice(0, 7))).map((l) => [l.item.id, l]));
  // Each item's figures once: what it comes to each time now, and its weight in an average month.
  const facts = new Map(view.items.map((i) => {
    const ended = !!i.end_date && i.end_date < today;
    const later = i.start_date > today;
    const percent = (i.freq !== "once" && i.increase_id && pct.get(i.increase_id)) || 0;
    const owes = i.loan && !i.formula ? loanNow(i, percent, today).balance : null;
    const amount = i.formula ? thisMonth.get(i.id)?.budget ?? 0 : amountOn(i, later ? i.start_date : ended ? i.end_date! : today, percent);
    const weight = ended || owes === 0 ? 0 : i.formula ? amount : perMonth(amount, i.freq);
    return [i.id, { ended, later, owes, amount, weight }] as const;
  }));
  const text = q.trim().toLowerCase();
  const shown = view.items
    .filter((i) => (filter === "all" ? true : filter === "fix" ? broken(i) : i.kind === filter))
    .filter((i) => !text || i.name.toLowerCase().includes(text));
  const shownIds = new Set(shown.map((i) => i.id));
  const heavy = (a: Item, b: Item) => facts.get(b.id)!.weight - facts.get(a.id)!.weight || a.name.localeCompare(b.name);
  // A part goes under the item that uses it, when that item is in the list too.
  const under = (i: Item, depth: number): { i: Item; depth: number }[] => [{ i, depth }, ...(depth < 6 ? shown.filter((p) => parentOf.get(p.id)?.id === i.id).sort(heavy).flatMap((p) => under(p, depth + 1)) : [])];
  const tops = shown.filter((i) => !parentOf.has(i.id) || !shownIds.has(parentOf.get(i.id)!.id));
  // An average month, by type: what counts is every item that is a line of its own and still running.
  const flow = (kind: MoneyKind) => {
    const live = view.items.filter((i) => i.kind === kind && !parts.has(i.id));
    const ids = [...new Set(live.map((i) => (i.type_id && typeAt.has(i.type_id) ? i.type_id : null)))];
    const segs = ids.map((id) => ({ id, ...(id ? typeAt.get(id)! : { name: "No type", tone: null }), sum: live.filter((i) => (i.type_id && typeAt.has(i.type_id) ? i.type_id : null) === id).reduce((n, i) => n + facts.get(i.id)!.weight, 0) })).filter((x) => x.sum > 0).sort((a, b) => b.sum - a.sum);
    return { segs, total: segs.reduce((n, x) => n + x.sum, 0) };
  };
  const flows = { income: flow("income"), expense: flow("expense") };
  const reach = Math.max(flows.income.total, flows.expense.total, 1);
  const top = { income: Math.max(...view.items.filter((i) => i.kind === "income").map((i) => facts.get(i.id)!.weight), 1), expense: Math.max(...view.items.filter((i) => i.kind === "expense").map((i) => facts.get(i.id)!.weight), 1) };

  const row = ({ i, depth }: { i: Item; depth: number }) => {
    const f = facts.get(i.id)!;
    const bank = i.bank_id ? bankAt.get(i.bank_id) : undefined;
    const type = i.type_id ? typeAt.get(i.type_id) : undefined;
    const changes = (i.amount_steps ?? []).length;
    const parent = parentOf.get(i.id);
    const taken = i.loan ? Number(i.loan.principal) : 0;
    const repaid = f.owes !== null && taken > 0 ? Math.max(0, Math.min(1, 1 - f.owes / taken)) : 0;
    const when = f.ended ? "ended" : f.later ? `from ${DateTime.fromISO(i.start_date).toFormat("d LLL yyyy")}` : FREQ_LABELS[i.freq].toLowerCase();
    // The row in words, for a screen reader and for anyone who hovers.
    const words = [
      `${i.name}: ${i.kind === "income" ? "income" : "expense"}, ${i.formula ? `computed, ${thisMonth.has(i.id) ? inr(f.amount) : "nothing"} this month` : `${inr(f.amount)} ${when}`}`,
      f.owes !== null ? (f.owes > 0 ? `loan, ${inr(f.owes)} owed` : "loan, paid off") : "",
      changes ? `${changes} ${changes === 1 ? "change" : "changes"} of amount` : "",
      parent ? `part of ${parent.name}` : "",
      bank ? bank.name : "needs bank", type ? type.name : "needs type",
    ].filter(Boolean).join(", ");
    return (
      <li key={i.id}>
        <button className={`items-row ${f.ended || f.owes === 0 ? "is-ended" : ""} ${depth ? "is-part" : ""}`} style={depth ? { paddingLeft: 16 + depth * 28 } : undefined} aria-label={words} title={words} onClick={() => onOpen(i.id)}>
          {type
            ? <span className={`kit-mono act-${type.tone}`} aria-hidden>{type.name.trim()[0]?.toUpperCase()}</span>
            : <span className="kit-mono is-none items-fix" aria-hidden>?</span>}
          <span className="grow items-what">
            <span className="items-name">{i.name}</span>
            {/* How much of an average month this item is, against the largest of its kind. */}
            <span className={`items-bar ${type ? `act-${type.tone}` : "is-none"} ${i.kind === "income" ? "is-in" : ""}`} aria-hidden><span style={{ width: `${f.weight > 0 ? Math.max(3, (f.weight / top[i.kind]) * 100) : 0}%` }} /></span>
          </span>
          <span className="money-amt">
            <strong>{i.formula && !thisMonth.has(i.id) ? "—" : inr(f.amount)}</strong>
            <span className="items-marks" aria-hidden>
              {f.later && <span className="items-from">{DateTime.fromISO(i.start_date).toFormat("d LLL")}</span>}
              {i.formula && <span className="items-mark is-sum">ƒ</span>}
              {f.owes !== null && (
                <svg className="items-ring" width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" /><circle cx="8" cy="8" r="6" pathLength="100" strokeDasharray={`${repaid * 100} 100`} /></svg>
              )}
              {changes > 0 && <svg className="items-steps" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3 20h6v-6h6V8h6" /></svg>}
              <span className={`items-mark ${f.ended ? "is-off" : ""}`}>{FREQ_MARK[i.freq]}</span>
              {bank ? <span className={`kit-mono is-mini act-${bank.tone}`}>{bank.name.trim()[0]?.toUpperCase()}</span> : <span className="kit-mono is-mini is-none items-fix">?</span>}
            </span>
          </span>
        </button>
      </li>
    );
  };
  const section = (kind: MoneyKind) => {
    const list = tops.filter((i) => i.kind === kind).sort(heavy).flatMap((i) => under(i, 0));
    if (!list.length) return null;
    return (
      <section key={kind} className="items-kind">
        <h2><span className={`kit-way ${kind === "income" ? "is-in" : "is-out"}`} aria-hidden><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={kind === "income" ? "M12 5v14M6 13l6 6 6-6" : "M12 19V5M6 11l6-6 6 6"} /></svg></span>{kind === "income" ? "Income" : "Expenses"}</h2>
        <ul className="card list items-list">{list.map(row)}</ul>
      </section>
    );
  };

  return (
    <>
      <div className="page-head">
        <h1>Items</h1>
        {canEdit && <button className="btn btn-primary" onClick={onNew}>＋ New item</button>}
      </div>
      {view.items.length > 0 && (
        <section className="card items-flow" aria-label="An average month">
          {(["income", "expense"] as const).map((kind) => (
            <div key={kind} className="sum-row">
              <span>{kind === "income" ? "In" : "Out"}</span>
              {/* One piece a type, as wide as its share of an average month. */}
              <span className="flow-track" role="img" aria-label={`${kind === "income" ? "Income" : "Expenses"} in an average month: ${flows[kind].segs.map((x) => `${x.name} ${inr(Math.round(x.sum))}`).join(", ") || "none"}`}>
                <span style={{ width: `${(flows[kind].total / reach) * 100}%` }}>
                  {flows[kind].segs.map((x) => <i key={x.id ?? "none"} className={x.tone ? `act-${x.tone}` : "is-none"} style={{ flexGrow: x.sum }} title={`${x.name}: ${inr(Math.round(x.sum))}`} />)}
                </span>
              </span>
              <strong>{inr(Math.round(flows[kind].total))}</strong>
            </div>
          ))}
          <p className="ins-key"><span>an average month, a colour a type</span></p>
        </section>
      )}
      <div className="items-filters">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name" aria-label="Search items by name" />
        <div className="chips" role="group" aria-label="Show">
          {([["all", "All"], ["income", "Income"], ["expense", "Expenses"], ["fix", "To fix"]] as const).filter(([f]) => f !== "fix" || counts.fix > 0).map(([f, label]) => (
            <button key={f} className={`chip chip-sm ${filter === f ? "is-selected" : ""}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>{label} <span className="items-count">{counts[f]}</span></button>
          ))}
        </div>
      </div>
      {shown.length === 0
        ? <p className="empty card">{view.items.length === 0 ? "No items yet. An item is one income or expense, with how much and how often." : "Nothing matches."}</p>
        : <>{section("income")}{section("expense")}</>}
    </>
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
      <div className="page-head"><h2>Requests</h2></div>
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
  const [formKind, setFormKind] = useState<MoneyKind>("expense"); // what the open item form is set to, for the panel's title
  // The month on show follows the calendar until one is picked by hand.
  const [picked, setPicked] = useState<string | null>(null);
  const nowYm = todayISO(ctx.tz).slice(0, 7);
  const ym = picked ?? nowYm;
  // The year starts at the current month until it is moved by hand.
  const [yearPick, setYearPick] = useState<string | null>(null);
  const yearFrom = yearPick ?? nowYm;

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
  // A type keeps the colour it has on Setup and Insights.
  const typeAt = new Map([...view.types].sort((a, b) => a.kind.localeCompare(b.kind)).map((t, n) => [t.id, { name: t.name, tone: TONES[n % TONES.length] as string | null }]));
  const groupBy = (id: string | null) => (id ? typeAt.get(id) : undefined) ?? { name: id ? "A removed type" : "No type", tone: null };
  // Inside a type's group the type is already said: only the bank is left to show.
  const bankOnly = (l: Line) => {
    const bank = l.item.bank_id ? bankAt.get(l.item.bank_id) : undefined;
    return bank ? <><span className={`kit-mono is-mini act-${bank.tone}`} aria-hidden>{bank.name.trim()[0]?.toUpperCase()}</span>{bank.name}</> : null;
  };
  const head = (title: string, kind: MoneyKind) => {
    const own = lines.filter((l) => l.item.kind === kind);
    const live = own.filter((l) => !l.skipped);
    const done = live.filter((l) => l.paid).length;
    const word = kind === "expense" ? "paid" : "received";
    const day = sharedDay(own);
    return (
      <div className="page-head line-head">
        <h2>{title}</h2>
        {/* A dot a line while they can be counted at a glance; past that, a bar and the count. */}
        {own.length > 0 && own.length <= 12 && <span className="bank-dots" role="img" aria-label={`${done} of ${live.length} ${word}`}>{inOrder(own).map((l) => <i key={l.item.id} className={l.paid ? "is-paid" : l.skipped ? "is-skipped" : ""} />)}</span>}
        {own.length > 12 && <span className="line-progress" role="img" aria-label={`${done} of ${live.length} ${word}`}><span className="line-progress-track"><span style={{ width: `${live.length ? (done / live.length) * 100 : 0}%` }} /></span>{done}/{live.length}</span>}
        {day && <span className="line-day">all on {DateTime.fromISO(day).toFormat("d LLL")}</span>}
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

  // A line opened from the year is of the month clicked, not the month on show.
  const lineYm = (panel?.kind === "line" && panel.ym) || ym;
  const panelLine = panel?.kind === "line" ? withParts(lineYm === ym ? lines : monthLines(view.items, view.entries, view.increases, lineYm)).find((l) => l.item.id === panel.id) : undefined;
  const panelItem = panel?.kind === "item" && panel.id ? view.items.find((i) => i.id === panel.id) : undefined;
  const close = () => setPanel(null);
  const openLine = (l: Line) => setPanel({ kind: "line", id: l.item.id });
  const pick = (id: string | null) => { setScopeId(id); setPanel(null); };

  const tabStrip = (
    <div className="view-toggle money-tabs" role="group" aria-label="Money section">
      {TABS.map((t) => <button key={t.value} className={tab === t.value ? "is-active" : ""} aria-pressed={tab === t.value} onClick={() => setTab(t.value)}>{t.label}</button>)}
    </div>
  );
  const scopeBar = families.length > 0 && (
    <div className="scope-bar" role="group" aria-label="Whose budget">
      <button className={`chip ${!scope ? "is-selected" : ""}`} aria-pressed={!scope} onClick={() => pick(null)}>Mine</button>
      {families.map((c) => <button key={c.id} className={`chip ${scope?.id === c.id ? "is-selected" : ""}`} aria-pressed={scope?.id === c.id} onClick={() => pick(c.id)}>{c.name}</button>)}
      {scope && !canEdit && <span className="hint" style={{ margin: 0 }}>You are a viewer here: you can look, not change.</span>}
    </div>
  );

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
          <div className={`page ${tab === "year" ? "is-wide" : ""}`}>
            {/* The year keeps the grid high on the screen: the sections and whose budget sit in its one bar, not on rows of their own. */}
            {tab !== "year" && tabStrip}
            {tab !== "year" && scopeBar}
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
                <Lines groupBy={groupBy} lines={lines.filter((l) => l.item.kind === "income")} meta={new Set(lines.filter((l) => l.item.kind === "income").map((l) => l.item.type_id)).size > 1 ? bankOnly : meta} onToggle={togglePaid} onOpen={openLine} locked={!canEdit} empty={`No income in ${monthLabel(ym)}.`} />
                {head("Expenses", "expense")}
                <Lines groupBy={groupBy} lines={lines.filter((l) => l.item.kind === "expense")} meta={new Set(lines.filter((l) => l.item.kind === "expense").map((l) => l.item.type_id)).size > 1 ? bankOnly : meta} onToggle={togglePaid} onOpen={openLine} locked={!canEdit} empty={`No expenses in ${monthLabel(ym)}.`} />
              </>
            )}

            {tab === "year" && (
              <>
                {/* Wide: the tabs and chips as they are elsewhere. On a phone each folds into a button that opens its list. */}
                <div className="toolbar yr-bar">
                  <div className="yr-wide">{tabStrip}</div>
                  <div className="yr-narrow yr-pick is-left" aria-label="Money section"><Select id="money-section" value={tab} options={TABS} onChange={(v) => setTab(v as Tab)} /></div>
                  <div className="toolbar-group">
                    <button className="btn" onClick={() => setYearPick(shiftMonth(yearFrom, -12))} aria-label="Previous 12 months">‹</button>
                    <button className="btn" onClick={() => setYearPick(shiftMonth(yearFrom, 12))} aria-label="Next 12 months">›</button>
                  </div>
                  <h1 className="toolbar-title" aria-label={`${monthLabel(yearFrom)} to ${monthLabel(shiftMonth(yearFrom, 11))}`}>
                    <span className="yr-wide">{DateTime.fromISO(`${yearFrom}-01`).toFormat("LLL yyyy")} to {DateTime.fromISO(`${shiftMonth(yearFrom, 11)}-01`).toFormat("LLL yyyy")}</span>
                    <span className="yr-narrow">{DateTime.fromISO(`${yearFrom}-01`).toFormat("LLL yy")} – {DateTime.fromISO(`${shiftMonth(yearFrom, 11)}-01`).toFormat("LLL yy")}</span>
                  </h1>
                  {yearFrom !== nowYm && <button className="btn btn-sm" onClick={() => setYearPick(null)}><span className="yr-wide">This month</span><span className="yr-narrow">Now</span></button>}
                  <div className="yr-wide yr-scope">{scopeBar}</div>
                  {families.length > 0 && <div className="yr-narrow yr-pick yr-scope" aria-label="Whose budget"><Select id="money-scope" value={sid ?? ""} options={[{ value: "", label: "Mine" }, ...families.map((c) => ({ value: c.id, label: c.name }))]} onChange={(v) => pick(v || null)} /></div>}
                </div>
                <Year view={view} from={yearFrom} nowYm={nowYm} canEdit={canEdit} groupBy={groupBy}
                  onLine={(id, m) => setPanel({ kind: "line", id, ym: m })} onItem={(id) => setPanel({ kind: "item", id })}
                  onAdd={(m, kind) => setPanel({ kind: "item", as: kind, date: m === nowYm ? todayISO(ctx.tz) : `${m}-01` })} />
                <p className="ins-key yr-key"><span><i className="is-paid" />done</span><span><i className="is-plan" />still to come</span><span><i className="is-spill" />overdue</span></p>
              </>
            )}

            {tab === "items" && <Items view={view} today={todayISO(ctx.tz)} canEdit={canEdit} onOpen={(id) => setPanel({ kind: "item", id })} onNew={() => setPanel({ kind: "item" })} />}

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
                <Insights lines={lines} view={view} ym={ym} today={todayISO(ctx.tz)} />
              </>
            )}

            {tab === "setup" && <MoneySetup ctx={ctx} money={view} scope={scope} canEdit={canEdit} circles={circles} />}
          </div>
        </section>
        {panel && (
          <Panel title={panel.kind === "line" ? monthLabel(lineYm) : `${panelItem ? "Edit" : "New"} ${formKind} item`} onClose={close}>
            {panel.kind === "line"
              ? panelLine ? <MoneyLineForm key={`${panelLine.item.id}-${lineYm}-${panelLine.paid}-${panelLine.skipped}-${panelLine.actual}-${panelLine.budget}`} ctx={ctx} money={money} line={panelLine} ym={lineYm} shared={!!scope} canEdit={canEdit} onEditItem={() => setPanel({ kind: "item", id: panelLine.item.id })} onDone={close} /> : <p className="muted">This item is not in {monthLabel(lineYm)}.</p>
              : <MoneyItemForm key={panel.again?.id ?? panel.id ?? `new-${panel.as}-${panel.date}-${sid}`} date={panel.date} ctx={ctx} money={view} scope={scope} canEdit={canEdit} existing={panelItem} again={panel.again} kind={panel.as} onKind={setFormKind} onDone={close} />}
          </Panel>
        )}
      </main>
    </>
  );
}

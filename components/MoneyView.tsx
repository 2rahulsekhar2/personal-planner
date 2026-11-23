"use client";
import { useMemo, useState } from "react";
import { DateTime } from "luxon";
import type { PlannerCtx } from "./usePlanner";
import type { MoneyCtx } from "./useMoney";
import Panel from "./Panel";
import MoneySetup from "./MoneySetup";
import { MoneyItemForm, MoneyLineForm } from "./MoneyItemForm";
import { bankPosition, expected, inr, monthLabel, monthLines, shiftMonth, totals, type Line, type MoneyKind } from "@/lib/money";
import { todayISO } from "@/lib/time";

type Tab = "month" | "banks" | "setup";
type PanelState = { kind: "item"; id?: string; as?: MoneyKind } | { kind: "line"; id: string } | null;

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
function Lines({ lines, meta, onToggle, onOpen, empty }: { lines: Line[]; meta: (l: Line) => string; onToggle: (l: Line) => void; onOpen: (l: Line) => void; empty: string }) {
  if (!lines.length) return <p className="empty card">{empty}</p>;
  return (
    <ul className="card task-list money-lines">
      {lines.map((l) => {
        const verb = l.item.kind === "expense" ? "paid" : "received";
        return (
          <li key={l.item.id} className={`task-row ${l.paid ? "is-done" : ""} ${l.skipped ? "is-skipped" : ""}`}>
            <button className={`task-check ${l.paid ? "is-checked" : ""}`} disabled={l.skipped} aria-pressed={l.paid} aria-label={`${l.item.name}: ${l.paid ? `mark not ${verb}` : `mark ${verb}`}`} onClick={() => onToggle(l)}>{l.paid ? "✓" : ""}</button>
            <button className="task-main" onClick={() => onOpen(l)}>
              <span className="task-title">{l.item.name}</span>
              <span className="task-due">{l.skipped ? "Skipped this month" : meta(l)}</span>
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

export default function MoneyView({ ctx, money }: { ctx: PlannerCtx; money: MoneyCtx }) {
  const [tab, setTab] = useState<Tab>("month");
  const [panel, setPanel] = useState<PanelState>(null);
  // The month on show follows the calendar until one is picked by hand.
  const [picked, setPicked] = useState<string | null>(null);
  const nowYm = todayISO(ctx.tz).slice(0, 7);
  const ym = picked ?? nowYm;
  const lines = useMemo(() => monthLines(money.items, money.entries, money.increases, ym), [money.items, money.entries, money.increases, ym]);

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

  const bankName = new Map(money.banks.map((b) => [b.id, b.name]));
  const typeName = new Map(money.types.map((t) => [t.id, t.name]));
  const meta = (l: Line) => [dueLabel(l), l.item.bank_id && bankName.get(l.item.bank_id), l.item.type_id && typeName.get(l.item.type_id)].filter(Boolean).join(" · ");
  const income = totals(lines, "income");
  const spend = totals(lines, "expense");
  const left = income.budget - spend.budget;
  const planned = money.planned.includes(ym);
  const next = shiftMonth(nowYm, 1);

  const write = async (q: PromiseLike<{ error: { message: string } | null }>, done: string) => {
    const { error } = await q;
    if (error) return ctx.toast("error", `Couldn’t save: ${error.message}`);
    await money.reload();
    ctx.toast("ok", done);
  };
  const togglePaid = (l: Line) => {
    const word = l.item.kind === "expense" ? "paid" : "received";
    return write(ctx.supabase.from("money_entries").upsert({ item_id: l.item.id, month: `${ym}-01`, paid_at: l.paid ? null : new Date().toISOString() }), l.paid ? `${l.item.name} marked not ${word}` : `${l.item.name} ${word}`);
  };
  const setPlanned = (on: boolean) =>
    write(on ? ctx.supabase.from("money_months").upsert({ month: `${ym}-01` }) : ctx.supabase.from("money_months").delete().eq("month", `${ym}-01`), on ? `${monthLabel(ym)} planned` : `${monthLabel(ym)} reopened`);

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
  const panelItem = panel?.kind === "item" && panel.id ? money.items.find((i) => i.id === panel.id) : undefined;
  const close = () => setPanel(null);

  return (
    <>
      <button className="btn btn-primary btn-add" onClick={() => setPanel({ kind: "item" })}>
        <svg className="add-plus" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg>
        <span className="add-text">Add income or expense</span>
      </button>

      <main className={`main ${panel ? "has-panel" : ""}`}>
        <section className="content">
          <div className="page">
            <div className="view-toggle money-tabs" role="group" aria-label="Money section">
              {([["month", "Month"], ["banks", "Banks"], ["setup", "Setup"]] as const).map(([t, label]) => (
                <button key={t} className={tab === t ? "is-active" : ""} aria-pressed={tab === t} onClick={() => setTab(t)}>{label}</button>
              ))}
            </div>
            {money.error && <div className="alert alert-error" role="alert">Couldn’t load your budget: {money.error}. <button className="link" onClick={() => money.reload()}>Retry</button></div>}

            {tab === "month" && (
              <>
                {monthBar}
                <dl className="card money-sum">
                  <div><dt>Income</dt><dd>{inr(income.budget)}</dd><span>{inr(income.actual)} received</span></div>
                  <div><dt>Expenses</dt><dd>{inr(spend.budget)}</dd><span>{inr(spend.actual)} paid</span></div>
                  <div className={left < 0 ? "is-short" : ""}><dt>{left < 0 ? "Short by" : "Left over"}</dt><dd>{inr(Math.abs(left))}</dd><span>{left < 0 ? "Expenses are above income" : "After every planned expense"}</span></div>
                </dl>

                {planned ? (
                  <p className="money-plan"><span className="status-badge">✓ Planned</span> <button className="link" onClick={() => setPlanned(false)}>Reopen</button></p>
                ) : ym > nowYm ? (
                  <div className="money-plan">
                    <span className="muted grow">Check each line, change this month’s amounts where needed, then mark the month as planned.</span>
                    <button className="btn" disabled={!lines.length} onClick={() => setPlanned(true)}>Mark as planned</button>
                  </div>
                ) : ym === nowYm && !money.planned.includes(next) && money.items.length > 0 ? (
                  <p className="money-plan"><span className="muted">{monthLabel(next)} is not planned yet.</span> <button className="link" onClick={() => setPicked(next)}>Review it</button></p>
                ) : null}

                <div className="page-head"><h2>Expenses</h2><button className="btn btn-sm" onClick={() => setPanel({ kind: "item", as: "expense" })}>＋ Expense</button></div>
                <Lines lines={lines.filter((l) => l.item.kind === "expense")} meta={meta} onToggle={togglePaid} onOpen={(l) => setPanel({ kind: "line", id: l.item.id })} empty={`No expenses in ${monthLabel(ym)}.`} />
                <div className="page-head"><h2>Income</h2><button className="btn btn-sm" onClick={() => setPanel({ kind: "item", as: "income" })}>＋ Income</button></div>
                <Lines lines={lines.filter((l) => l.item.kind === "income")} meta={meta} onToggle={togglePaid} onOpen={(l) => setPanel({ kind: "line", id: l.item.id })} empty={`No income in ${monthLabel(ym)}.`} />
              </>
            )}

            {tab === "banks" && (
              <>
                {monthBar}
                {money.banks.every((b) => b.archived_at) && <p className="empty card">No banks yet. <button className="link" onClick={() => setTab("setup")}>Add one in Setup</button></p>}
                {money.banks.filter((b) => !b.archived_at).map((b) => {
                  const pos = bankPosition(b, lines);
                  const out = lines.filter((l) => l.item.bank_id === b.id && l.item.kind === "expense");
                  return (
                    <section key={b.id} className="card stack">
                      <div className="page-head"><h2>{b.name}</h2><span className="muted">{b.balance_at ? `Balance as of ${DateTime.fromISO(b.balance_at).toFormat("d LLL")}` : "Balance not set"}</span></div>
                      <dl className="money-ledger">
                        <div><dt>Balance</dt><dd>{inr(Number(b.balance))}</dd></div>
                        <div><dt>Income still to come</dt><dd>+ {inr(pos.incomeDue)}</dd></div>
                        <div><dt>Expenses still to pay</dt><dd>− {inr(pos.expenseDue)}</dd></div>
                        <div className={`is-total ${pos.after < 0 ? "is-short" : ""}`}><dt>{pos.after < 0 ? "Short by" : `Left after ${monthLabel(ym)}`}</dt><dd>{inr(Math.abs(pos.after))}</dd></div>
                      </dl>
                      <Lines lines={out} meta={dueLabel} onToggle={togglePaid} onOpen={(l) => setPanel({ kind: "line", id: l.item.id })} empty={`No expenses from ${b.name} in ${monthLabel(ym)}.`} />
                    </section>
                  );
                })}
                {lines.some((l) => !l.item.bank_id) && (
                  <section className="card stack">
                    <div className="page-head"><h2>No bank chosen</h2></div>
                    <Lines lines={lines.filter((l) => !l.item.bank_id)} meta={dueLabel} onToggle={togglePaid} onOpen={(l) => setPanel({ kind: "line", id: l.item.id })} empty="" />
                  </section>
                )}
                <p className="hint">Balances are the ones you typed in. Update a balance in Setup after checking your bank.</p>
              </>
            )}

            {tab === "setup" && <MoneySetup ctx={ctx} money={money} />}
          </div>
        </section>
        {panel && (
          <Panel title={panel.kind === "line" ? monthLabel(ym) : panelItem ? "Edit item" : "New item"} onClose={close}>
            {panel.kind === "line"
              ? panelLine ? <MoneyLineForm key={`${panelLine.item.id}-${ym}-${panelLine.paid}-${panelLine.skipped}-${panelLine.actual}-${panelLine.budget}`} ctx={ctx} money={money} line={panelLine} ym={ym} onEditItem={() => setPanel({ kind: "item", id: panelLine.item.id })} onDone={close} /> : <p className="muted">This item is not in {monthLabel(ym)}.</p>
              : <MoneyItemForm key={panel.id ?? `new-${panel.as}`} ctx={ctx} money={money} existing={panelItem} kind={panel.as} onDone={close} />}
          </Panel>
        )}
      </main>
    </>
  );
}

"use client";
import { useEffect, useMemo, useState } from "react";
import { DateTime } from "luxon";
import type { PlannerCtx } from "./usePlanner";
import type { MoneyCtx } from "./useMoney";
import Panel from "./Panel";
import MoneySetup from "./MoneySetup";
import { MoneyItemForm, MoneyLineForm } from "./MoneyItemForm";
import { bankPosition, expected, FREQ_LABELS, inr, monthLabel, monthLines, shiftMonth, totals, waitingOn, type Line, type MoneyKind, type Proposal } from "@/lib/money";
import { canAdd, isCurrent, type Circle } from "@/lib/circles";
import { todayISO } from "@/lib/time";

type Tab = "month" | "banks" | "setup";
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
function Lines({ lines, meta, onToggle, onOpen, empty, locked }: { lines: Line[]; meta: (l: Line) => string; onToggle: (l: Line) => void; onOpen: (l: Line) => void; empty: string; locked?: boolean }) {
  if (!lines.length) return <p className="empty card">{empty}</p>;
  return (
    <ul className="card task-list money-lines">
      {lines.map((l) => {
        const verb = l.item.kind === "expense" ? "paid" : "received";
        return (
          <li key={l.item.id} className={`task-row ${l.paid ? "is-done" : ""} ${l.skipped ? "is-skipped" : ""}`}>
            <button className={`task-check ${l.paid ? "is-checked" : ""}`} disabled={l.skipped || locked} aria-pressed={l.paid} aria-label={`${l.item.name}: ${l.paid ? `mark not ${verb}` : `mark ${verb}`}`} onClick={() => onToggle(l)}>{l.paid ? "✓" : ""}</button>
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

  const bankName = new Map(view.banks.map((b) => [b.id, b.name]));
  const typeName = new Map(view.types.map((t) => [t.id, t.name]));
  const meta = (l: Line) => [dueLabel(l), l.item.bank_id && bankName.get(l.item.bank_id), l.item.type_id && typeName.get(l.item.type_id)].filter(Boolean).join(" · ");
  const income = totals(lines, "income");
  const spend = totals(lines, "expense");
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
              {([["month", "Month"], ["banks", "Banks"], ["setup", "Setup"]] as const).map(([t, label]) => (
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
                <dl className="card money-sum">
                  <div><dt>Income</dt><dd>{inr(income.budget)}</dd><span>{inr(income.actual)} received</span></div>
                  <div><dt>Expenses</dt><dd>{inr(spend.budget)}</dd><span>{inr(spend.actual)} paid</span></div>
                  <div className={left < 0 ? "is-short" : ""}><dt>{left < 0 ? "Short by" : "Left over"}</dt><dd>{inr(Math.abs(left))}</dd><span>{left < 0 ? "Expenses are above income" : "After every planned expense"}</span></div>
                </dl>

                {isPlanned(ym) ? (
                  <p className="money-plan"><span className="status-badge">✓ Planned{scope ? " by everyone" : ""}</span> {canEdit && <button className="link" onClick={() => setPlanned(false)}>Reopen</button>}</p>
                ) : iMarked(ym) ? (
                  <p className="money-plan"><span className="muted">You marked {monthLabel(ym)} as planned. Waiting for {notYet.join(", ")}.</span> <button className="link" onClick={() => setPlanned(false)}>Undo</button></p>
                ) : ym > nowYm && canEdit ? (
                  <div className="money-plan">
                    <span className="muted grow">{scope ? `Check each line, then mark the month as planned. It is planned once everyone in ${scope.name} has.` : "Check each line, change this month’s amounts where needed, then mark the month as planned."}</span>
                    <button className="btn" disabled={!lines.length} onClick={() => setPlanned(true)}>Mark as planned</button>
                  </div>
                ) : ym === nowYm && !isPlanned(next) && view.items.length > 0 ? (
                  <p className="money-plan"><span className="muted">{monthLabel(next)} is not planned yet.</span> <button className="link" onClick={() => setPicked(next)}>Review it</button></p>
                ) : null}

                {scope && <Requests ctx={ctx} money={money} scope={scope} canEdit={canEdit} onAgain={(p) => setPanel({ kind: "item", id: p.item_id ?? undefined, again: p })} />}

                <div className="page-head"><h2>Expenses</h2>{canEdit && <button className="btn btn-sm" onClick={() => setPanel({ kind: "item", as: "expense" })}>＋ Expense</button>}</div>
                <Lines lines={lines.filter((l) => l.item.kind === "expense")} meta={meta} onToggle={togglePaid} onOpen={openLine} locked={!canEdit} empty={`No expenses in ${monthLabel(ym)}.`} />
                <div className="page-head"><h2>Income</h2>{canEdit && <button className="btn btn-sm" onClick={() => setPanel({ kind: "item", as: "income" })}>＋ Income</button>}</div>
                <Lines lines={lines.filter((l) => l.item.kind === "income")} meta={meta} onToggle={togglePaid} onOpen={openLine} locked={!canEdit} empty={`No income in ${monthLabel(ym)}.`} />
              </>
            )}

            {tab === "banks" && (
              <>
                {monthBar}
                {view.banks.every((b) => b.archived_at) && <p className="empty card">No banks yet. {canEdit && <button className="link" onClick={() => setTab("setup")}>Add one in Setup</button>}</p>}
                {view.banks.filter((b) => !b.archived_at).map((b) => {
                  const pos = bankPosition(b, lines);
                  const out = lines.filter((l) => l.item.bank_id === b.id && l.item.kind === "expense");
                  return (
                    <section key={b.id} className="card stack">
                      <div className="page-head"><h2>{b.name}</h2><span className="muted">{b.balance_at ? `Balance as of ${DateTime.fromISO(b.balance_at).toFormat("d LLL")}` : "Balance not set"}{scope ? `, kept by ${nameOf(scope, b.user_id ?? "", ctx.userId).replace("You", "you")}` : ""}</span></div>
                      <dl className="money-ledger">
                        <div><dt>Balance</dt><dd>{inr(Number(b.balance))}</dd></div>
                        <div><dt>Income still to come</dt><dd>+ {inr(pos.incomeDue)}</dd></div>
                        <div><dt>Expenses still to pay</dt><dd>− {inr(pos.expenseDue)}</dd></div>
                        <div className={`is-total ${pos.after < 0 ? "is-short" : ""}`}><dt>{pos.after < 0 ? "Short by" : `Left after ${monthLabel(ym)}`}</dt><dd>{inr(Math.abs(pos.after))}</dd></div>
                      </dl>
                      <Lines lines={out} meta={dueLabel} onToggle={togglePaid} onOpen={openLine} locked={!canEdit} empty={`No expenses from ${b.name} in ${monthLabel(ym)}.`} />
                    </section>
                  );
                })}
                {lines.some((l) => !l.item.bank_id) && (
                  <section className="card stack">
                    <div className="page-head"><h2>No bank chosen</h2></div>
                    <Lines lines={lines.filter((l) => !l.item.bank_id)} meta={dueLabel} onToggle={togglePaid} onOpen={openLine} locked={!canEdit} empty="" />
                  </section>
                )}
                <p className="hint">Balances are the ones typed in. {scope ? "Each bank’s balance is updated in Setup by the person who added it." : "Update a balance in Setup after checking your bank."}</p>
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

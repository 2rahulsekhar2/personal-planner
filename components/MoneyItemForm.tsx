"use client";
import { useEffect, useState } from "react";
import type { PlannerCtx } from "./usePlanner";
import type { MoneyCtx } from "./useMoney";
import Select from "./Select";
import { amountPeriods, FREQ_LABELS, inr, loanEmi, loanNow, type Loan, monthLabel, parseAmount, type Line, type MoneyFreq, type MoneyItem, type MoneyKind, type Proposal } from "@/lib/money";
import { isCurrent, type Circle } from "@/lib/circles";
import { todayISO } from "@/lib/time";
import { DateTime } from "luxon";

const NONE = { value: "", label: "None" };
// The picker's last choice: make a new bank or type without leaving the form.
const NEW = "__new";

/**
 * Add or change an income or expense: the rule for every month it falls in.
 * `money` holds the budget in view only. In a circle (`scope`) saving sends a request the other members approve.
 * `again` is a rejected request being changed and sent once more: the form starts from what was asked.
 */
export function MoneyItemForm({ ctx, money, scope, canEdit, existing, again, kind: startKind, onKind, onDone }: { ctx: PlannerCtx; money: MoneyCtx; scope: Circle | null; canEdit: boolean; existing?: MoneyItem; again?: Proposal; kind?: MoneyKind; onKind?: (kind: MoneyKind) => void; onDone: () => void }) {
  const { supabase, toast } = ctx;
  const from: Partial<MoneyItem> | undefined = again?.payload ?? existing;
  // Someone else has to agree: another current owner or member. In a circle of one, a request is carried out at once.
  const needsOthers = !!scope && scope.circle_members.some((m) => m.user_id !== ctx.userId && m.role !== "viewer" && isCurrent(m));
  const [kind, setKind] = useState<MoneyKind>(from?.kind ?? startKind ?? "expense");
  const [name, setName] = useState(from?.name ?? "");
  const [amount, setAmount] = useState(from?.amount != null ? String(from.amount) : "");
  // Later changes of the amount, each from a date on, as typed.
  const [steps, setSteps] = useState<{ from: string; amount: string }[]>(() => [...(from?.amount_steps ?? [])].sort((a, b) => a.from.localeCompare(b.from)).map((x) => ({ from: x.from, amount: String(x.amount) })));
  const [freq, setFreq] = useState<MoneyFreq>(from?.freq ?? "monthly");
  const [start, setStart] = useState(from?.start_date ?? todayISO(ctx.tz));
  const [end, setEnd] = useState(from?.end_date ?? "");
  const [bank, setBank] = useState(from?.bank_id ?? "");
  const [type, setType] = useState(from?.type_id ?? "");
  const [increase, setIncrease] = useState(from?.increase_id ?? "");
  const [people, setPeople] = useState<string[]>(from?.person_ids ?? []);
  const [notes, setNotes] = useState(from?.notes ?? "");
  // A loan: an expense paid every month that also knows what was borrowed. Its amount is the EMI.
  const [loanOn, setLoanOn] = useState(!!from?.loan);
  const [taken, setTaken] = useState(from?.loan ? String(from.loan.principal) : "");
  const [rate, setRate] = useState(from?.loan ? String(from.loan.rate) : "");
  const [loanKind, setLoanKind] = useState<Loan["kind"]>(from?.loan?.kind ?? "reducing");
  const [tenure, setTenure] = useState(from?.loan ? String(from.loan.months) : "");
  const [owed, setOwed] = useState(from?.loan?.balance != null ? String(from.loan.balance) : "");
  const [owedOn, setOwedOn] = useState(from?.loan?.balance_on ?? "");
  // Until an EMI is typed, the usual one for the loan is shown and saved.
  const [emiOwn, setEmiOwn] = useState(!!from?.loan);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A bank or a type being made on the spot, from its picker.
  const [adding, setAdding] = useState<{ what: "bank" | "type"; name: string; balance: string } | null>(null);
  // The panel's title follows the kind chosen here.
  useEffect(() => onKind?.(kind), [kind, onKind]);

  // Archived choices are not offered, except the one this item already uses. A bank and a type are required, so
  // there is no "None"; the last choice makes a new one.
  const offer = <T extends { id: string; name: string; archived_at: string | null }>(rows: T[], keep: string, what: string) =>
    [...rows.filter((r) => !r.archived_at || r.id === keep).map((r) => ({ value: r.id, label: r.name })), ...(canEdit ? [{ value: NEW, label: `＋ New ${what}` }] : [])];

  async function addNew() {
    if (!adding || saving) return;
    const label = adding.name.trim();
    if (!label) return setError(`Give the ${adding.what} a name.`);
    const balance = adding.balance.trim() ? parseAmount(adding.balance) : 0;
    if (balance === null) return setError("Enter the balance as a number.");
    setSaving(true);
    const own = scope ? { circle_id: scope.id } : {};
    const { data, error } = adding.what === "bank"
      ? await supabase.from("money_banks").insert({ name: label, balance, balance_at: todayISO(ctx.tz), ...own }).select("id").single()
      : await supabase.from("money_types").insert({ name: label, kind, ...own }).select("id").single();
    setSaving(false);
    if (error) return setError(`Couldn’t add the ${adding.what}: ${error.message}`);
    await money.reload();
    (adding.what === "bank" ? setBank : setType)((data as { id: string }).id);
    setAdding(null);
    setError(null);
    toast("ok", `${label} added`);
  }
  // The small form under a picker. Enter adds, and must not send the whole item form.
  const adder = (what: "bank" | "type") => adding?.what === what && (
    <div className="subform" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addNew(); } }}>
      <input value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} placeholder={what === "bank" ? "Bank name" : `${expense ? "Expense" : "Income"} type name`} aria-label={`New ${what} name`} autoFocus />
      {what === "bank" && <input value={adding.balance} onChange={(e) => setAdding({ ...adding, balance: e.target.value })} inputMode="decimal" placeholder="Current balance (optional)" aria-label="Current balance" />}
      <div className="row">
        <button type="button" className="btn btn-sm" disabled={saving} onClick={addNew}>Add {what}</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAdding(null)}>Cancel</button>
      </div>
    </div>
  );
  const family = money.people.filter((p) => !p.archived_at || people.includes(p.id));
  const expense = kind === "expense";
  const isLoan = loanOn && expense && money.loans;
  const loanText = { principal: parseAmount(taken), rate: rate.trim() ? Number(rate) : NaN, months: /^\d+$/.test(tenure.trim()) ? Number(tenure) : NaN };
  const loanOk = isLoan && loanText.principal !== null && loanText.principal > 0 && loanText.rate >= 0 && loanText.rate < 100 && loanText.months >= 1 && loanText.months <= 600;
  const owedValue = owed.trim() ? parseAmount(owed) : null;
  const loan: Loan | null = loanOk ? { principal: loanText.principal!, rate: loanText.rate, kind: loanKind, months: loanText.months, balance: owedValue !== null && owedOn ? owedValue : null, balance_on: owedValue !== null && owedOn ? owedOn : null } : null;
  const usual = loan ? loanEmi(loan) : null;
  const amountText = isLoan && !emiOwn && usual !== null ? String(usual) : amount;
  const value = parseAmount(amountText);
  // The stretches as they stand in the form, for saying "to 31 Mar 2026" beside each and marking the one in force today.
  const fmtDay = (iso: string) => DateTime.fromISO(iso).toFormat("d LLL yyyy");
  const periods = start ? amountPeriods({ amount: value ?? 0, start_date: start, end_date: end || null, amount_steps: steps.filter((x) => x.from > start).map((x) => ({ from: x.from, amount: parseAmount(x.amount) ?? 0 })) }) : [];
  const untilOf = (from: string) => { const p = periods.find((x) => x.from === from); return p?.to ? `, to ${fmtDay(p.to)}` : p ? ", onwards" : ""; };
  const todayIso = todayISO(ctx.tz);
  // Which row is in force today: 0 is the first amount, n + 1 the nth change as listed.
  const nowFrom = [...periods].reverse().find((p) => p.from <= todayIso)?.from;
  const nowAt = nowFrom === undefined ? -1 : nowFrom === start ? 0 : steps.findIndex((x) => x.from === nowFrom) + 1;

  // Where the loan stands, as the form reads now.
  const stands = loan && value !== null && start
    ? loanNow({ amount: value, start_date: start, amount_steps: steps.flatMap((x) => { const a = parseAmount(x.amount); return x.from > start && a !== null ? [{ from: x.from, amount: a }] : []; }), loan }, Number(money.increases.find((i) => i.id === increase)?.percent ?? 0), todayIso)
    : null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (!name.trim()) return setError("Give it a name.");
    if (value === null) return setError("Enter the amount as a number, for example 1499.");
    if (!start) return setError("Choose a date.");
    if (!bank) return setError(`Choose the bank it ${expense ? "is paid from" : "comes into"}.`);
    if (!type) return setError(`Choose ${expense ? "an expense" : "an income"} type.`);
    if (freq !== "once" && end && end < start) return setError("The last date is before the first.");
    if (isLoan) {
      if (loanText.principal === null || loanText.principal <= 0) return setError("Enter the amount taken as a number, for example 500000.");
      if (!(loanText.rate >= 0 && loanText.rate < 100)) return setError("Enter the interest for a year as a percentage, for example 9.5. Use 0 for none.");
      if (!(loanText.months >= 1 && loanText.months <= 600)) return setError("Enter the tenure as a number of months, for example 60.");
      if (owed.trim() && owedValue === null) return setError("Enter the balance as a number.");
      if (!!owed.trim() !== !!owedOn) return setError("Give the lender’s balance both a figure and a date, or leave both empty.");
      if (value <= 0) return setError("Enter the EMI as a number.");
    }
    // A one-time item has one amount. Otherwise each change needs a date after the first date, its own day, and a figure.
    const changes = freq === "once" ? [] : steps.map((x) => ({ from: x.from, amount: parseAmount(x.amount) }));
    if (changes.some((x) => !x.from || x.amount === null)) return setError("Give each change of amount a date and a figure, or remove it.");
    if (changes.some((x) => x.from <= start)) return setError("A change of amount must start after the first date. To change the first amount, edit it directly.");
    if (end && changes.some((x) => x.from > end)) return setError("A change of amount starts after the last date.");
    if (new Set(changes.map((x) => x.from)).size !== changes.length) return setError("Two changes of amount start on the same day.");
    changes.sort((a, b) => a.from.localeCompare(b.from));
    setSaving(true);
    const row = {
      kind, name: name.trim(), amount: value, freq, start_date: start, end_date: freq === "once" ? null : end || null,
      bank_id: bank || null, type_id: type || null, increase_id: freq === "once" ? null : increase || null, person_ids: people, notes: notes.trim() || null,
      // Sent only when the database has the column (0020).
      ...(money.steps ? { amount_steps: changes } : {}),
      // Likewise (0021). Cleared when the item is no longer a loan.
      ...(money.loans ? { loan: isLoan ? loan : null } : {}),
    };
    const result = scope ? await ask(existing ? "change" : "add", row) : existing ? await supabase.from("money_items").update(row).eq("id", existing.id) : await supabase.from("money_items").insert(row);
    setSaving(false);
    if (result.error) return setError(`Couldn’t save: ${result.error.message}`);
    await money.reload();
    toast("ok", result.data === "pending" ? `Sent to ${scope!.name} for approval` : existing ? `${row.name} updated` : `${row.name} added`);
    onDone();
  }

  // In a circle: a request, carried out at once when nobody else has to agree. A request it replaces is withdrawn.
  async function ask(action: Proposal["action"], payload: object) {
    const res = await supabase.rpc("money_propose", { p_circle: scope!.id, p_action: action, p_item: existing?.id ?? null, p_payload: payload });
    if (!res.error && again) await supabase.rpc("money_withdraw", { p_proposal: again.id });
    return res;
  }

  async function remove() {
    if (!existing) return;
    setSaving(true);
    const result = scope ? await ask("delete", {}) : await supabase.from("money_items").delete().eq("id", existing.id);
    setSaving(false);
    if (result.error) return setError(`Couldn’t delete: ${result.error.message}`);
    await money.reload();
    toast("ok", result.data === "pending" ? `Sent to ${scope!.name} for approval` : `${existing.name} deleted`);
    onDone();
  }

  return (
    <form className="form" onSubmit={save} noValidate>
      {scope && <p className="hint" style={{ margin: 0 }}>{canEdit ? `Shared with ${scope.name}.${needsOthers ? " Adding, changing or deleting it takes effect once every other member approves." : ""}` : `Shared with ${scope.name}. You are a viewer, so you cannot change it.`}</p>}
      {again?.reason && <div className="alert alert-warn">Rejected: {again.reason}</div>}
      <fieldset disabled={!canEdit} className="form" style={{ border: 0, padding: 0, margin: 0 }}>
      <div className="segmented" role="group" aria-label="Kind">
        {(["expense", "income"] as const).map((k) => (
          <button type="button" key={k} className={kind === k ? "is-active" : ""} aria-pressed={kind === k} onClick={() => { setKind(k); setType(""); setAdding(null); }}>{k === "expense" ? "Expense item" : "Income item"}</button>
        ))}
      </div>
      {expense && money.loans && (
        <div className="segmented" role="group" aria-label="Sort of expense">
          <button type="button" className={!loanOn ? "is-active" : ""} aria-pressed={!loanOn} onClick={() => setLoanOn(false)}>Plain</button>
          <button type="button" className={loanOn ? "is-active" : ""} aria-pressed={loanOn} onClick={() => { setLoanOn(true); setFreq("monthly"); setEnd(""); }}>Loan</button>
        </div>
      )}
      <label className="field"><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder={isLoan ? "Home loan" : expense ? "Wifi bill" : "Salary"} autoFocus={!existing} /></label>
      {isLoan && (
        <>
          <div className="field-row">
            <label className="field"><span>Amount taken</span><input value={taken} onChange={(e) => setTaken(e.target.value)} inputMode="decimal" placeholder="₹" aria-invalid={!!taken && loanText.principal === null} /></label>
            <label className="field"><span>Interest a year</span><input value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" placeholder="%" /></label>
          </div>
          <div className="field-row">
            <label className="field"><span>Tenure <span className="muted">(months)</span></span><input value={tenure} onChange={(e) => setTenure(e.target.value)} inputMode="numeric" placeholder="60" /></label>
            <div className="field">
              <span>Interest on</span>
              <Select id="money-loan-kind" value={loanKind} options={[{ value: "reducing", label: "Reducing balance" }, { value: "flat", label: "Flat" }]} onChange={(v) => setLoanKind(v as Loan["kind"])} />
            </div>
          </div>
        </>
      )}
      {!isLoan && <label className="field"><span>Repeats</span><Select id="money-freq" value={freq} options={Object.entries(FREQ_LABELS).map(([v, label]) => ({ value: v, label }))} onChange={(v) => setFreq(v as MoneyFreq)} /></label>}
      <div className="field-row">
        <label className="field"><span>{isLoan ? "First EMI date" : freq === "once" ? "Date" : "First date"}</span><input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
        {freq !== "once" && !isLoan && <label className="field"><span>Last date <span className="muted">(optional)</span></span><input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} /></label>}
      </div>
      {/* The amount, and how it changes over time: a row for each stretch, the first from the first date. */}
      <fieldset className="field">
        <legend>{isLoan ? "EMI" : "Budget amount"}{freq !== "once" && <span className="muted"> ({isLoan ? "each month" : "each time"})</span>}</legend>
        <div className="amt-steps">
          <div className={`amt-step ${periods.length > 1 && nowAt === 0 ? "is-now" : ""}`}>
            <input value={amountText} onChange={(e) => { setAmount(e.target.value); setEmiOwn(true); }} inputMode="decimal" placeholder="₹" aria-label={freq === "once" || !steps.length ? (isLoan ? "EMI" : "Budget amount") : "Amount from the first date"} aria-invalid={!!amount && value === null} />
            {freq !== "once" && steps.length > 0 && <span className="amt-when">from {fmtDay(start)}{periods[0]?.to ? `, to ${fmtDay(periods[0].to)}` : ""}</span>}
          </div>
          {freq !== "once" && steps.map((x, n) => (
            <div key={n} className={`amt-step ${nowAt === n + 1 ? "is-now" : ""}`}>
              <input value={x.amount} onChange={(e) => setSteps(steps.map((y, m) => (m === n ? { ...y, amount: e.target.value } : y)))} inputMode="decimal" placeholder="₹" aria-label={`Amount from change ${n + 1}`} aria-invalid={!!x.amount && parseAmount(x.amount) === null} />
              <span className="amt-when">
                from <input type="date" className="input-inline" value={x.from} min={start} max={end || undefined} aria-label={`Change ${n + 1} starts on`} onChange={(e) => setSteps(steps.map((y, m) => (m === n ? { ...y, from: e.target.value } : y)))} />
                {x.from && untilOf(x.from)}
              </span>
              <button type="button" className="icon-btn" aria-label={`Remove change ${n + 1}`} title="Remove" onClick={() => setSteps(steps.filter((_, m) => m !== n))}>✕</button>
            </div>
          ))}
        </div>
        {freq !== "once" && money.steps && (
          <button type="button" className="chip chip-dashed amt-add" onClick={() => setSteps([...steps, { from: "", amount: "" }])}>＋ Change the amount from a date</button>
        )}
        {isLoan && emiOwn && usual !== null && value !== usual && <button type="button" className="chip chip-dashed amt-add" onClick={() => setEmiOwn(false)}>Use the usual EMI, {inr(usual)}</button>}
        <span className="hint">{isLoan ? (emiOwn ? "Each payment covers the month’s interest first; the rest comes off what is owed." : "Worked out from the loan. Type over it to use your lender’s figure.") : steps.length && freq !== "once" ? "Each amount holds until the next one starts." : `What you plan for. What you really ${expense ? "pay" : "receive"} is recorded month by month.`}</span>
      </fieldset>
      {isLoan && (
        <>
          {stands && (
            <dl className="loan-facts" aria-live="polite">
              <div><dt>Owed today</dt><dd>{inr(stands.balance)}</dd></div>
              <div><dt>Interest in all</dt><dd>{stands.endless ? "—" : inr(stands.interest)}</dd></div>
              <div><dt>Ends</dt><dd>{stands.endless || !stands.ends ? "never" : DateTime.fromISO(stands.ends).toFormat("LLL yyyy")}</dd></div>
            </dl>
          )}
          {stands?.endless && <div className="alert alert-warn">This EMI does not cover the month’s interest, so the loan never ends. Raise the EMI.</div>}
          <fieldset className="field">
            <legend>Lender’s balance <span className="muted">(optional)</span></legend>
            <div className="field-row">
              <input value={owed} onChange={(e) => setOwed(e.target.value)} inputMode="decimal" placeholder="₹ still owed" aria-label="Balance the lender shows" />
              <input type="date" value={owedOn} max={todayIso} onChange={(e) => setOwedOn(e.target.value)} aria-label="Date of that balance" />
            </div>
            <span className="hint">If your statement shows a different balance, enter it with its date. The sums carry on from there.</span>
          </fieldset>
        </>
      )}
      <div className="field">
        <span>Bank</span>
        <Select id="money-bank" value={bank} options={offer(money.banks, bank, "bank")} onChange={(v) => (v === NEW ? setAdding({ what: "bank", name: "", balance: "" }) : setBank(v))} />
        {adder("bank")}
      </div>
      <div className="field">
        <span>{expense ? "Expense type" : "Income type"}</span>
        <Select id="money-type" value={type} options={offer(money.types.filter((t) => t.kind === kind), type, "type")} onChange={(v) => (v === NEW ? setAdding({ what: "type", name: "", balance: "" }) : setType(v))} />
        {adder("type")}
      </div>
      {freq !== "once" && (
        <label className="field">
          <span>Yearly increase</span>
          <Select id="money-increase" value={increase} options={[NONE, ...money.increases.filter((i) => !i.archived_at || i.id === increase).map((i) => ({ value: i.id, label: `${i.name} (${Number(i.percent)}%)` }))]} onChange={setIncrease} />
          {increase && <span className="hint">The budget rises by this much on each anniversary of the first date.</span>}
        </label>
      )}
      {family.length > 0 && (
        <fieldset className="field">
          <legend>{expense ? "Incurred for" : "Received by"}</legend>
          <div className="chips chips-xs" style={{ marginTop: 0 }}>
            {family.map((p) => {
              const on = people.includes(p.id);
              return <button type="button" key={p.id} className={`chip ${on ? "is-selected" : ""}`} aria-pressed={on} onClick={() => setPeople(on ? people.filter((x) => x !== p.id) : [...people, p.id])}>{p.name}</button>;
            })}
          </div>
          {people.length > 1 && value !== null && <span className="hint">Split equally: {inr(Math.round((value / people.length) * 100) / 100)} each.</span>}
        </fieldset>
      )}
      <label className="field"><span>Notes <span className="muted">(optional)</span></span><textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      </fieldset>

      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {confirm && (
        <div className="confirm-box">
          <p>Delete {existing?.name} from every month, past and future? To stop it from now on, set a last date instead.</p>
          <div className="row">
            <button type="button" className="btn btn-danger" disabled={saving} onClick={remove}>Delete it</button>
            <button type="button" className="btn btn-ghost" onClick={() => setConfirm(false)}>Keep</button>
          </div>
        </div>
      )}
      {canEdit && (
        <div className="form-actions">
          <button className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : needsOthers ? "Send for approval" : existing ? "Save changes" : `Add ${kind}`}</button>
          {existing && !again && !confirm && <button type="button" className="btn btn-ghost btn-danger" onClick={() => setConfirm(true)}>Delete</button>}
        </div>
      )}
    </form>
  );
}

/** One month of one item: its budget for that month alone, what was really paid, and whether to skip it. */
export function MoneyLineForm({ ctx, money, line, ym, shared, canEdit, onEditItem, onDone }: { ctx: PlannerCtx; money: MoneyCtx; line: Line; ym: string; shared: boolean; canEdit: boolean; onEditItem: () => void; onDone: () => void }) {
  const [budget, setBudget] = useState(String(line.budget));
  const [actual, setActual] = useState(line.actual === null ? "" : String(line.actual));
  const [paid, setPaid] = useState(line.paid);
  const [skipped, setSkipped] = useState(line.skipped);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const expense = line.item.kind === "expense";

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const b = parseAmount(budget);
    const a = actual.trim() ? parseAmount(actual) : null;
    if (b === null || (actual.trim() && a === null)) return setError("Enter amounts as numbers, for example 1499.");
    setSaving(true);
    const { error } = await ctx.supabase.from("money_entries").upsert({
      // On a shared item the month's own budget and "skip" would change the agreed plan: they are left alone.
      item_id: line.item.id, month: `${ym}-01`, actual: a, ...(shared ? {} : { budget: b === line.rule ? null : b, skipped }),
      paid_at: paid ? (line.paid ? undefined : new Date().toISOString()) : null,
    });
    setSaving(false);
    if (error) return setError(`Couldn’t save: ${error.message}`);
    await money.reload();
    ctx.toast("ok", `${line.item.name} saved for ${monthLabel(ym)}`);
    onDone();
  }

  return (
    <form className="form" onSubmit={save} noValidate>
      <p className="muted" style={{ margin: 0 }}>{line.item.name} in {monthLabel(ym)}. Changes here stay in this month.</p>
      <label className="field">
        <span>Budget this month</span>
        <input value={budget} onChange={(e) => setBudget(e.target.value)} inputMode="decimal" autoFocus={!shared} disabled={shared} />
        {shared
          ? <span className="hint">The budget of a shared item is agreed by the circle. To change it, edit the item and send it for approval.</span>
          : parseAmount(budget) !== line.rule && <span className="hint">Usually {inr(line.rule)}. <button type="button" className="link" onClick={() => setBudget(String(line.rule))}>Use that</button></span>}
      </label>
      <label className="field">
        <span>Actual amount <span className="muted">(optional)</span></span>
        <input value={actual} onChange={(e) => setActual(e.target.value)} inputMode="decimal" placeholder={`What you really ${expense ? "paid" : "received"}`} />
      </label>
      <label className="check"><input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} /> {expense ? "Paid" : "Received"}</label>
      {!shared && <label className="check"><input type="checkbox" checked={skipped} onChange={(e) => setSkipped(e.target.checked)} /> Skip this month</label>}
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      <div className="form-actions">
        {canEdit && <button className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "Save this month"}</button>}
        <button type="button" className="btn btn-ghost" onClick={onEditItem}>{canEdit ? "Edit every month" : "See the item"}</button>
      </div>
    </form>
  );
}

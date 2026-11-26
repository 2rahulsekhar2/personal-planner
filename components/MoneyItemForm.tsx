"use client";
import { useEffect, useState } from "react";
import type { PlannerCtx } from "./usePlanner";
import type { MoneyCtx } from "./useMoney";
import { Named, Step } from "./FormBits";
import { TONES } from "./MoneySetup";
import { amountPeriods, oneAName, evalFormula, formulaLoops, FREQ_LABELS, inr, loanEmi, loanNow, loanSchedule, monthLines, withParts, type FormulaToken, type Loan, monthLabel, parseAmount, type Line, type MoneyFreq, type MoneyItem, type MoneyKind, type Proposal } from "@/lib/money";
import { isCurrent, type Circle } from "@/lib/circles";
import { todayISO } from "@/lib/time";
import { DateTime } from "luxon";

const FREQ_MARK: Record<MoneyFreq, string> = { once: "1", daily: "D", weekly: "W", monthly: "M", yearly: "Y" };
const ARROW = { income: "M12 5v14M6 13l6 6 6-6", expense: "M12 19V5M6 11l6-6 6 6" };

/**
 * Add or change an income or expense: the rule for every month it falls in.
 * `money` holds the budget in view only. In a circle (`scope`) saving sends a request the other members approve.
 * `again` is a rejected request being changed and sent once more: the form starts from what was asked.
 * `date`: the first date a new item starts with, when it was asked for from a month.
 */
export function MoneyItemForm({ ctx, money, scope, canEdit, existing, again, kind: startKind, date, onKind, onDone }: { ctx: PlannerCtx; money: MoneyCtx; scope: Circle | null; canEdit: boolean; existing?: MoneyItem; again?: Proposal; kind?: MoneyKind; date?: string; onKind?: (kind: MoneyKind) => void; onDone: () => void }) {
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
  const [start, setStart] = useState(from?.start_date ?? date ?? todayISO(ctx.tz));
  const [end, setEnd] = useState(from?.end_date ?? "");
  const [bank, setBank] = useState(from?.bank_id ?? "");
  const [type, setType] = useState(from?.type_id ?? "");
  const [increase, setIncrease] = useState(from?.increase_id ?? "");
  const [people, setPeople] = useState<string[]>(from?.person_ids ?? []);
  const [notes, setNotes] = useState(from?.notes ?? "");
  // A loan: an expense paid every month that also knows what was borrowed. Its amount is the EMI.
  const [loanOn, setLoanOn] = useState(!!from?.loan && !from?.formula);
  // Computed: worked out each month from other items by a formula, built piece by piece.
  const [computedOn, setComputedOn] = useState(!!from?.formula);
  const [tokens, setTokens] = useState<FormulaToken[]>(from?.formula ?? []);
  const [figure, setFigure] = useState(""); // a number being typed for the formula
  const [find, setFind] = useState(""); // narrows the items offered for the formula
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
  // Closing: the last date being chosen, today to begin with. null while not closing.
  const [closeOn, setCloseOn] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A bank or a type being made on the spot, from its picker.
  const [adding, setAdding] = useState<{ what: "bank" | "type"; name: string; balance: string } | null>(null);
  // The panel's title follows the kind chosen here.
  useEffect(() => onKind?.(kind), [kind, onKind]);

  // Archived choices are not offered, except the one this item already uses. Colours as everywhere else in Money.
  const bankTone = new Map(money.banks.map((b, n) => [b.id, TONES[n % TONES.length]]));
  const typeTone = new Map([...money.types].sort((a, b) => a.kind.localeCompare(b.kind)).map((t, n) => [t.id, TONES[n % TONES.length]]));
  const personTone = new Map(money.people.map((x, n) => [x.id, TONES[n % TONES.length]]));

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
  const isComputed = computedOn && money.formulas;
  const isLoan = loanOn && !isComputed && expense && money.loans;
  const loanText = { principal: parseAmount(taken), rate: rate.trim() ? Number(rate) : NaN, months: /^\d+$/.test(tenure.trim()) ? Number(tenure) : NaN };
  const loanOk = isLoan && loanText.principal !== null && loanText.principal > 0 && loanText.rate >= 0 && loanText.rate < 100 && loanText.months >= 1 && loanText.months <= 600;
  const owedValue = owed.trim() ? parseAmount(owed) : null;
  const loan: Loan | null = loanOk ? { principal: loanText.principal!, rate: loanText.rate, kind: loanKind, months: loanText.months, balance: owedValue !== null && owedOn ? owedValue : null, balance_on: owedValue !== null && owedOn ? owedOn : null } : null;
  const usual = loan ? loanEmi(loan) : null;
  const amountText = isLoan && !emiOwn && usual !== null ? String(usual) : amount;
  const value = isComputed ? 0 : parseAmount(amountText); // a computed item has no amount of its own
  // The stretches as they stand in the form, for saying "to 31 Mar 2026" beside each and marking the one in force today.
  const fmtDay = (iso: string) => DateTime.fromISO(iso).toFormat("d LLL yyyy");
  const periods = start ? amountPeriods({ amount: value ?? 0, start_date: start, end_date: end || null, amount_steps: steps.filter((x) => x.from > start).map((x) => ({ from: x.from, amount: parseAmount(x.amount) ?? 0 })) }) : [];
  const untilOf = (from: string) => { const p = periods.find((x) => x.from === from); return p?.to ? `to ${fmtDay(p.to)}` : ""; };
  const todayIso = todayISO(ctx.tz);
  // Which row is in force today: 0 is the first amount, n + 1 the nth change as listed.
  const nowFrom = [...periods].reverse().find((p) => p.from <= todayIso)?.from;
  const nowAt = nowFrom === undefined ? -1 : nowFrom === start ? 0 : steps.findIndex((x) => x.from === nowFrom) + 1;

  // Where the loan stands, as the form reads now.
  const lent = loan && value !== null && start ? { amount: value, start_date: start, end_date: end || null, amount_steps: steps.flatMap((x) => { const a = parseAmount(x.amount); return x.from > start && a !== null ? [{ from: x.from, amount: a }] : []; }), loan } : null;
  const lentPct = Number(money.increases.find((i) => i.id === increase)?.percent ?? 0);
  const stands = lent ? loanNow(lent, lentPct, todayIso) : null;
  // What is owed, payment by payment, as a line falling to nothing; `at` is where today sits along it.
  const curve = (() => {
    if (!lent || !stands || stands.endless) return null;
    const rows = loanSchedule(lent, lentPct);
    if (rows.length < 2) return null;
    const owedAt = [Number(lent.loan.principal), ...rows.map((r) => r.balance)];
    const top = Math.max(...owedAt, 1);
    const pts = owedAt.map((b, n) => `${((n / (owedAt.length - 1)) * 100).toFixed(2)},${(31 - (b / top) * 29).toFixed(2)}`);
    return { line: pts.join(" "), area: `0,32 ${pts.join(" ")} 100,32`, at: (rows.filter((r) => r.date <= todayIso).length / (owedAt.length - 1)) * 100 };
  })();

  // The formula: what it comes to this month as it stands, and which items may go into it.
  const selfId = existing?.id ?? "__new";
  const nameOf = new Map(money.items.map((i) => [i.id, i.name]));
  // An item whose own formula leads back here would make a loop, so it is not offered.
  const usable = isComputed ? money.items.filter((i) => i.id !== selfId && !formulaLoops(selfId, [{ t: "item", id: i.id }], money.items)) : [];
  // Offered one a name, narrowed by what is typed, and never more than a screenful at once.
  const named = oneAName(usable, todayIso.slice(0, 7)).sort((a, b) => a.name.localeCompare(b.name));
  const offered = named.filter((i) => i.name.toLowerCase().includes(find.trim().toLowerCase()));
  const MOST = 24;
  const formulaOk = !evalFormula(tokens, () => 1).error;
  const trial = isComputed && tokens.length
    ? withParts(monthLines([...money.items.filter((i) => i.id !== selfId), { id: selfId, kind, name, amount: 0, freq: "monthly", start_date: `${todayIso.slice(0, 7)}-01`, end_date: null, bank_id: null, type_id: null, increase_id: null, person_ids: [], notes: null, formula: tokens }], money.entries, money.increases, todayIso.slice(0, 7))).find((l) => l.item.id === selfId)
    : undefined;
  const put = (t: FormulaToken) => { setTokens([...tokens, t]); setError(null); };
  const putFigure = (pct: boolean) => {
    const n = Number(figure.replace(/[₹,%\s]/g, ""));
    if (!figure.trim() || !Number.isFinite(n) || n < 0) return setError("Type a number first, for example 2000 or 12.5.");
    put(pct ? { t: "pct", v: n } : { t: "num", v: n });
    setFigure("");
  };
  const SIGNS = { "+": "+", "-": "−", "*": "×", "/": "÷", "(": "(", ")": ")" } as const;
  const said = (t: FormulaToken) => (t.t === "item" ? nameOf.get(t.id) ?? "a deleted item" : t.t === "num" ? String(t.v) : t.t === "pct" ? `${t.v}%` : SIGNS[t.v]);

  // `closing`: save with this as the last date, and without changes of amount that start after it.
  async function save(e?: React.FormEvent, closing?: string) {
    e?.preventDefault();
    if (saving) return;
    const last = closing ?? end;
    if (!name.trim()) return setError("Give it a name.");
    if (isComputed) {
      if (!tokens.length) return setError("Build the formula: press an item or type a number, then a sign, and so on.");
      if (!formulaOk) return setError("The formula is not complete. Check for a sign with nothing after it, or a bracket left open.");
      if (formulaLoops(selfId, tokens, money.items)) return setError("The formula uses an item that is itself worked out from this one.");
    }
    // A loan's own figures first: the EMI is worked out from them.
    if (isLoan) {
      if (loanText.principal === null || loanText.principal <= 0) return setError("Enter the amount taken as a number, for example 500000.");
      if (!(loanText.rate >= 0 && loanText.rate < 100)) return setError("Enter the interest for a year as a percentage, for example 9.5. Use 0 for none.");
      if (!(loanText.months >= 1 && loanText.months <= 600)) return setError("Enter the tenure as a number of months, for example 60.");
      if (owed.trim() && owedValue === null) return setError("Enter the balance as a number.");
      if (!!owed.trim() !== !!owedOn) return setError("Give the lender’s balance both a figure and a date, or leave both empty.");
    }
    if (value === null || (isLoan && value <= 0)) return setError("Enter the amount as a number, for example 1499.");
    if (!start) return setError("Choose a date.");
    if (!bank) return setError(`Choose the bank it ${expense ? "is paid from" : "comes into"}.`);
    if (!type) return setError(`Choose ${expense ? "an expense" : "an income"} type.`);
    if (freq !== "once" && last && last < start) return setError("The last date is before the first.");
    // A one-time item has one amount. Otherwise each change needs a date after the first date, its own day, and a figure.
    const changes = freq === "once" || isComputed ? [] : steps.filter((x) => !closing || x.from <= closing).map((x) => ({ from: x.from, amount: parseAmount(x.amount) }));
    if (changes.some((x) => !x.from || x.amount === null)) return setError("Give each change of amount a date and a figure, or remove it.");
    if (changes.some((x) => x.from <= start)) return setError("A change of amount must start after the first date. To change the first amount, edit it directly.");
    if (last && changes.some((x) => x.from > last)) return setError("A change of amount starts after the last date.");
    if (new Set(changes.map((x) => x.from)).size !== changes.length) return setError("Two changes of amount start on the same day.");
    changes.sort((a, b) => a.from.localeCompare(b.from));
    setSaving(true);
    const row = {
      kind, name: name.trim(), amount: value, freq, start_date: start, end_date: freq === "once" ? null : last || null,
      bank_id: bank || null, type_id: type || null, increase_id: freq === "once" || isComputed ? null : increase || null, person_ids: people, notes: notes.trim() || null,
      // Sent only when the database has the column (0020).
      ...(money.steps ? { amount_steps: changes } : {}),
      // Likewise (0021). Cleared when the item is no longer a loan.
      ...(money.loans ? { loan: isLoan ? loan : null } : {}),
      // Likewise (0022). shortcut: only items of the budget in view are offered, but the database does not check it; validate in money_propose if formulas are ever written outside this form
      ...(money.formulas ? { formula: isComputed ? tokens : null } : {}),
    };
    const result = scope ? await ask(existing ? "change" : "add", row) : existing ? await supabase.from("money_items").update(row).eq("id", existing.id) : await supabase.from("money_items").insert(row);
    setSaving(false);
    if (result.error) return setError(`Couldn’t save: ${result.error.message}`);
    await money.reload();
    toast("ok", result.data === "pending" ? `Sent to ${scope!.name} for approval` : closing ? `${row.name} closed from ${fmtDay(closing)}` : existing ? `${row.name} updated` : `${row.name} added`);
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
      <div className="segmented kind-switch" role="group" aria-label="Kind">
        {(["expense", "income"] as const).map((k) => (
          <button type="button" key={k} className={`${k === "income" ? "is-in" : "is-out"} ${kind === k ? "is-active" : ""}`} aria-pressed={kind === k} onClick={() => { setKind(k); setType(""); setAdding(null); }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={ARROW[k]} /></svg>
            {k === "expense" ? "Expense item" : "Income item"}
          </button>
        ))}
      </div>
      {((expense && money.loans) || money.formulas) && (
        <div className="chips sort-switch" role="group" aria-label={`Sort of ${expense ? "expense" : "income"}`}>
          <button type="button" className={`chip chip-sm ${!isLoan && !isComputed ? "is-selected" : ""}`} aria-pressed={!isLoan && !isComputed} onClick={() => { setLoanOn(false); setComputedOn(false); }}><span className="sort-mark" aria-hidden>●</span>Plain</button>
          {expense && money.loans && (
            <button type="button" className={`chip chip-sm ${isLoan ? "is-selected" : ""}`} aria-pressed={isLoan} onClick={() => { setLoanOn(true); setComputedOn(false); setFreq("monthly"); setEnd(""); }}>
              <svg className="sort-mark" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden><circle cx="8" cy="8" r="5.500" opacity=".35" /><path d="M8 2.500a5.500 5.500 0 0 1 5.500 5.500" strokeLinecap="round" /></svg>Loan
            </button>
          )}
          {money.formulas && <button type="button" className={`chip chip-sm ${isComputed ? "is-selected" : ""}`} aria-pressed={isComputed} onClick={() => { setComputedOn(true); setLoanOn(false); }}><span className="sort-mark is-sum" aria-hidden>ƒ</span>Computed</button>}
        </div>
      )}
      {/* The same stops as an appointment, with one of its own: how much. What sort of item it is stays above them,
          since it chooses the form. A stop's mark fills, in the type's colour, once it is answered. */}
      <div className={`steps act-${typeTone.get(type) ?? "slate"}`}>
        <Step icon="tag" name="What" set={!!name.trim() && !!type}>
          <input className="input-lead" value={name} onChange={(e) => setName(e.target.value)} placeholder={isLoan ? "Home loan" : expense ? "Wifi bill" : "Salary"} aria-label="Name" autoFocus={!existing} />
          <div role="group" aria-label={expense ? "Expense type" : "Income type"}>
            <div className="chips chips-xs" id="money-type" style={{ marginTop: 0 }}>
              {money.types.filter((t) => t.kind === kind && (!t.archived_at || t.id === type)).map((t) => {
                const tone = typeTone.get(t.id);
                return <button type="button" key={t.id} className={`chip act-${tone} ${type === t.id ? "is-selected" : ""}`} aria-pressed={type === t.id} onClick={() => setType(t.id)}><span className={`kit-mono is-mini act-${tone}`} aria-hidden>{t.name.trim()[0]?.toUpperCase()}</span>{t.name}</button>;
              })}
              {canEdit && <button type="button" className="chip chip-dashed" aria-label="New type" title="New type" aria-expanded={adding?.what === "type"} onClick={() => setAdding({ what: "type", name: "", balance: "" })}>＋</button>}
            </div>
            {adder("type")}
          </div>
        </Step>

        <Step icon="clock" name="When" set={!!start}>
          {!isLoan && (
            <div role="group" aria-label="Repeats">
              <div className="chips chips-xs" id="money-freq" style={{ marginTop: 0 }}>
                {(Object.keys(FREQ_LABELS) as MoneyFreq[]).map((v) => (
                  <button type="button" key={v} className={`chip ${freq === v ? "is-selected" : ""}`} aria-pressed={freq === v} onClick={() => setFreq(v)}><span className="freq-mark" aria-hidden>{FREQ_MARK[v]}</span>{FREQ_LABELS[v]}</button>
                ))}
              </div>
            </div>
          )}
          <div className="field-row">
            <label className="field"><span><Named icon="clock">{isLoan ? "First EMI date" : freq === "once" ? "Date" : "First date"}</Named></span><input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
            {freq !== "once" && (!isLoan || end) && <label className="field"><span>Last date <span className="muted">(optional)</span></span><input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} /></label>}
          </div>
        </Step>

        <Step icon="coin" name="How much" set={isComputed ? tokens.length > 0 && formulaOk : value !== null}>
          <div className="stack">
            {isLoan && (
              <>
                <div className="field-row">
                  <label className="field"><span>Amount taken</span><input value={taken} onChange={(e) => setTaken(e.target.value)} inputMode="decimal" placeholder="₹" aria-invalid={!!taken && loanText.principal === null} /></label>
                  <label className="field"><span>Interest a year</span><input value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" placeholder="%" /></label>
                </div>
                <div className="field-row">
                  <label className="field"><span>Tenure <span className="muted">(months)</span></span><input value={tenure} onChange={(e) => setTenure(e.target.value)} inputMode="numeric" placeholder="60" /></label>
                  <fieldset className="field">
                    <legend>Interest on</legend>
                    <div className="chips chips-xs" id="money-loan-kind" style={{ marginTop: 0 }}>
                      {([["reducing", "Reducing balance", "M2 3c4 0 6 9 12 10"], ["flat", "Flat", "M2 3l12 10"]] as const).map(([v, label, d]) => (
                        <button type="button" key={v} className={`chip ${loanKind === v ? "is-selected" : ""}`} aria-pressed={loanKind === v} onClick={() => setLoanKind(v)}>
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d={d} /></svg>{label}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                </div>
              </>
            )}
            {isComputed && (
              <fieldset className="field">
                <legend><Named icon="sum">Formula</Named></legend>
                {/* The sum as built so far, read left to right. */}
                <div className={`formula ${tokens.length && !formulaOk ? "is-open" : ""}`} role="group" aria-label="The formula so far">
                  {tokens.length === 0 ? <span className="muted">Press an item or type a number, then a sign.</span> : tokens.map((t, n) => <span key={n} className={t.t === "item" ? "formula-item" : t.t === "op" ? "formula-sign" : "formula-num"}>{said(t)}</span>)}
                </div>
                <div className="formula-keys">
                  {(["+", "-", "*", "/", "(", ")"] as const).map((v) => <button type="button" key={v} className="btn btn-sm" aria-label={{ "+": "Plus", "-": "Minus", "*": "Times", "/": "Divided by", "(": "Open bracket", ")": "Close bracket" }[v]} onClick={() => put({ t: "op", v })}>{SIGNS[v]}</button>)}
                  <button type="button" className="btn btn-sm btn-ghost" aria-label="Remove the last piece" disabled={!tokens.length} onClick={() => setTokens(tokens.slice(0, -1))}>⌫</button>
                  <button type="button" className="btn btn-sm btn-ghost" disabled={!tokens.length} onClick={() => setTokens([])}>Clear</button>
                </div>
                <div className="formula-figure" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); putFigure(false); } }}>
                  <input value={figure} onChange={(e) => setFigure(e.target.value)} inputMode="decimal" placeholder="A number" aria-label="A number for the formula" />
                  <button type="button" className="btn btn-sm" aria-label="Add number" title="Add number" onClick={() => putFigure(false)}>＋</button>
                  <button type="button" className="btn btn-sm" aria-label="Add as %" title="Add as a percentage" onClick={() => putFigure(true)}>＋ %</button>
                </div>
                {usable.length > 0 ? (
                  <>
                    {named.length > 8 && <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find an item" aria-label="Find an item to use" />}
                    <div className="chips chips-xs" role="group" aria-label="Items to use">
                      {offered.slice(0, MOST).map((i) => <button type="button" key={i.id} className="chip" onClick={() => put({ t: "item", id: i.id })}>{i.name}</button>)}
                      {offered.length > MOST && <span className="muted">and {offered.length - MOST} more: type to find one</span>}
                      {offered.length === 0 && <span className="muted">No item by that name.</span>}
                    </div>
                  </>
                ) : <span className="hint">There are no other items to use yet. Numbers still work.</span>}
                {trial && formulaOk && <p className="formula-now" aria-live="polite">Comes to <strong>{inr(trial.budget)}</strong> in {monthLabel(todayIso.slice(0, 7))}</p>}
                {tokens.length > 0 && (!formulaOk || trial?.warn) && <div className="alert alert-warn">{!formulaOk ? "Not complete yet." : `${trial!.warn} It shows as ₹0.`}</div>}
                <span className="hint">Items used here move under this one.</span>
              </fieldset>
            )}
            {/* The amount, and how it changes over time: a row for each stretch, the first from the first date. */}
            {!isComputed && <fieldset className="field">
              <legend><Named icon="coin">{isLoan ? "EMI" : "Budget amount"}</Named>{freq !== "once" && <span className="muted"> ({isLoan ? "each month" : "each time"})</span>}</legend>
              {/* The amounts over time as steps, the one in force today lit. */}
              {freq !== "once" && periods.length > 1 && (
                <div className="amt-chart" aria-hidden>
                  {periods.map((x, n) => <span key={n} className={x.from === nowFrom ? "is-now" : ""} style={{ height: `${Math.max(12, (x.amount / Math.max(...periods.map((y) => y.amount), 1)) * 100)}%` }} />)}
                </div>
              )}
              <div className="amt-steps">
                <div className={`amt-step is-lead ${periods.length > 1 && nowAt === 0 ? "is-now" : ""}`}>
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
              {isLoan && !emiOwn && <span className="hint">Worked out from the loan.</span>}
            </fieldset>}
            {freq !== "once" && !isComputed && (
              <fieldset className="field">
                <legend><Named icon="trend">Yearly increase</Named></legend>
                <div className="chips chips-xs" id="money-increase" style={{ marginTop: 0 }}>
                  <button type="button" className={`chip ${!increase ? "is-selected" : ""}`} aria-pressed={!increase} onClick={() => setIncrease("")}>None</button>
                  {money.increases.filter((i) => !i.archived_at || i.id === increase).map((i) => (
                    <button type="button" key={i.id} className={`chip ${increase === i.id ? "is-selected" : ""}`} aria-pressed={increase === i.id} title={i.name} onClick={() => setIncrease(i.id)}><strong>{Number(i.percent)}%</strong>{i.name}</button>
                  ))}
                </div>
              </fieldset>
            )}
            {isLoan && (
              <>
                {curve && (
                  <div className="loan-chart" role="img" aria-label={`What is owed falls to nothing by ${stands?.ends ? DateTime.fromISO(stands.ends).toFormat("LLLL yyyy") : "the end"}`}>
                    <svg viewBox="0 0 100 32" preserveAspectRatio="none">
                      <polygon points={curve.area} />
                      <polyline points={curve.line} vectorEffect="non-scaling-stroke" />
                      <line x1={curve.at} x2={curve.at} y1="0" y2="32" vectorEffect="non-scaling-stroke" />
                    </svg>
                  </div>
                )}
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
                </fieldset>
              </>
            )}
          </div>
        </Step>

        {/* The bank: where an expense is paid from, where income comes to. */}
        <Step icon="bank" name={expense ? "From where" : "To where"} set={!!bank}>
          <div role="group" aria-label={expense ? "Bank it is paid from" : "Bank it comes into"}>
            <div className="chips chips-xs" id="money-bank" style={{ marginTop: 0 }}>
              {money.banks.filter((b) => !b.archived_at || b.id === bank).map((b) => {
                const tone = bankTone.get(b.id);
                return <button type="button" key={b.id} className={`chip act-${tone} ${bank === b.id ? "is-selected" : ""}`} aria-pressed={bank === b.id} onClick={() => setBank(b.id)}><span className={`kit-mono is-mini act-${tone}`} aria-hidden>{b.name.trim()[0]?.toUpperCase()}</span>{b.name}</button>;
              })}
              {canEdit && <button type="button" className="chip chip-dashed" aria-label="New bank" title="New bank" aria-expanded={adding?.what === "bank"} onClick={() => setAdding({ what: "bank", name: "", balance: "" })}>＋</button>}
            </div>
            {adder("bank")}
          </div>
        </Step>

        {family.length > 0 && (
          <Step icon="people" name={expense ? "For whom" : "By whom"} set={people.length > 0}>
          <div role="group" aria-label={expense ? "Incurred for" : "Received by"}>
            <div className="chips chips-xs" style={{ marginTop: 0 }}>
              {family.map((p) => {
                const on = people.includes(p.id);
                return <button type="button" key={p.id} className={`chip act-${personTone.get(p.id)} ${on ? "is-selected" : ""}`} aria-pressed={on} onClick={() => setPeople(on ? people.filter((x) => x !== p.id) : [...people, p.id])}><span className={`kit-mono is-mini is-round act-${personTone.get(p.id)}`} aria-hidden>{p.name.trim()[0]?.toUpperCase()}</span>{p.name}</button>;
              })}
            </div>
            {people.length > 1 && value !== null && <span className="hint">Split equally: {inr(Math.round((value / people.length) * 100) / 100)} each.</span>}
          </div>
          </Step>
        )}

        <Step icon="more" name="More" set={!!notes.trim()}>
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes" aria-label="Notes" />
        </Step>
      </div>
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
      {closeOn !== null && (
        <div className="confirm-box">
          <p>Close {existing?.name}? It stays in the months up to its last date and stops after it.</p>
          <label className="field"><span>Last date</span><input type="date" autoFocus value={closeOn} min={start} onChange={(e) => setCloseOn(e.target.value)} /></label>
          <div className="row">
            <button type="button" className="btn btn-primary" disabled={saving || !closeOn} onClick={() => save(undefined, closeOn)}>{needsOthers ? "Send for approval" : "Close it"}</button>
            <button type="button" className="btn btn-ghost" onClick={() => setCloseOn(null)}>Cancel</button>
          </div>
        </div>
      )}
      {canEdit && (
        <div className="form-actions">
          <button className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : needsOthers ? "Send for approval" : existing ? "Save changes" : `Add ${kind}`}</button>
          {existing && !again && !confirm && closeOn === null && freq !== "once" && <button type="button" className="btn btn-ghost" onClick={() => { setCloseOn(todayIso); setError(null); }}>Close</button>}
          {existing && !again && !confirm && closeOn === null && <button type="button" className="btn btn-ghost btn-danger" onClick={() => setConfirm(true)}>Delete</button>}
        </div>
      )}
    </form>
  );
}

/** One month of one item: its budget for that month alone, what was really paid, and whether to skip it. */
export function MoneyLineForm({ ctx, money, line, ym, shared, canEdit, onEditItem, onDone }: { ctx: PlannerCtx; money: MoneyCtx; line: Line; ym: string; shared: boolean; canEdit: boolean; onEditItem: () => void; onDone: () => void }) {
  const [budget, setBudget] = useState(String(line.budget));
  // A computed line's actual comes from its parts until one is typed here; then the typed one wins.
  const [actual, setActual] = useState(line.actual === null || line.derived ? "" : String(line.actual));
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

  // The month as it reads in the form now, for the gauge: how the real figure sits against the budget.
  const b = parseAmount(budget) ?? 0;
  const typed = actual.trim() ? parseAmount(actual) : null;
  const real = skipped ? null : typed ?? (line.derived ? line.actual : paid ? b : null);
  const full = Math.max(b, real ?? 0, 1);
  const over = real !== null ? real - b : 0;
  const bank = money.banks.find((x) => x.id === line.item.bank_id);
  const type = money.types.find((x) => x.id === line.item.type_id);
  const bankTone = bank ? TONES[money.banks.indexOf(bank) % TONES.length] : null;
  const typeTone = type ? TONES[[...money.types].sort((x, y) => x.kind.localeCompare(y.kind)).indexOf(type) % TONES.length] : null;
  const first = DateTime.fromISO(line.dates[0]);

  return (
    <form className={`form line-form ${expense ? "is-out" : "is-in"} ${skipped ? "is-skipped" : ""}`} onSubmit={save} noValidate>
      {/* What this is: the day it falls due, its name, and where it sits, in marks rather than a sentence. */}
      <div className="line-head">
        <span className="line-date" role="img" aria-label={line.dates.length > 1 ? `${line.dates.length} times in ${monthLabel(ym)}` : `Due ${first.toFormat("d LLLL")}`}>
          {line.dates.length > 1 ? <><strong>×{line.dates.length}</strong><span>times</span></> : <><strong>{first.toFormat("d")}</strong><span>{first.toFormat("ccc")}</span></>}
        </span>
        <span className="grow line-head-what">
          <strong>{line.item.name}</strong>
          <span className="line-head-marks">
            {type && <span title={type.name}><span className={`kit-mono is-mini act-${typeTone}`} aria-hidden>{type.name.trim()[0]?.toUpperCase()}</span>{type.name}</span>}
            {bank && <span title={bank.name}><span className={`kit-mono is-mini act-${bankTone}`} aria-hidden>{bank.name.trim()[0]?.toUpperCase()}</span>{bank.name}</span>}
          </span>
        </span>
        <svg className="line-way" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label={expense ? "Expense" : "Income"}><path d={ARROW[line.item.kind]} /></svg>
      </div>

      <div className="line-figures">
        <label className="field">
          <span>Budget{shared && <svg className="line-lock" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M6 11h12v9H6zM8.500 11V8a3.500 3.500 0 0 1 7 0v3" /></svg>}</span>
          <input value={budget} onChange={(e) => setBudget(e.target.value)} inputMode="decimal" aria-label="Budget this month" autoFocus={!shared} disabled={shared} title={shared ? "Agreed by the circle. Edit the item to change it." : undefined} />
        </label>
        <label className="field">
          <span>Actual</span>
          <input value={actual} onChange={(e) => setActual(e.target.value)} inputMode="decimal" aria-label="Actual amount" placeholder={line.derived ? inr(line.actual!) : "₹"} title={line.derived ? "From its parts, until one is typed here" : undefined} />
        </label>
      </div>
      {/* The track is the budget; the solid part is what really moved. Past the budget it runs on in another colour. */}
      <div className="line-gauge" role="img" aria-label={real === null ? `${inr(b)} budgeted, nothing recorded yet` : `${inr(real)} of ${inr(b)} budgeted${over > 0 ? `, ${inr(over)} over` : over < 0 ? `, ${inr(-over)} under` : ""}`}>
        <span className="line-track">
          <span className="line-fill" style={{ width: `${real === null ? 0 : (Math.min(real, b) / full) * 100}%` }} />
          {over > 0 && <span className="line-spill" style={{ width: `${(over / full) * 100}%` }} />}
          {/* Where the budget ends, when the real figure went past it. */}
          {over > 0 && <span className="line-mark" style={{ left: `${(b / full) * 100}%` }} />}
        </span>
        <span className={`line-diff ${over > 0 ? "is-over" : over < 0 ? "is-under" : ""}`}>{real === null ? "" : over > 0 ? `+${inr(over)}` : over < 0 ? `−${inr(-over)}` : "="}</span>
      </div>
      {!shared && parseAmount(budget) !== line.rule && (
        <button type="button" className="chip chip-sm chip-dashed line-usual" onClick={() => setBudget(String(line.rule))} aria-label={`Use the usual budget, ${inr(line.rule)}`}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 12a8 8 0 1 0 2.500-5.800M4 4.500v4h4" /></svg>{inr(line.rule)}
        </button>
      )}
      {line.parts && line.parts.length > 0 && (
        <ul className="line-parts-list" aria-label="Worked out from">
          {line.parts.map((p) => <li key={p.item.id} className={p.skipped ? "is-skipped" : ""}><span>{p.item.name}</span><strong>{inr(p.skipped ? 0 : p.actual ?? p.budget)}</strong></li>)}
        </ul>
      )}

      <div className="line-toggles">
        <button type="button" className={`line-toggle is-paid ${paid ? "is-on" : ""}`} aria-pressed={paid} disabled={skipped} onClick={() => setPaid(!paid)}>
          <span className="line-tick" aria-hidden>{paid && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.500l4.500 4.500L19 7.500" /></svg>}</span>
          {expense ? "Paid" : "Received"}
        </button>
        {!shared && (
          <button type="button" className={`line-toggle is-skip ${skipped ? "is-on" : ""}`} aria-pressed={skipped} onClick={() => setSkipped(!skipped)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 5.500l8 6.500-8 6.500zM18.500 5.500v13" /></svg>
            Skip this month
          </button>
        )}
      </div>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      <div className="form-actions">
        {canEdit && <button className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "Save this month"}</button>}
        <button type="button" className="btn btn-ghost" onClick={onEditItem}>{canEdit ? "Edit every month" : "See the item"}</button>
      </div>
    </form>
  );
}

"use client";
import { useState } from "react";
import type { PlannerCtx } from "./usePlanner";
import type { MoneyCtx } from "./useMoney";
import Select from "./Select";
import { FREQ_LABELS, inr, monthLabel, parseAmount, type Line, type MoneyFreq, type MoneyItem, type MoneyKind } from "@/lib/money";
import { todayISO } from "@/lib/time";

const NONE = { value: "", label: "None" };

/** Add or change an income or expense: the rule for every month it falls in. */
export function MoneyItemForm({ ctx, money, existing, kind: startKind, onDone }: { ctx: PlannerCtx; money: MoneyCtx; existing?: MoneyItem; kind?: MoneyKind; onDone: () => void }) {
  const { supabase, toast } = ctx;
  const [kind, setKind] = useState<MoneyKind>(existing?.kind ?? startKind ?? "expense");
  const [name, setName] = useState(existing?.name ?? "");
  const [amount, setAmount] = useState(existing ? String(existing.amount) : "");
  const [freq, setFreq] = useState<MoneyFreq>(existing?.freq ?? "monthly");
  const [start, setStart] = useState(existing?.start_date ?? todayISO(ctx.tz));
  const [end, setEnd] = useState(existing?.end_date ?? "");
  const [bank, setBank] = useState(existing?.bank_id ?? "");
  const [type, setType] = useState(existing?.type_id ?? "");
  const [increase, setIncrease] = useState(existing?.increase_id ?? "");
  const [people, setPeople] = useState<string[]>(existing?.person_ids ?? []);
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Archived choices are not offered, except the one this item already uses.
  const offer = <T extends { id: string; name: string; archived_at: string | null }>(rows: T[], keep: string) =>
    [NONE, ...rows.filter((r) => !r.archived_at || r.id === keep).map((r) => ({ value: r.id, label: r.name }))];
  const family = money.people.filter((p) => !p.archived_at || people.includes(p.id));
  const expense = kind === "expense";
  const value = parseAmount(amount);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (!name.trim()) return setError("Give it a name.");
    if (value === null) return setError("Enter the amount as a number, for example 1499.");
    if (!start) return setError("Choose a date.");
    if (freq !== "once" && end && end < start) return setError("The last date is before the first.");
    setSaving(true);
    const row = {
      kind, name: name.trim(), amount: value, freq, start_date: start, end_date: freq === "once" ? null : end || null,
      bank_id: bank || null, type_id: type || null, increase_id: freq === "once" ? null : increase || null, person_ids: people, notes: notes.trim() || null,
    };
    const { error } = existing ? await supabase.from("money_items").update(row).eq("id", existing.id) : await supabase.from("money_items").insert(row);
    setSaving(false);
    if (error) return setError(`Couldn’t save: ${error.message}`);
    await money.reload();
    toast("ok", existing ? `${row.name} updated` : `${row.name} added`);
    onDone();
  }

  async function remove() {
    if (!existing) return;
    setSaving(true);
    const { error } = await supabase.from("money_items").delete().eq("id", existing.id);
    setSaving(false);
    if (error) return setError(`Couldn’t delete: ${error.message}`);
    await money.reload();
    toast("ok", `${existing.name} deleted`);
    onDone();
  }

  return (
    <form className="form" onSubmit={save} noValidate>
      <div className="segmented" role="group" aria-label="Kind">
        {(["expense", "income"] as const).map((k) => (
          <button type="button" key={k} className={kind === k ? "is-active" : ""} aria-pressed={kind === k} onClick={() => { setKind(k); setType(""); }}>{k === "expense" ? "Expense" : "Income"}</button>
        ))}
      </div>
      <label className="field"><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder={expense ? "Wifi bill" : "Salary"} autoFocus={!existing} /></label>
      <label className="field">
        <span>Budget amount{freq !== "once" && <span className="muted"> (each time)</span>}</span>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="₹" aria-invalid={!!amount && value === null} />
        <span className="hint">The amount you plan for. What you really {expense ? "pay" : "receive"} is recorded month by month.</span>
      </label>
      <label className="field"><span>Repeats</span><Select id="money-freq" value={freq} options={Object.entries(FREQ_LABELS).map(([v, label]) => ({ value: v, label }))} onChange={(v) => setFreq(v as MoneyFreq)} /></label>
      <div className="field-row">
        <label className="field"><span>{freq === "once" ? "Date" : "First date"}</span><input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
        {freq !== "once" && <label className="field"><span>Last date <span className="muted">(optional)</span></span><input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} /></label>}
      </div>
      <label className="field"><span>Bank</span><Select id="money-bank" value={bank} options={offer(money.banks, bank)} onChange={setBank} /></label>
      <label className="field"><span>{expense ? "Expense type" : "Income type"}</span><Select id="money-type" value={type} options={offer(money.types.filter((t) => t.kind === kind), type)} onChange={setType} /></label>
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
      <div className="form-actions">
        <button className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : existing ? "Save changes" : `Add ${kind}`}</button>
        {existing && !confirm && <button type="button" className="btn btn-ghost btn-danger" onClick={() => setConfirm(true)}>Delete</button>}
      </div>
    </form>
  );
}

/** One month of one item: its budget for that month alone, what was really paid, and whether to skip it. */
export function MoneyLineForm({ ctx, money, line, ym, onEditItem, onDone }: { ctx: PlannerCtx; money: MoneyCtx; line: Line; ym: string; onEditItem: () => void; onDone: () => void }) {
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
      item_id: line.item.id, month: `${ym}-01`, budget: b === line.rule ? null : b, actual: a, skipped,
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
        <input value={budget} onChange={(e) => setBudget(e.target.value)} inputMode="decimal" autoFocus />
        {parseAmount(budget) !== line.rule && <span className="hint">Usually {inr(line.rule)}. <button type="button" className="link" onClick={() => setBudget(String(line.rule))}>Use that</button></span>}
      </label>
      <label className="field">
        <span>Actual amount <span className="muted">(optional)</span></span>
        <input value={actual} onChange={(e) => setActual(e.target.value)} inputMode="decimal" placeholder={`What you really ${expense ? "paid" : "received"}`} />
      </label>
      <label className="check"><input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} /> {expense ? "Paid" : "Received"}</label>
      <label className="check"><input type="checkbox" checked={skipped} onChange={(e) => setSkipped(e.target.checked)} /> Skip this month</label>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      <div className="form-actions">
        <button className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "Save this month"}</button>
        <button type="button" className="btn btn-ghost" onClick={onEditItem}>Edit every month</button>
      </div>
    </form>
  );
}

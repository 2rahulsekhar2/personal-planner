"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { DateTime } from "luxon";
import type { PlannerCtx } from "./usePlanner";
import type { MoneyCtx } from "./useMoney";
import Select, { type Option } from "./Select";
import { inr, parseAmount, RELATIONSHIPS } from "@/lib/money";
import { todayISO } from "@/lib/time";
import type { Circle } from "@/lib/circles";

// "relation" is a choice from RELATIONSHIPS, or Other with the relationship typed in.
type Field = { key: string; label: string; kind: "text" | "amount" | "percent" | "choice" | "relation"; options?: Option[]; placeholder?: string };
type Row = { id: string; name: string; archived_at: string | null } & Record<string, unknown>;
type Draft = { id?: string } & Record<string, string>;

/** One of Money's lists (banks, types, yearly increases, family): add, edit, archive and restore. */
// `scope`: the circle whose list this is, or null for a private one. `canEdit` false shows it read-only (a viewer).
// `mayEdit` narrows editing to some rows (a bank: only the person who added it). `rowAction` adds a button to a row.
function ListEditor({ ctx, money, scope, canEdit, title, noun, table, rows, fields, about, summary, mayEdit, rowAction }: {
  ctx: PlannerCtx; money: MoneyCtx; scope: Circle | null; canEdit: boolean; title: string; noun: string; table: string; rows: Row[]; fields: Field[]; about: string; summary: (row: Row) => string;
  mayEdit?: (row: Row) => boolean; rowAction?: (row: Row) => React.ReactNode;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const blank = () => Object.fromEntries(fields.map((f) => [f.key, f.kind === "choice" ? f.options![0].value : f.kind === "relation" ? RELATIONSHIPS[0] : ""]));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft || busy) return;
    const row: Record<string, unknown> = {};
    for (const f of fields) {
      const text = (draft[f.key] ?? "").trim();
      if (f.kind === "amount" || f.kind === "percent") {
        const n = parseAmount(text);
        if (n === null || (f.kind === "percent" && (n <= 0 || n > 100))) return setError(f.kind === "percent" ? "Enter a percentage between 0 and 100." : `Enter ${f.label.toLowerCase()} as a number.`);
        row[f.key] = n;
      } else if (!text) return setError(`${f.label} is required.`);
      else row[f.key] = text;
    }
    // A bank's balance carries the day it was typed in.
    if (table === "money_banks") row.balance_at = todayISO(ctx.tz);
    setBusy(true);
    const { error } = draft.id ? await ctx.supabase.from(table).update(row).eq("id", draft.id) : await ctx.supabase.from(table).insert(scope ? { ...row, circle_id: scope.id } : row);
    setBusy(false);
    if (error) return setError(`Couldn’t save: ${error.message}`);
    setDraft(null);
    setError(null);
    await money.reload();
    ctx.toast("ok", `${row.name} saved`);
  }

  async function archive(r: Row, on: boolean) {
    const { error } = await ctx.supabase.from(table).update({ archived_at: on ? new Date().toISOString() : null }).eq("id", r.id);
    if (error) return ctx.toast("error", `Couldn’t update: ${error.message}`);
    await money.reload();
    ctx.toast("ok", on ? `${r.name} archived` : `${r.name} restored`);
  }

  const list = rows.filter((r) => (showArchived ? r.archived_at : !r.archived_at));
  const hasArchived = rows.some((r) => r.archived_at);

  return (
    <section className="stack">
      <div className="page-head">
        <h2>{title}</h2>
        {!draft && canEdit && <button className="btn btn-sm" onClick={() => { setDraft(blank()); setError(null); }}>＋ New {noun}</button>}
      </div>
      <p className="muted" style={{ margin: 0 }}>{about}</p>
      {draft && (
        <form className="card form" onSubmit={save} noValidate>
          {fields.map((f, n) => {
            const set = (v: string) => setDraft({ ...draft, [f.key]: v });
            const v = draft[f.key] ?? "";
            if (f.kind === "choice") return <label key={f.key} className="field"><span>{f.label}</span><Select id={`${table}-${f.key}`} value={v} options={f.options!} onChange={set} /></label>;
            if (f.kind === "relation") {
              const other = !RELATIONSHIPS.includes(v);
              return (
                <div key={f.key} className="field">
                  <span>{f.label}</span>
                  <Select id={`${table}-${f.key}`} value={other ? "" : v} options={[...RELATIONSHIPS.map((r) => ({ value: r, label: r })), { value: "", label: "Other" }]} onChange={set} />
                  {other && <input value={v} onChange={(e) => set(e.target.value)} placeholder="Say how you are related" aria-label="Relationship" autoFocus />}
                </div>
              );
            }
            return <label key={f.key} className="field"><span>{f.label}</span><input value={v} onChange={(e) => set(e.target.value)} placeholder={f.placeholder} inputMode={f.kind === "text" ? undefined : "decimal"} autoFocus={n === 0} /></label>;
          })}
          {error && <div className="alert alert-error" role="alert">{error}</div>}
          <div className="form-actions">
            <button className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : `Save ${noun}`}</button>
            <button type="button" className="btn btn-ghost" onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </form>
      )}
      <ul className="card list">
        {list.length === 0 && <li className="empty">{showArchived ? "Nothing archived." : `No ${title.toLowerCase()} yet.`}</li>}
        {list.map((r) => (
          <li key={r.id} className="list-row">
            <span className="grow"><strong>{r.name}</strong> <span className="muted">{summary(r)}</span></span>
            {canEdit && (!mayEdit || mayEdit(r)) && <span className="row-actions">
              {!r.archived_at && rowAction?.(r)}
              {!r.archived_at && <button className="btn btn-ghost btn-sm" onClick={() => { setDraft({ id: r.id, ...Object.fromEntries(fields.map((f) => [f.key, String(r[f.key] ?? "")])) }); setError(null); }}>Edit</button>}
              <button className="btn btn-ghost btn-sm" onClick={() => archive(r, !r.archived_at)}>{r.archived_at ? "Restore" : "Archive"}</button>
            </span>}
          </li>
        ))}
      </ul>
      {hasArchived && <button className="link" style={{ alignSelf: "flex-start" }} onClick={() => setShowArchived(!showArchived)}>{showArchived ? "Show active" : "Show archived"}</button>}
    </section>
  );
}

type Backup = { id: string; label: string; created_at: string };

/** Excel in and out, and the backups taken each time the data is replaced. */
function MoneyTransfer({ ctx, money }: { ctx: PlannerCtx; money: MoneyCtx }) {
  const [backups, setBackups] = useState<Backup[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [goBack, setGoBack] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [skipped, setSkipped] = useState<string[]>([]);
  const picker = useRef<HTMLInputElement>(null);
  const nowYm = todayISO(ctx.tz).slice(0, 7);

  const load = useCallback(async () => {
    const { data, error } = await ctx.supabase.from("money_backups").select("id, label, created_at").order("created_at", { ascending: false });
    // No table yet: the database is one migration behind.
    setError(error ? "Import and backups need a database update. Run supabase/migrations/0016_money_backups.sql in the Supabase SQL editor, then reload." : null);
    setBackups((data as Backup[] | null) ?? []);
  }, [ctx.supabase]);
  useEffect(() => {
    load();
  }, [load]);

  const done = async (message: string) => {
    await Promise.all([money.reload(), load()]);
    ctx.toast("ok", message);
  };
  async function importFile() {
    if (!file || busy) return;
    setBusy(true);
    const body = new FormData();
    body.set("file", file);
    body.set("month", nowYm);
    const res = await fetch("/api/money/import", { method: "POST", body }).catch(() => null);
    const json = await res?.json().catch(() => null);
    setBusy(false);
    if (!res?.ok) return ctx.toast("error", json?.error ?? "Couldn’t reach the server. Check your connection and try again.");
    setFile(null);
    setSkipped(json.skipped ?? []);
    await done(`${json.items} incomes and expenses imported`);
  }
  async function restore(b: Backup) {
    setBusy(true);
    const { error } = await ctx.supabase.rpc("money_restore", { p_id: b.id });
    setBusy(false);
    setGoBack(null);
    if (error) return ctx.toast("error", `Couldn’t go back: ${error.message}`);
    await done("Backup restored");
  }

  return (
    <section className="stack">
      <div className="page-head"><h2>Import and export</h2></div>
      <p className="muted" style={{ margin: 0 }}>Load a budget from an Excel file, or save yours as one. The file has a row for each income or expense and a column for each month.</p>
      {error ? <div className="alert alert-warn">{error}</div> : (
        <>
          <div className="card stack">
            <input ref={picker} type="file" accept=".xlsx" hidden onChange={(e) => { setFile(e.target.files?.[0] ?? null); e.target.value = ""; }} />
            {file ? (
              <>
                <p style={{ margin: 0 }}>Import <strong>{file.name}</strong>? It replaces your banks, types, yearly increases, incomes and expenses. What you have now is kept as a backup below.</p>
                <div className="form-actions">
                  <button className="btn btn-primary" disabled={busy} onClick={importFile}>{busy ? "Importing…" : "Replace my data"}</button>
                  <button className="btn btn-ghost" disabled={busy} onClick={() => setFile(null)}>Cancel</button>
                </div>
              </>
            ) : (
              <div className="form-actions">
                <button className="btn" onClick={() => picker.current?.click()}>Import from Excel</button>
                <a className="btn" href={`/api/money/export?month=${nowYm}`} download>Export to Excel</a>
              </div>
            )}
            {skipped.length > 0 && <p className="muted" style={{ margin: 0 }}>Left out, because no month had a figure: {skipped.join(", ")}.</p>}
          </div>
          <ul className="card list">
            {backups.length === 0 && <li className="empty">No backups yet. One is taken each time you import.</li>}
            {backups.map((b) => (
              <li key={b.id} className="list-row">
                <span className="grow"><strong>{DateTime.fromISO(b.created_at).setZone(ctx.tz).toFormat("d LLL yyyy, h:mm a")}</strong> <span className="muted">{b.label}</span></span>
                <span className="row-actions">
                  {goBack === b.id ? (
                    <>
                      <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => restore(b)}>{busy ? "Restoring…" : "Replace my data"}</button>
                      <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setGoBack(null)}>Cancel</button>
                    </>
                  ) : <button className="btn btn-ghost btn-sm" onClick={() => setGoBack(b.id)}>Go back to this</button>}
                </span>
              </li>
            ))}
          </ul>
          {backups.length > 0 && <p className="hint">Going back replaces everything in Money with the backup. What you have now is saved as a new backup first. The ten newest are kept.</p>}
        </>
      )}
    </section>
  );
}

const KINDS: Option[] = [{ value: "expense", label: "Expense" }, { value: "income", label: "Income" }];

/** The family admin's switch: which of their circles share a budget. */
function FamilyPlans({ ctx, money, circles }: { ctx: PlannerCtx; money: MoneyCtx; circles: Circle[] }) {
  const [busy, setBusy] = useState(false);
  const owned = circles.filter((c) => c.owner_id === ctx.userId);
  if (!money.shared || !owned.length) return null;
  const set = async (c: Circle, on: boolean) => {
    setBusy(true);
    const { error } = await ctx.supabase.rpc("money_set_family", { p_circle: c.id, p_on: on });
    setBusy(false);
    if (error) return ctx.toast("error", error.message);
    await money.reload();
    ctx.toast("ok", on ? `${c.name} now shares a budget` : `Family plan turned off for ${c.name}`);
  };
  return (
    <section className="stack">
      <div className="page-head"><h2>Family plan</h2></div>
      <p className="muted" style={{ margin: 0 }}>Share a budget with a circle you own. Every member gets Money, and each income or expense in the shared budget needs every other member’s approval. Turning it off hides the shared budget and deletes nothing.</p>
      <ul className="card list">
        {owned.map((c) => {
          const on = money.family.includes(c.id);
          return (
            <li key={c.id} className="list-row">
              <span className="grow"><strong>{c.name}</strong> <span className="muted">{on ? "Sharing a budget" : `${c.circle_members.length} ${c.circle_members.length === 1 ? "member" : "members"}`}</span></span>
              <span className="row-actions"><button className={`btn btn-sm ${on ? "btn-ghost" : ""}`} disabled={busy} onClick={() => set(c, !on)}>{on ? "Turn off" : "Turn on"}</button></span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The lists every income and expense draws on, for the budget in view: `money` holds that budget's rows only. */
export default function MoneySetup({ ctx, money, scope, canEdit, circles }: { ctx: PlannerCtx; money: MoneyCtx; scope: Circle | null; canEdit: boolean; circles: Circle[] }) {
  const shared = { ctx, money, scope, canEdit };
  // Merge: the family admin joins a typed-in person to another record of the same person, usually the member they became.
  const [merge, setMerge] = useState<{ from: Row; into: string } | null>(null);
  const mayMerge = money.shared && (!scope || scope.owner_id === ctx.userId);
  const others = merge ? money.people.filter((p) => p.id !== merge.from.id && !p.archived_at) : [];
  const doMerge = async () => {
    if (!merge?.into) return;
    const { error } = await ctx.supabase.rpc("money_merge_people", { p_from: merge.from.id, p_into: merge.into });
    if (error) return ctx.toast("error", error.message);
    setMerge(null);
    await money.reload();
    ctx.toast("ok", `${merge.from.name} merged`);
  };
  return (
    <>
      {!scope && <FamilyPlans ctx={ctx} money={money} circles={circles} />}
      <ListEditor {...shared} title="Banks" noun="bank" table="money_banks" rows={money.banks as unknown as Row[]}
        about={scope ? `Accounts shared with ${scope.name}. Everyone sees the balance; only the person who added a bank can change it.` : "The accounts your money moves through. Keep each balance current to see what is left after the month’s bills."}
        fields={[{ key: "name", label: "Name", kind: "text", placeholder: "HDFC Bank" }, { key: "balance", label: "Current balance", kind: "amount", placeholder: "₹" }]}
        summary={(r) => inr(Number(r.balance))} mayEdit={(r) => r.user_id === ctx.userId} />
      <ListEditor {...shared} title="Family" noun="person" table="money_people" rows={money.people as unknown as Row[]}
        about={scope ? `The people ${scope.name}’s money is spent on or earned by. Members of the circle are listed already; add anyone without an account.` : "The people money is spent on or earned by. They do not need an account."}
        fields={[{ key: "name", label: "Name", kind: "text", placeholder: "Anchal" }, { key: "relationship", label: "Relationship", kind: "relation" }]}
        summary={(r) => `${r.relationship}${r.member_id ? ", in the circle" : ""}`}
        rowAction={mayMerge && money.people.length > 1 ? (r) => !r.member_id && <button className="btn btn-ghost btn-sm" onClick={() => setMerge({ from: r, into: "" })}>Merge</button> : undefined} />
      {merge && (
        <div className="confirm-box">
          <p>Merge {merge.from.name} into another record of the same person. Every income and expense for {merge.from.name} moves to that record, and {merge.from.name} is removed. This cannot be undone.</p>
          <div className="row">
            <Select id="merge-into" value={merge.into} options={[{ value: "", label: "Choose who" }, ...others.map((p) => ({ value: p.id, label: p.name }))]} onChange={(into) => setMerge({ ...merge, into })} />
            <button className="btn btn-danger" disabled={!merge.into} onClick={doMerge}>Merge</button>
            <button className="btn btn-ghost" onClick={() => setMerge(null)}>Cancel</button>
          </div>
        </div>
      )}
      <ListEditor {...shared} title="Types" noun="type" table="money_types" rows={money.types as unknown as Row[]}
        about="Groups for your incomes and expenses, such as Home expenses or Salary."
        fields={[{ key: "name", label: "Name", kind: "text", placeholder: "Home expenses" }, { key: "kind", label: "Used for", kind: "choice", options: KINDS }]}
        summary={(r) => (r.kind === "income" ? "Income" : "Expense")} />
      <ListEditor {...shared} title="Yearly increases" noun="increase" table="money_increases" rows={money.increases as unknown as Row[]}
        about="A rise applied to a repeating item once a year, on the anniversary of its first date."
        fields={[{ key: "name", label: "Name", kind: "text", placeholder: "EMI step-up" }, { key: "percent", label: "Percent a year", kind: "percent", placeholder: "10" }]}
        summary={(r) => `${Number(r.percent)}% a year`} />
      {!scope && <MoneyTransfer ctx={ctx} money={money} />}
    </>
  );
}

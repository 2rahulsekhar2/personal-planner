"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { DateTime } from "luxon";
import type { PlannerCtx } from "./usePlanner";
import type { MoneyCtx } from "./useMoney";
import Select, { type Option } from "./Select";
import { inr, parseAmount, RELATIONSHIPS } from "@/lib/money";
import { todayISO } from "@/lib/time";
import { seatsOf, type Circle } from "@/lib/circles";

// "relation" is a choice from RELATIONSHIPS, or Other with the relationship typed in.
type Field = { key: string; label: string; kind: "text" | "amount" | "percent" | "choice" | "relation"; options?: Option[]; placeholder?: string };
type Row = { id: string; name: string; archived_at: string | null } & Record<string, unknown>;
type Draft = { id?: string } & Record<string, string>;

// Each token takes a colour from the activity palette by its place in the list, so it keeps it from visit to visit.
export const TONES = ["lilac", "sky", "sage", "amber", "rose", "teal", "clay", "slate"];
const Icon = ({ d, size = 18 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>
);
const PLUS = "M12 5v14M5 12h14";

/**
 * One of Money's lists (banks, family, types, yearly increases), drawn as a row of tokens rather than a table.
 * Pressing a token opens it for editing, where it can also be archived; the dashed token adds a new one.
 * `scope`: the circle whose list this is, or null for a private one. `canEdit` false shows it read-only (a viewer).
 * `mayEdit` narrows editing to some rows (a bank: only the person who added it). `formAction` adds a button to the edit form.
 */
function ListEditor({ ctx, money, scope, canEdit, title, noun, table, rows, fields, look, token, label, mayEdit, formAction }: {
  ctx: PlannerCtx; money: MoneyCtx; scope: Circle | null; canEdit: boolean; title: string; noun: string; table: string; rows: Row[]; fields: Field[];
  look: "tiles" | "faces" | "chips"; token: (row: Row) => React.ReactNode; label: (row: Row) => string;
  mayEdit?: (row: Row) => boolean; formAction?: (row: Row, close: () => void) => React.ReactNode;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const blank = () => Object.fromEntries(fields.map((f) => [f.key, f.kind === "choice" ? f.options![0].value : f.kind === "relation" ? RELATIONSHIPS[0] : ""]));
  const close = () => { setDraft(null); setError(null); };

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
    close();
    await money.reload();
    ctx.toast("ok", `${row.name} saved`);
  }

  async function archive(r: Row, on: boolean) {
    const { error } = await ctx.supabase.from(table).update({ archived_at: on ? new Date().toISOString() : null }).eq("id", r.id);
    if (error) return ctx.toast("error", `Couldn’t update: ${error.message}`);
    close();
    await money.reload();
    ctx.toast("ok", on ? `${r.name} archived` : `${r.name} restored`);
  }

  const list = rows.filter((r) => (showArchived ? r.archived_at : !r.archived_at));
  const archived = rows.filter((r) => r.archived_at).length;
  const editing = draft?.id ? rows.find((r) => r.id === draft.id) : undefined;
  const open = (r: Row) => { setDraft({ id: r.id, ...Object.fromEntries(fields.map((f) => [f.key, String(r[f.key] ?? "")])) }); setError(null); };

  return (
    <section className="kit">
      <div className="kit-head">
        <h2>{title}</h2>
        {archived > 0 && <button className="link" onClick={() => { setShowArchived(!showArchived); close(); }}>{showArchived ? "Back to active" : `${archived} archived`}</button>}
      </div>
      <ul className={`kit-row kit-${look}`}>
        {list.map((r) => {
          const tone = `act-${TONES[rows.indexOf(r) % TONES.length]}`;
          const mine = canEdit && (!mayEdit || mayEdit(r));
          // An archived token restores on a press; an active one opens for editing.
          return (
            <li key={r.id}>
              {mine
                ? <button className={`kit-token ${tone} ${draft?.id === r.id ? "is-open" : ""} ${r.archived_at ? "is-archived" : ""}`} aria-label={r.archived_at ? `Restore ${r.name}` : `Edit ${label(r)}`} aria-expanded={r.archived_at ? undefined : draft?.id === r.id} onClick={() => (r.archived_at ? archive(r, false) : draft?.id === r.id ? close() : open(r))}>{token(r)}</button>
                : <span className={`kit-token ${tone} ${r.archived_at ? "is-archived" : ""}`} aria-label={label(r)}>{token(r)}</span>}
            </li>
          );
        })}
        {canEdit && !showArchived && (
          <li>
            <button className={`kit-token kit-add ${draft && !draft.id ? "is-open" : ""}`} aria-expanded={!!draft && !draft.id} onClick={() => (draft && !draft.id ? close() : (setDraft(blank()), setError(null)))}>
              <span className="kit-add-mark"><Icon d={PLUS} /></span>
              <span className="kit-add-text">{list.length ? `Add ${noun}` : `Add your first ${noun}`}</span>
            </button>
          </li>
        )}
        {!canEdit && list.length === 0 && <li className="empty">None yet.</li>}
        {showArchived && <li className="hint kit-note">Press one to bring it back.</li>}
      </ul>
      {draft && (
        <form className="card form kit-form" onSubmit={save} noValidate>
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
            <button type="button" className="btn btn-ghost" onClick={close}>Cancel</button>
            {editing && formAction?.(editing, close)}
            {editing && <button type="button" className="btn btn-ghost kit-archive" onClick={() => archive(editing, true)}>Archive</button>}
          </div>
        </form>
      )}
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
    <section className="kit">
      <div className="kit-head"><h2>Excel</h2></div>
      {error ? <div className="alert alert-warn">{error}</div> : (
        <>
          <input ref={picker} type="file" accept=".xlsx" hidden onChange={(e) => { setFile(e.target.files?.[0] ?? null); e.target.value = ""; }} />
          {file ? (
            <div className="confirm-box">
              <p>Import <strong>{file.name}</strong>? It replaces your banks, types, yearly increases, incomes and expenses. What you have now is kept as a backup.</p>
              <div className="row">
                <button className="btn btn-primary" disabled={busy} onClick={importFile}>{busy ? "Importing…" : "Replace my data"}</button>
                <button className="btn btn-ghost" disabled={busy} onClick={() => setFile(null)}>Cancel</button>
              </div>
            </div>
          ) : (
            <div className="kit-row kit-moves">
              <button className="kit-token" onClick={() => picker.current?.click()}><span className="kit-move is-in"><Icon d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 20h14" size={22} /></span><span><strong>Import</strong><span className="kit-sub">Bring in a budget sheet</span></span></button>
              <a className="kit-token" href={`/api/money/export?month=${nowYm}`} download><span className="kit-move is-out"><Icon d="M12 15V4M7.5 8.5L12 4l4.5 4.5M5 20h14" size={22} /></span><span><strong>Export</strong><span className="kit-sub">Save yours as a file</span></span></a>
            </div>
          )}
          {skipped.length > 0 && <p className="hint">Left out, because no month had a figure: {skipped.join(", ")}.</p>}
          {backups.length > 0 && (
            <ol className="kit-backups">
              {backups.map((b) => (
                <li key={b.id}>
                  <span className="kit-dot" aria-hidden />
                  <span className="grow"><strong>{DateTime.fromISO(b.created_at).setZone(ctx.tz).toFormat("d LLL, h:mm a")}</strong> <span className="muted">{b.label}</span></span>
                  {goBack === b.id ? (
                    <span className="row-actions">
                      <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => restore(b)}>{busy ? "Restoring…" : "Replace my data"}</button>
                      <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setGoBack(null)}>Cancel</button>
                    </span>
                  ) : <button className="btn btn-ghost btn-sm" onClick={() => setGoBack(b.id)}>Go back</button>}
                </li>
              ))}
            </ol>
          )}
          {goBack && <p className="hint">Going back replaces everything in Money with that backup. What you have now is saved as a new backup first.</p>}
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
    <section className="kit">
      <div className="kit-head"><h2>Shared budget</h2></div>
      <ul className="kit-row kit-plans">
        {owned.map((c) => {
          const on = money.family.includes(c.id);
          const seats = seatsOf(c);
          return (
            <li key={c.id} className={`kit-plan ${on ? "is-on" : ""}`}>
              <span className="kit-faces" aria-hidden>
                {seats.slice(0, 4).map((m) => <span key={m.user_id} className={`face act-${m.color}`}>{m.letter}</span>)}
                {seats.length > 4 && <span className="face kit-more">+{seats.length - 4}</span>}
              </span>
              <label htmlFor={`plan-${c.id}`} className="grow">
                <strong>{c.name}</strong>
                <span className="kit-sub">{on ? "Everyone approves each change" : seats.length === 1 ? "Only you so far" : `${seats.length} people`}</span>
              </label>
              <input id={`plan-${c.id}`} type="checkbox" role="switch" className="switch" checked={on} disabled={busy} onChange={() => set(c, !on)} />
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
  const initial = (r: Row) => r.name.trim()[0]?.toUpperCase() ?? "?";
  return (
    <div className="kit-board">
      {!scope && <FamilyPlans ctx={ctx} money={money} circles={circles} />}
      <ListEditor {...shared} title="Banks" noun="bank" table="money_banks" rows={money.banks as unknown as Row[]} look="tiles"
        fields={[{ key: "name", label: "Name", kind: "text", placeholder: "HDFC Bank" }, { key: "balance", label: "Current balance", kind: "amount", placeholder: "₹" }]}
        label={(r) => `${r.name}, ${inr(Number(r.balance))}`} mayEdit={(r) => r.user_id === ctx.userId}
        token={(r) => (
          <>
            <span className="kit-bank-top"><span className="kit-mono">{initial(r)}</span><span className="kit-name">{r.name}</span></span>
            <span className="kit-balance">{inr(Number(r.balance))}</span>
            <span className="kit-sub">{r.balance_at ? `as of ${DateTime.fromISO(String(r.balance_at)).toFormat("d LLL")}` : "balance not set"}</span>
          </>
        )} />
      <ListEditor {...shared} title="Family" noun="person" table="money_people" rows={money.people as unknown as Row[]} look="faces"
        fields={[{ key: "name", label: "Name", kind: "text", placeholder: "Anchal" }, { key: "relationship", label: "Relationship", kind: "relation" }]}
        label={(r) => `${r.name}, ${r.relationship}`}
        token={(r) => (
          <>
            <span className="kit-face">{initial(r)}{!!r.member_id && <span className="kit-badge" title="In the circle" />}</span>
            <span className="kit-name">{r.name}</span>
            <span className="kit-sub">{String(r.relationship)}</span>
          </>
        )}
        formAction={mayMerge && money.people.length > 1 ? (r, close) => !r.member_id && <button type="button" className="btn btn-ghost" onClick={() => { close(); setMerge({ from: r, into: "" }); }}>Merge</button> : undefined} />
      {merge && (
        <div className="confirm-box">
          <p>Merge {merge.from.name} into another record of the same person. Every income and expense for {merge.from.name} moves there, and {merge.from.name} is removed. This cannot be undone.</p>
          <div className="row">
            <Select id="merge-into" value={merge.into} options={[{ value: "", label: "Choose who" }, ...others.map((p) => ({ value: p.id, label: p.name }))]} onChange={(into) => setMerge({ ...merge, into })} />
            <button className="btn btn-danger" disabled={!merge.into} onClick={doMerge}>Merge</button>
            <button className="btn btn-ghost" onClick={() => setMerge(null)}>Cancel</button>
          </div>
        </div>
      )}
      <ListEditor {...shared} title="Types" noun="type" table="money_types" rows={[...money.types].sort((a, b) => a.kind.localeCompare(b.kind)) as unknown as Row[]} look="chips"
        fields={[{ key: "name", label: "Name", kind: "text", placeholder: "Home expenses" }, { key: "kind", label: "Used for", kind: "choice", options: KINDS }]}
        label={(r) => `${r.name}, ${r.kind === "income" ? "income" : "expense"}`}
        token={(r) => (
          <>
            {/* An arrow says which way the money moves: up and out for spending, down and in for income. */}
            <span className={`kit-way ${r.kind === "income" ? "is-in" : "is-out"}`}><Icon d={r.kind === "income" ? "M12 5v14M6 13l6 6 6-6" : "M12 19V5M6 11l6-6 6 6"} size={14} /></span>
            <span className="kit-name">{r.name}</span>
          </>
        )} />
      <ListEditor {...shared} title="Yearly increases" noun="increase" table="money_increases" rows={money.increases as unknown as Row[]} look="chips"
        fields={[{ key: "name", label: "Name", kind: "text", placeholder: "EMI step-up" }, { key: "percent", label: "Percent a year", kind: "percent", placeholder: "10" }]}
        label={(r) => `${r.name}, ${Number(r.percent)}% a year`}
        token={(r) => (
          <>
            {/* Three steps, each taller by this increase: a bigger rise draws a steeper stair. */}
            <span className="kit-steps" aria-hidden>{[0, 1, 2].map((n) => <span key={n} style={{ height: `${Math.min(100, 34 * (1 + Number(r.percent) / 100) ** (n * 4))}%` }} />)}</span>
            <strong>{Number(r.percent)}%</strong>
            {/* An increase named after its own figure ("10%") would say it twice. */}
            {r.name.replace(/\s/g, "") !== `${Number(r.percent)}%` && <span className="kit-name">{r.name}</span>}
          </>
        )} />
      {!scope && <MoneyTransfer ctx={ctx} money={money} />}
    </div>
  );
}

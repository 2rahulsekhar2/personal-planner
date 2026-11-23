"use client";
import { useState } from "react";
import type { PlannerCtx } from "./usePlanner";
import { ACTIVITY_COLORS, type ActivityType } from "@/lib/types";

export function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="color-picker" role="radiogroup" aria-label="Color">
      {ACTIVITY_COLORS.map((c) => (
        <button type="button" key={c.key} role="radio" aria-checked={value === c.key} aria-label={c.label} title={c.label}
          className={`color-dot act-${c.key} ${value === c.key ? "is-selected" : ""}`} onClick={() => onChange(c.key)} />
      ))}
    </div>
  );
}

type Draft = { id?: string; name: string; color: string };

/** Activities as chips in their own colours. Pressing one opens it to rename, recolour or archive; the dashed chip adds one. */
export default function ActivityTypesView({ ctx }: { ctx: PlannerCtx }) {
  const { types, supabase, refresh, toast } = ctx;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const name = draft?.name.trim();
    if (!draft || !name || busy) return;
    if (types.some((t) => t.id !== draft.id && !t.archived_at && t.name.toLowerCase() === name.toLowerCase())) {
      return toast("error", "You already have an activity with that name.");
    }
    setBusy(true);
    const { error } = draft.id ? await supabase.from("activity_types").update({ name, color: draft.color }).eq("id", draft.id) : await supabase.from("activity_types").insert({ name, color: draft.color });
    setBusy(false);
    if (error) return toast("error", `Couldn’t save: ${error.message}`);
    setDraft(null);
    await refresh();
    toast("ok", draft.id ? "Saved. The new name shows everywhere." : `${name} added`);
  }

  async function archive(t: ActivityType, on: boolean) {
    const { error } = await supabase.from("activity_types").update({ archived_at: on ? new Date().toISOString() : null }).eq("id", t.id);
    if (error) return toast("error", `Couldn’t update: ${error.message}`);
    setDraft(null);
    await refresh();
    toast("ok", on ? `${t.name} archived. Existing appointments are kept.` : `${t.name} restored`);
  }

  const list = types.filter((t) => (showArchived ? t.archived_at : !t.archived_at));
  const archived = types.filter((t) => t.archived_at).length;
  const editing = draft?.id ? types.find((t) => t.id === draft.id) : undefined;
  const fresh = () => setDraft({ name: "", color: ACTIVITY_COLORS[types.length % ACTIVITY_COLORS.length].key });

  return (
    <div className="page">
      <section className="kit">
        <div className="kit-head">
          <h1>Activities</h1>
          {archived > 0 && <button className="link" onClick={() => { setShowArchived(!showArchived); setDraft(null); }}>{showArchived ? "Back to active" : `${archived} archived`}</button>}
        </div>
        <ul className="kit-row kit-chips">
          {list.map((t) => (
            <li key={t.id}>
              {/* An archived chip restores on a press; an active one opens for editing. */}
              <button className={`kit-token is-act act-${t.color} ${draft?.id === t.id ? "is-open" : ""} ${t.archived_at ? "is-archived" : ""}`} aria-label={t.archived_at ? `Restore ${t.name}` : `Edit ${t.name}`} aria-expanded={t.archived_at ? undefined : draft?.id === t.id}
                onClick={() => (t.archived_at ? archive(t, false) : draft?.id === t.id ? setDraft(null) : setDraft({ id: t.id, name: t.name, color: t.color }))}>
                <span className="swatch" aria-hidden /><span className="kit-name">{t.name}</span>
              </button>
            </li>
          ))}
          {!showArchived && (
            <li>
              <button className={`kit-token kit-add ${draft && !draft.id ? "is-open" : ""}`} aria-expanded={!!draft && !draft.id} onClick={() => (draft && !draft.id ? setDraft(null) : fresh())}>
                <span className="kit-add-mark"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg></span>
                <span className="kit-add-text">{list.length ? "Add activity" : "Add your first activity"}</span>
              </button>
            </li>
          )}
          {showArchived && <li className="hint kit-note">Press one to bring it back.</li>}
        </ul>
        {draft && (
          <form className="card form kit-form" onSubmit={save} noValidate>
            <label className="field"><span>Name</span><input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Cricket" autoFocus /></label>
            <div className="field"><span>Colour</span><ColorPicker value={draft.color} onChange={(color) => setDraft({ ...draft, color })} /></div>
            <div className="form-actions">
              <button className="btn btn-primary" disabled={busy || !draft.name.trim()}>{busy ? "Saving…" : "Save activity"}</button>
              <button type="button" className="btn btn-ghost" onClick={() => setDraft(null)}>Cancel</button>
              {editing && <button type="button" className="btn btn-ghost kit-archive" onClick={() => archive(editing, true)}>Archive</button>}
            </div>
          </form>
        )}
        <p className="hint">Two appointments of one activity can never overlap. Different activities can, after a warning.</p>
      </section>
    </div>
  );
}

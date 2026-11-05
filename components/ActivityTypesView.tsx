"use client";
import { useState } from "react";
import type { PlannerCtx } from "./usePlanner";
import { ACTIVITY_COLORS, type ActivityType } from "@/lib/types";

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="color-picker" role="radiogroup" aria-label="Color">
      {ACTIVITY_COLORS.map((c) => (
        <button type="button" key={c.key} role="radio" aria-checked={value === c.key} aria-label={c.label} title={c.label}
          className={`color-dot act-${c.key} ${value === c.key ? "is-selected" : ""}`} onClick={() => onChange(c.key)} />
      ))}
    </div>
  );
}

export default function ActivityTypesView({ ctx }: { ctx: PlannerCtx }) {
  const { types, supabase, refresh, toast } = ctx;
  const [name, setName] = useState("");
  const [color, setColor] = useState(ACTIVITY_COLORS[types.length % ACTIVITY_COLORS.length].key);
  const [editing, setEditing] = useState<ActivityType | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    if (types.some((t) => !t.archived_at && t.name.toLowerCase() === name.trim().toLowerCase())) {
      return toast("error", "You already have an activity type with that name.");
    }
    setBusy(true);
    const { error } = await supabase.from("activity_types").insert({ name: name.trim(), color });
    setBusy(false);
    if (error) return toast("error", `Couldn’t save: ${error.message}`);
    setName("");
    setColor(ACTIVITY_COLORS[(types.length + 1) % ACTIVITY_COLORS.length].key);
    await refresh();
    toast("ok", "Activity type added");
  }

  async function saveEdit() {
    if (!editing || !editing.name.trim()) return;
    const { error } = await supabase.from("activity_types").update({ name: editing.name.trim(), color: editing.color }).eq("id", editing.id);
    if (error) return toast("error", `Couldn’t save: ${error.message}`);
    setEditing(null);
    await refresh();
    toast("ok", "Saved. The new name shows everywhere.");
  }

  async function archive(t: ActivityType, on: boolean) {
    const { error } = await supabase.from("activity_types").update({ archived_at: on ? new Date().toISOString() : null }).eq("id", t.id);
    if (error) return toast("error", `Couldn’t update: ${error.message}`);
    await refresh();
    toast("ok", on ? `${t.name} archived. Existing appointments are kept.` : `${t.name} restored`);
  }

  const list = types.filter((t) => (showArchived ? t.archived_at : !t.archived_at));

  return (
    <div className="page">
      <div className="page-head"><h1>Activity types</h1></div>
      <p className="muted">Appointments of the same activity type can never overlap. Different types can, after a warning.</p>

      <form className="card form-inline" onSubmit={add}>
        <label className="field grow"><span>New activity type</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Cricket" /></label>
        <ColorPicker value={color} onChange={setColor} />
        <button className="btn btn-primary" disabled={busy || !name.trim()}>Add</button>
      </form>

      <ul className="card list">
        {list.length === 0 && <li className="empty">{showArchived ? "No archived activity types." : "No activity types yet. Add Cricket, Hospital Appointment or Movie Time to get started."}</li>}
        {list.map((t) =>
          editing?.id === t.id ? (
            <li key={t.id} className="list-row is-editing">
              <input aria-label="Name" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              <ColorPicker value={editing.color} onChange={(c) => setEditing({ ...editing, color: c })} />
              <button className="btn btn-primary btn-sm" onClick={saveEdit}>Save</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>Cancel</button>
            </li>
          ) : (
            <li key={t.id} className="list-row">
              <span className={`type-label act-${t.color}`}><span className="swatch" aria-hidden />{t.name}</span>
              <span className="row-actions">
                {!t.archived_at && <button className="btn btn-ghost btn-sm" onClick={() => setEditing(t)}>Rename</button>}
                <button className="btn btn-ghost btn-sm" onClick={() => archive(t, !t.archived_at)}>{t.archived_at ? "Restore" : "Archive"}</button>
              </span>
            </li>
          ),
        )}
      </ul>
      <button className="link" onClick={() => setShowArchived(!showArchived)}>{showArchived ? "Show active" : "Show archived"}</button>
    </div>
  );
}

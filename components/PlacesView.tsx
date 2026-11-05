"use client";
import { useState } from "react";
import type { PlannerCtx } from "./usePlanner";
import type { Place } from "@/lib/types";
import { isGoogleMapsUrl } from "@/lib/maps";

type Draft = { id?: string; name: string; maps_url: string; notes: string };
const empty: Draft = { name: "", maps_url: "", notes: "" };

export default function PlacesView({ ctx }: { ctx: PlannerCtx }) {
  const { places, supabase, refresh, toast } = ctx;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft || busy) return;
    if (!draft.name.trim()) return setError("Name is required.");
    if (!isGoogleMapsUrl(draft.maps_url)) return setError("Paste a Google Maps link, for example https://maps.app.goo.gl/… (use Share → Copy link in Google Maps).");
    setBusy(true);
    const row = { name: draft.name.trim(), maps_url: draft.maps_url.trim(), notes: draft.notes.trim() || null };
    const { error } = draft.id ? await supabase.from("places").update(row).eq("id", draft.id) : await supabase.from("places").insert(row);
    setBusy(false);
    if (error) return setError(`Couldn’t save: ${error.message}`);
    setDraft(null);
    setError(null);
    await refresh();
    toast("ok", draft.id ? "Place updated everywhere it’s used" : "Place added");
  }

  async function archive(p: Place, on: boolean) {
    const { error } = await supabase.from("places").update({ archived_at: on ? new Date().toISOString() : null }).eq("id", p.id);
    if (error) return toast("error", `Couldn’t update: ${error.message}`);
    await refresh();
    toast("ok", on ? `${p.name} archived` : `${p.name} restored`);
  }

  const list = places.filter((p) => (showArchived ? p.archived_at : !p.archived_at));

  return (
    <div className="page">
      <div className="page-head">
        <h1>Places</h1>
        {!draft && <button className="btn btn-primary" onClick={() => setDraft({ ...empty })}>＋ New place</button>}
      </div>
      <p className="muted">Editing a place updates every appointment that uses it. For a genuinely different venue, add a new place.</p>

      {draft && (
        <form className="card form" onSubmit={save} noValidate>
          <label className="field"><span>Name</span><input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Riverside Ground" autoFocus /></label>
          <label className="field">
            <span>Google Maps link</span>
            <input value={draft.maps_url} onChange={(e) => setDraft({ ...draft, maps_url: e.target.value })} placeholder="https://maps.app.goo.gl/…" inputMode="url" aria-invalid={!!draft.maps_url && !isGoogleMapsUrl(draft.maps_url)} />
            {draft.maps_url && !isGoogleMapsUrl(draft.maps_url) && <span className="field-error">This doesn’t look like a Google Maps link.</span>}
          </label>
          <label className="field"><span>Location notes <span className="muted">(optional)</span></span><input value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="Gate 2, parking behind the pavilion" /></label>
          {error && <div className="alert alert-error" role="alert">{error}</div>}
          <div className="form-actions">
            <button className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : "Save place"}</button>
            <button type="button" className="btn btn-ghost" onClick={() => { setDraft(null); setError(null); }}>Cancel</button>
          </div>
        </form>
      )}

      <ul className="card list">
        {list.length === 0 && <li className="empty">{showArchived ? "No archived places." : "No places yet."}</li>}
        {list.map((p) => (
          <li key={p.id} className="list-row">
            <span className="grow">
              <strong>{p.name}</strong>
              {p.notes && <span className="muted"> · {p.notes}</span>}
            </span>
            <span className="row-actions">
              <a className="btn btn-ghost btn-sm" href={p.maps_url} target="_blank" rel="noopener noreferrer">Maps ↗</a>
              {!p.archived_at && <button className="btn btn-ghost btn-sm" onClick={() => setDraft({ id: p.id, name: p.name, maps_url: p.maps_url, notes: p.notes ?? "" })}>Edit</button>}
              <button className="btn btn-ghost btn-sm" onClick={() => archive(p, !p.archived_at)}>{p.archived_at ? "Restore" : "Archive"}</button>
            </span>
          </li>
        ))}
      </ul>
      <button className="link" onClick={() => setShowArchived(!showArchived)}>{showArchived ? "Show active" : "Show archived"}</button>
    </div>
  );
}

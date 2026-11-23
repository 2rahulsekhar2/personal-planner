"use client";
import { useState } from "react";
import type { PlannerCtx } from "./usePlanner";
import type { Place } from "@/lib/types";
import { isGoogleMapsUrl } from "@/lib/maps";
import { TONES } from "./MoneySetup";

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
    setDraft(null);
    await refresh();
    toast("ok", on ? `${p.name} archived` : `${p.name} restored`);
  }

  const list = places.filter((p) => (showArchived ? p.archived_at : !p.archived_at));
  const archived = places.filter((p) => p.archived_at).length;
  const editing = draft?.id ? places.find((p) => p.id === draft.id) : undefined;
  const close = () => { setDraft(null); setError(null); };
  const pin = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.3" /></svg>;

  return (
    <div className="page">
      <section className="kit">
        <div className="kit-head">
          <h1>Places</h1>
          {archived > 0 && <button className="link" onClick={() => { setShowArchived(!showArchived); close(); }}>{showArchived ? "Back to active" : `${archived} archived`}</button>}
        </div>
        {/* A tile a place: press the tile to edit it, the arrow to open it in Maps. */}
        <ul className="kit-row kit-tiles kit-places">
          {list.map((p) => (
            <li key={p.id}>
              <div className={`kit-token act-${TONES[places.indexOf(p) % TONES.length]} ${draft?.id === p.id ? "is-open" : ""} ${p.archived_at ? "is-archived" : ""}`}>
                <button className="place-main" aria-label={p.archived_at ? `Restore ${p.name}` : `Edit ${p.name}`} aria-expanded={p.archived_at ? undefined : draft?.id === p.id}
                  onClick={() => (p.archived_at ? archive(p, false) : draft?.id === p.id ? close() : setDraft({ id: p.id, name: p.name, maps_url: p.maps_url, notes: p.notes ?? "" }))}>
                  <span className="kit-mono place-pin">{pin}</span>
                  <span className="kit-name">{p.name}</span>
                  {p.notes && <span className="kit-sub">{p.notes}</span>}
                </button>
                <a className="place-map" href={p.maps_url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${p.name} in Google Maps`} title="Open in Google Maps">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M8 16L16 8M9.5 8H16v6.5" /></svg>
                </a>
              </div>
            </li>
          ))}
          {!showArchived && (
            <li>
              <button className={`kit-token kit-add ${draft && !draft.id ? "is-open" : ""}`} aria-expanded={!!draft && !draft.id} onClick={() => (draft && !draft.id ? close() : (setDraft({ ...empty }), setError(null)))}>
                <span className="kit-add-mark"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg></span>
                <span className="kit-add-text">{list.length ? "Add place" : "Add your first place"}</span>
              </button>
            </li>
          )}
          {showArchived && <li className="hint kit-note">Press one to bring it back.</li>}
        </ul>

        {draft && (
          <form className="card form kit-form" onSubmit={save} noValidate>
            <label className="field"><span>Name</span><input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Riverside Ground" autoFocus /></label>
            <label className="field">
              <span>Google Maps link</span>
              <input value={draft.maps_url} onChange={(e) => setDraft({ ...draft, maps_url: e.target.value })} placeholder="https://maps.app.goo.gl/…" inputMode="url" aria-invalid={!!draft.maps_url && !isGoogleMapsUrl(draft.maps_url)} />
              {draft.maps_url && !isGoogleMapsUrl(draft.maps_url) && <span className="field-error">This doesn’t look like a Google Maps link.</span>}
            </label>
            <label className="field"><span>Location notes <span className="muted">(optional)</span></span><input value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="Gate 2, parking behind the pavilion" /></label>
            {error && <div className="alert alert-error" role="alert">{error}</div>}
            {editing && <p className="hint">Saving updates every appointment that uses this place.</p>}
            <div className="form-actions">
              <button className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : "Save place"}</button>
              <button type="button" className="btn btn-ghost" onClick={close}>Cancel</button>
              {editing && <button type="button" className="btn btn-ghost kit-archive" onClick={() => archive(editing, true)}>Archive</button>}
            </div>
          </form>
        )}
      </section>
    </div>
  );
}

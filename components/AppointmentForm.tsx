"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { DateTime } from "luxon";
import type { PlannerCtx } from "./usePlanner";
import { APPT_FIELDS } from "./usePlanner";
import type { Appointment, AppointmentStatus } from "@/lib/types";
import { REMINDER_CHOICES } from "@/lib/types";
import { findConflicts, isOverlapError } from "@/lib/conflicts";
import { fmtRange, todayISO, toInterval } from "@/lib/time";
import { expandWeekly, WEEKDAY_LABELS, MAX_OCCURRENCES } from "@/lib/recurrence";
import { isGoogleMapsUrl } from "@/lib/maps";
import type { View } from "./Planner";

interface OccReview {
  date: string;
  starts_at: string;
  ends_at: string;
  blocking: Appointment[];
  warnings: Appointment[];
  skip: boolean;
}

const pad = (n: number) => String(n).padStart(2, "0");

export default function AppointmentForm({
  ctx, initial, existing, onDone, onCancel, goTo,
}: {
  ctx: PlannerCtx;
  initial?: { typeId?: string; date?: string; start?: string; end?: string };
  existing?: Appointment;
  onDone: (id?: string) => void;
  onCancel: () => void;
  goTo: (v: View) => void;
}) {
  const { tz, types, places, typeById, placeById, supabase, profile, toast, refresh } = ctx;
  const today = todayISO(tz);
  const tomorrow = DateTime.fromISO(today, { zone: tz }).plus({ days: 1 }).toISODate()!;

  const exStart = existing ? DateTime.fromISO(existing.starts_at).setZone(tz) : null;
  const exEnd = existing ? DateTime.fromISO(existing.ends_at).setZone(tz) : null;
  const nextHour = DateTime.now().setZone(tz).plus({ hours: 1 }).startOf("hour");

  const [typeId, setTypeId] = useState(existing?.activity_type_id ?? initial?.typeId ?? "");
  const [date, setDate] = useState(exStart?.toISODate() ?? initial?.date ?? tomorrow);
  const [start, setStart] = useState(exStart?.toFormat("HH:mm") ?? initial?.start ?? `${pad(nextHour.hour)}:00`);
  const [end, setEnd] = useState(exEnd?.toFormat("HH:mm") ?? initial?.end ?? `${pad((nextHour.hour + 1) % 24)}:00`);
  const [placeId, setPlaceId] = useState(existing?.place_id ?? "");
  const [title, setTitle] = useState(existing?.title ?? "");
  const [titleEdited, setTitleEdited] = useState(!!existing);
  const [status, setStatus] = useState<AppointmentStatus>(existing?.status === "tentative" ? "tentative" : "confirmed");
  const [reminder, setReminder] = useState<number | null>(existing ? existing.reminder_minutes : profile?.default_reminder_minutes ?? 60);
  const [team, setTeam] = useState(existing?.team ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [more, setMore] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [until, setUntil] = useState("");
  const [scope, setScope] = useState<"one" | "series">("one");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocking, setBlocking] = useState<Appointment[]>([]);
  const [warnings, setWarnings] = useState<Appointment[]>([]);
  const [review, setReview] = useState<OccReview[] | null>(null);
  const requestId = useRef<string>(crypto.randomUUID());

  const [newPlace, setNewPlace] = useState<{ name: string; url: string } | null>(null);

  const type = typeById.get(typeId);
  const place = placeId ? placeById.get(placeId) : undefined;
  const generatedTitle = type ? (place ? `${type.name} at ${place.name}` : type.name) : "";
  const finalTitle = (titleEdited ? title : generatedTitle).trim() || generatedTitle;

  const activeTypes = types.filter((t) => !t.archived_at || t.id === typeId);
  const activePlaces = places.filter((p) => !p.archived_at || p.id === placeId);

  // Any change to timing or type invalidates a previous conflict check.
  useEffect(() => {
    setBlocking([]);
    setWarnings([]);
    setReview(null);
    setError(null);
  }, [typeId, date, start, end, status, repeat, weekdays, until, scope]);

  useEffect(() => {
    if (repeat && weekdays.length === 0) {
      setWeekdays([DateTime.fromISO(date, { zone: tz }).weekday]);
    }
    if (repeat && !until) {
      setUntil(DateTime.fromISO(date, { zone: tz }).plus({ weeks: 8 }).toISODate()!);
    }
  }, [repeat]); // eslint-disable-line react-hooks/exhaustive-deps

  const interval = useMemo(() => toInterval(date, start, end, tz), [date, start, end, tz]);

  function onStartChange(v: string) {
    // Keep the duration when the start moves.
    const old = toInterval(date, start, end, tz);
    const dur = old.valid ? old.end.diff(old.start, "minutes").minutes : 60;
    setStart(v);
    if (v) {
      const ns = DateTime.fromFormat(v, "HH:mm");
      if (ns.isValid) setEnd(ns.plus({ minutes: dur }).toFormat("HH:mm"));
    }
  }

  async function fetchOverlapping(fromISO: string, toISO: string) {
    const { data, error } = await supabase
      .from("appointments")
      .select(APPT_FIELDS)
      .neq("status", "cancelled")
      .lt("starts_at", toISO)
      .gt("ends_at", fromISO);
    if (error) throw error;
    return (data ?? []) as Appointment[];
  }

  function describe(a: Appointment) {
    return `${typeById.get(a.activity_type_id)?.name ?? "Appointment"} “${a.title}”, ${DateTime.fromISO(a.starts_at).setZone(tz).toFormat("ccc d LLL")} ${fmtRange(a.starts_at, a.ends_at, tz)}`;
  }

  function validate(): string | null {
    if (!typeId) return "Choose an activity type.";
    if (!date) return "Choose a date.";
    if (!start || !end) return "Enter a start and end time.";
    if (!interval.valid) return "That date or time isn’t valid.";
    if (start === end) return "The end time must be after the start time.";
    if (repeat) {
      if (!weekdays.length) return "Pick at least one weekday to repeat on.";
      if (!until) return "Choose when the repeat ends.";
      if (until < date) return "The repeat end date must be on or after the first date.";
    }
    return null;
  }

  function fields() {
    return {
      activity_type_id: typeId,
      place_id: placeId || null,
      title: finalTitle,
      status,
      team: team.trim() || null,
      notes: notes.trim() || null,
      reminder_minutes: reminder,
    };
  }

  async function handleDbError(err: { code?: string; message?: string }) {
    if (isOverlapError(err)) {
      setError(`Another ${type?.name ?? "appointment of this type"} was just saved at an overlapping time, possibly from another device. Nothing was saved. Pick a different time.`);
    } else {
      setError(`Couldn’t save: ${err.message ?? "unknown error"}. Your changes are still here; try again.`);
    }
  }

  async function saveSingle(ack: boolean) {
    const cand = { id: existing?.id, activity_type_id: typeId, starts_at: interval.start.toUTC().toISO()!, ends_at: interval.end.toUTC().toISO()!, status };
    const overlapping = await fetchOverlapping(cand.starts_at, cand.ends_at);
    const res = findConflicts(cand, overlapping);
    if (res.blocking.length) {
      setBlocking(res.blocking);
      return;
    }
    if (res.warnings.length && !ack) {
      setWarnings(res.warnings);
      return;
    }
    const row = { ...fields(), starts_at: cand.starts_at, ends_at: cand.ends_at };
    if (existing) {
      const { error } = await supabase.from("appointments").update(row).eq("id", existing.id);
      if (error) return handleDbError(error);
      await refresh();
      toast("ok", "Appointment updated");
      onDone(existing.id);
    } else {
      const { data, error } = await supabase
        .from("appointments")
        .insert({ ...row, client_request_id: requestId.current })
        .select("id")
        .single();
      if (error) {
        if (error.code === "23505") {
          // Same request already saved (double tap or retry): treat as success.
          const { data: prev } = await supabase.from("appointments").select("id").eq("client_request_id", requestId.current).maybeSingle();
          await refresh();
          return onDone(prev?.id);
        }
        return handleDbError(error);
      }
      await refresh();
      toast("ok", "Appointment saved");
      onDone(data.id);
    }
  }

  async function reviewSeries(): Promise<OccReview[] | null> {
    const occ = expandWeekly({ startDate: date, endDate: until, weekdays, startTime: start, endTime: end, timeZone: tz });
    if (!occ.length) {
      setError("No dates match those weekdays before the end date.");
      return null;
    }
    const overlapping = await fetchOverlapping(occ[0].starts_at, occ[occ.length - 1].ends_at);
    return occ.map((o) => {
      const r = findConflicts({ activity_type_id: typeId, starts_at: o.starts_at, ends_at: o.ends_at, status }, overlapping);
      return { ...o, blocking: r.blocking, warnings: r.warnings, skip: r.blocking.length > 0 };
    });
  }

  async function saveSeries(rev: OccReview[]) {
    const keep = rev.filter((r) => !r.skip);
    if (!keep.length) {
      setError("Every date is skipped, so there is nothing to save.");
      return;
    }
    const { data, error } = await supabase.rpc("create_appointment_series", {
      series: { weekdays, start_date: date, end_date: until, start_time: start, end_time: end, time_zone: tz },
      template: fields(),
      occurrences: keep.map((k) => ({ starts_at: k.starts_at, ends_at: k.ends_at })),
    });
    if (error) return handleDbError(error);
    await refresh();
    const skipped = rev.length - keep.length;
    toast("ok", `Saved ${keep.length} appointment${keep.length > 1 ? "s" : ""}${skipped ? `, skipped ${skipped}` : ""}`);
    onDone();
    return data;
  }

  async function saveSeriesEdit(ack: boolean) {
    if (!existing?.series_id) return;
    const { data, error } = await supabase
      .from("appointments")
      .select(APPT_FIELDS)
      .eq("series_id", existing.series_id)
      .neq("status", "cancelled")
      .gte("starts_at", existing.starts_at)
      .order("starts_at");
    if (error) return handleDbError(error);
    const occ = (data ?? []) as Appointment[];
    const changes = occ.map((o) => {
      const localDate = DateTime.fromISO(o.starts_at).setZone(tz).toISODate()!;
      const iv = toInterval(localDate, start, end, tz);
      return { id: o.id, starts_at: iv.start.toUTC().toISO()!, ends_at: iv.end.toUTC().toISO()! };
    });
    const ids = changes.map((c) => c.id);
    const overlapping = await fetchOverlapping(changes[0].starts_at, changes[changes.length - 1].ends_at);
    const blockingAll: Appointment[] = [];
    const warningAll: Appointment[] = [];
    for (const c of changes) {
      const r = findConflicts({ ...c, activity_type_id: typeId, status }, overlapping, ids);
      blockingAll.push(...r.blocking);
      warningAll.push(...r.warnings);
    }
    if (blockingAll.length) {
      setBlocking(blockingAll);
      return;
    }
    if (warningAll.length && !ack) {
      setWarnings(warningAll);
      return;
    }
    const { error: e2 } = await supabase.rpc("update_appointments_bulk", { changes, fields: fields() });
    if (e2) return handleDbError(e2);
    await refresh();
    toast("ok", `Updated ${changes.length} appointment${changes.length > 1 ? "s" : ""} in the series`);
    onDone(existing.id);
  }

  async function submit(opts: { ack?: boolean } = {}) {
    if (saving) return;
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (existing && existing.series_id && scope === "series") {
        await saveSeriesEdit(!!opts.ack);
      } else if (!existing && repeat) {
        if (review) {
          await saveSeries(review);
        } else {
          const rev = await reviewSeries();
          if (!rev) return;
          if (rev.some((r) => r.blocking.length || r.warnings.length)) setReview(rev);
          else await saveSeries(rev);
        }
      } else {
        await saveSingle(!!opts.ack);
      }
    } catch (e) {
      setError(`Couldn’t check for conflicts: ${(e as Error).message}. Nothing was saved.`);
    } finally {
      setSaving(false);
    }
  }

  async function addPlace() {
    if (!newPlace) return;
    if (!newPlace.name.trim()) return setError("Give the place a name.");
    if (!isGoogleMapsUrl(newPlace.url)) return setError("Paste a Google Maps link (it starts with https://maps.app.goo.gl/ or https://www.google.com/maps/).");
    const { data, error } = await supabase.from("places").insert({ name: newPlace.name.trim(), maps_url: newPlace.url.trim() }).select("id").single();
    if (error) return setError(`Couldn’t save the place: ${error.message}`);
    await refresh();
    setPlaceId(data.id);
    setNewPlace(null);
    setError(null);
  }

  const inSeriesScope = !!existing?.series_id && scope === "series";

  return (
    <form className="form" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
      {existing?.series_id && (
        <fieldset className="field">
          <legend>Apply changes to</legend>
          <div className="segmented">
            <button type="button" className={scope === "one" ? "is-active" : ""} aria-pressed={scope === "one"} onClick={() => setScope("one")}>This appointment</button>
            <button type="button" className={scope === "series" ? "is-active" : ""} aria-pressed={scope === "series"} onClick={() => setScope("series")}>This and following</button>
          </div>
        </fieldset>
      )}

      <fieldset className="field">
        <legend>Activity</legend>
        {activeTypes.length === 0 ? (
          <p className="muted">No activity types yet. <button type="button" className="link" onClick={() => goTo("types")}>Create one</button></p>
        ) : (
          <div className="chips">
            {activeTypes.map((t) => (
              <button type="button" key={t.id} className={`chip act-${t.color} ${typeId === t.id ? "is-selected" : ""}`} aria-pressed={typeId === t.id} onClick={() => setTypeId(t.id)}>
                <span className="swatch" aria-hidden /> {t.name}
              </button>
            ))}
          </div>
        )}
      </fieldset>

      <fieldset className="field" disabled={inSeriesScope}>
        <legend>Date</legend>
        <div className="chips">
          <button type="button" className={`chip ${date === today ? "is-selected" : ""}`} aria-pressed={date === today} onClick={() => setDate(today)}>Today</button>
          <button type="button" className={`chip ${date === tomorrow ? "is-selected" : ""}`} aria-pressed={date === tomorrow} onClick={() => setDate(tomorrow)}>Tomorrow</button>
          <input type="date" aria-label="Date" value={date} onChange={(e) => setDate(e.target.value)} className="input-inline" />
        </div>
        {inSeriesScope && <p className="hint">Dates stay the same for each occurrence; only the times change.</p>}
      </fieldset>

      <div className="field-row">
        <label className="field">
          <span>Start</span>
          <input type="time" required value={start} onChange={(e) => onStartChange(e.target.value)} />
        </label>
        <label className="field">
          <span>End</span>
          <input type="time" required value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
      </div>
      {interval.valid && interval.nextDay && start !== end && <p className="hint">Ends the next day, {interval.end.toFormat("ccc d LLL, h:mm a")}.</p>}

      <fieldset className="field">
        <legend>Place</legend>
        <div className="chips">
          <button type="button" className={`chip ${!placeId ? "is-selected" : ""}`} aria-pressed={!placeId} onClick={() => setPlaceId("")}>No place</button>
          {activePlaces.map((p) => (
            <button type="button" key={p.id} className={`chip ${placeId === p.id ? "is-selected" : ""}`} aria-pressed={placeId === p.id} onClick={() => setPlaceId(p.id)}>{p.name}</button>
          ))}
          {!newPlace && <button type="button" className="chip chip-dashed" onClick={() => setNewPlace({ name: "", url: "" })}>＋ New place</button>}
        </div>
        {newPlace && (
          <div className="subform">
            <label className="field"><span>Place name</span><input value={newPlace.name} onChange={(e) => setNewPlace({ ...newPlace, name: e.target.value })} placeholder="Riverside Ground" /></label>
            <label className="field"><span>Google Maps link</span><input value={newPlace.url} onChange={(e) => setNewPlace({ ...newPlace, url: e.target.value })} placeholder="https://maps.app.goo.gl/…" inputMode="url" /></label>
            <div className="row">
              <button type="button" className="btn" onClick={addPlace}>Save place</button>
              <button type="button" className="btn btn-ghost" onClick={() => setNewPlace(null)}>Cancel</button>
            </div>
          </div>
        )}
      </fieldset>

      <label className="field">
        <span>Title</span>
        <input
          value={titleEdited ? title : generatedTitle}
          placeholder={generatedTitle || "Generated from activity and place"}
          onChange={(e) => { setTitleEdited(true); setTitle(e.target.value); }}
        />
        {titleEdited && generatedTitle && title !== generatedTitle && (
          <button type="button" className="link hint" onClick={() => { setTitleEdited(false); setTitle(""); }}>Use “{generatedTitle}”</button>
        )}
      </label>

      <button type="button" className="disclosure" aria-expanded={more} onClick={() => setMore(!more)}>
        {more ? "▾" : "▸"} More options
        {!more && <span className="muted"> · {status === "tentative" ? "Tentative" : "Confirmed"}, {REMINDER_CHOICES.find((c) => c.value === reminder)?.label.toLowerCase() ?? `${reminder} min before`}{repeat ? ", repeats" : ""}</span>}
      </button>

      {more && (
        <div className="stack">
          <fieldset className="field">
            <legend>Status</legend>
            <div className="segmented">
              <button type="button" className={status === "confirmed" ? "is-active" : ""} aria-pressed={status === "confirmed"} onClick={() => setStatus("confirmed")}>Confirmed</button>
              <button type="button" className={status === "tentative" ? "is-active" : ""} aria-pressed={status === "tentative"} onClick={() => setStatus("tentative")}>Tentative</button>
            </div>
          </fieldset>
          <label className="field">
            <span>Reminder</span>
            <select value={reminder === null ? "none" : String(reminder)} onChange={(e) => setReminder(e.target.value === "none" ? null : Number(e.target.value))}>
              {REMINDER_CHOICES.map((c) => <option key={String(c.value)} value={c.value === null ? "none" : c.value}>{c.label}</option>)}
              {reminder !== null && !REMINDER_CHOICES.some((c) => c.value === reminder) && <option value={reminder}>{reminder} minutes before</option>}
            </select>
          </label>
          <label className="field"><span>Team <span className="muted">(optional)</span></span><input value={team} onChange={(e) => setTeam(e.target.value)} placeholder="Sunday XI" /></label>
          <label className="field"><span>Notes <span className="muted">(optional)</span></span><textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>

          {!existing && (
            <fieldset className="field">
              <legend>Repeat</legend>
              <label className="check"><input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} /> Repeat every week</label>
              {repeat && (
                <div className="stack">
                  <div className="chips" role="group" aria-label="Weekdays">
                    {WEEKDAY_LABELS.map((w) => (
                      <button type="button" key={w.n} className={`chip chip-sm ${weekdays.includes(w.n) ? "is-selected" : ""}`} aria-pressed={weekdays.includes(w.n)} aria-label={w.long}
                        onClick={() => setWeekdays(weekdays.includes(w.n) ? weekdays.filter((x) => x !== w.n) : [...weekdays, w.n].sort())}>
                        {w.short}
                      </button>
                    ))}
                  </div>
                  <label className="field"><span>Until</span><input type="date" value={until} min={date} onChange={(e) => setUntil(e.target.value)} /></label>
                  <p className="hint">Up to {MAX_OCCURRENCES} occurrences.</p>
                </div>
              )}
            </fieldset>
          )}
        </div>
      )}

      {blocking.length > 0 && (
        <div className="alert alert-error" role="alert">
          <strong>Can’t save: this overlaps another {type?.name} appointment.</strong>
          <ul>{blocking.map((b) => <li key={b.id}>{describe(b)}</li>)}</ul>
          Choose a different time, or change or cancel the other appointment.
        </div>
      )}

      {warnings.length > 0 && blocking.length === 0 && (
        <div className="alert alert-warn" role="alert">
          <strong>This overlaps with:</strong>
          <ul>{warnings.map((w) => <li key={w.id}>{describe(w)}</li>)}</ul>
          <div className="row">
            <button type="button" className="btn btn-warn" onClick={() => submit({ ack: true })} disabled={saving}>Save anyway</button>
            <button type="button" className="btn btn-ghost" onClick={() => setWarnings([])}>Change time</button>
          </div>
        </div>
      )}

      {review && (
        <div className="alert alert-warn" role="alert">
          <strong>Some dates conflict. Review them before saving.</strong>
          <ul className="review-list">
            {review.map((r, i) =>
              r.blocking.length || r.warnings.length ? (
                <li key={r.date}>
                  <label className="check">
                    <input type="checkbox" checked={r.skip} disabled={r.blocking.length > 0}
                      onChange={(e) => setReview(review.map((x, j) => (j === i ? { ...x, skip: e.target.checked } : x)))} />
                    <span>
                      <strong>{DateTime.fromISO(r.date).toFormat("ccc d LLL")}</strong>{" "}
                      {r.blocking.length ? `clashes with ${r.blocking.map((b) => b.title).join(", ")} (same activity, must skip)` : `overlaps ${r.warnings.map((w) => w.title).join(", ")}. Tick to skip, or keep it.`}
                    </span>
                  </label>
                </li>
              ) : null,
            )}
          </ul>
          <p>{review.filter((r) => !r.skip).length} of {review.length} dates will be saved.</p>
        </div>
      )}

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={saving || activeTypes.length === 0}>
          {saving ? "Saving…" : review ? "Save remaining dates" : existing ? "Save changes" : "Save"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

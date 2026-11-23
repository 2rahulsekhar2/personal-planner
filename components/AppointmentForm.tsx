"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { DateTime } from "luxon";
import type { PlannerCtx } from "./usePlanner";
import { APPT_FIELDS } from "./usePlanner";
import type { Appointment, AppointmentStatus } from "@/lib/types";
import { ACTIVITY_COLORS, reminderLabel } from "@/lib/types";
import ReminderPicker from "./ReminderPicker";
import { useReveal } from "./useReveal";
import { ColorPicker } from "./ActivityTypesView";
import { findConflicts, isOverlapError } from "@/lib/conflicts";
import { isCurrent, seatsOf, type Circle } from "@/lib/circles";
import { fmtRange, todayISO, toInterval } from "@/lib/time";
import { choiceFromSeries, expandRule, storedRule, toRule, NO_REPEAT, type RepeatChoice } from "@/lib/recurrence";
import RepeatPicker from "./RepeatPicker";
import { isGoogleMapsUrl } from "@/lib/maps";
import DayBar from "./DayBar";
import { Named } from "./FormBits";

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
  ctx, circles, initial, existing, onDone, onCancel,
}: {
  ctx: PlannerCtx;
  circles: Circle[]; // the circles this can be shared with
  initial?: { typeId?: string; date?: string; start?: string; end?: string; circleId?: string };
  existing?: Appointment;
  onDone: (date?: string) => void; // the saved appointment's date, so the caller can show it on the calendar
  onCancel: () => void;
}) {
  const { tz, types, places, typeById, placeById, supabase, profile, toast, refresh } = ctx;
  const today = todayISO(tz);
  const tomorrow = DateTime.fromISO(today, { zone: tz }).plus({ days: 1 }).toISODate()!;

  const exStart = existing ? DateTime.fromISO(existing.starts_at).setZone(tz) : null;
  const exEnd = existing ? DateTime.fromISO(existing.ends_at).setZone(tz) : null;
  const nextHour = DateTime.now().setZone(tz).plus({ hours: 1 }).startOf("hour");

  const [typeId, setTypeId] = useState(existing?.activity_type_id ?? initial?.typeId ?? "");
  // One-off activity and place, typed for this appointment only; null while the saved lists are in use.
  const [customActivity, setCustomActivity] = useState<string | null>(existing?.custom_activity ?? null);
  const [customPlace, setCustomPlace] = useState<string | null>(existing?.custom_place ?? null);
  // Shared with this circle, or "" for private. New ones start in the circle being viewed.
  const [circleId, setCircleId] = useState(existing ? existing.circle_id ?? "" : initial?.circleId ?? "");
  // The other members going. The creator always is, and is not in this list.
  const [going, setGoing] = useState<string[]>(existing?.participants?.map((p) => p.user_id) ?? []);
  const others = seatsOf(circles.find((c) => c.id === circleId) ?? { id: "", name: "", owner_id: "", circle_members: [] }).filter((m) => m.user_id !== ctx.userId && isCurrent(m));
  // Shared as a block of time only: the circle sees when, not what.
  const [busyOnly, setBusyOnly] = useState(existing?.busy_only ?? false);
  const share = (id: string) => { setCircleId(id); setGoing([]); }; // a different circle has different people
  // When the people going are already busy in this slot. Times only: a private item never shows what it is.
  const [busy, setBusy] = useState<{ user_id: string; starts_at: string; ends_at: string }[]>([]);
  const [date, setDate] = useState(exStart?.toISODate() ?? initial?.date ?? tomorrow);
  const [start, setStart] = useState(exStart?.toFormat("HH:mm") ?? initial?.start ?? `${pad(nextHour.hour)}:00`);
  const [end, setEnd] = useState(exEnd?.toFormat("HH:mm") ?? initial?.end ?? `${pad((nextHour.hour + 1) % 24)}:00`);
  const [placeId, setPlaceId] = useState(existing?.place_id ?? "");
  const [title, setTitle] = useState(existing?.title ?? "");
  const [titleEdited, setTitleEdited] = useState(!!existing);
  const [status, setStatus] = useState<AppointmentStatus>(existing?.status === "tentative" ? "tentative" : "confirmed");
  const [reminder, setReminder] = useState<number | null>(existing ? existing.reminder_minutes : profile?.default_reminder_minutes ?? 60);
  const [team] = useState(existing?.team ?? ""); // no longer editable; an older appointment keeps what it has
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [more, setMore] = useState(false);
  // Repeat: how often, on which days, and how it ends. On an existing series it is loaded when "this and following" is chosen.
  const [rep, setRep] = useState<RepeatChoice>(NO_REPEAT);
  const repeat = !!rep.freq;
  const repKey = JSON.stringify(rep);
  const [loadedRep, setLoadedRep] = useState<string | null>(null); // the series' repeat as loaded, to tell whether it was changed
  const [scope, setScope] = useState<"one" | "series">("one");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocking, setBlocking] = useState<Appointment[]>([]);
  const [warnings, setWarnings] = useState<Appointment[]>([]);
  const [review, setReview] = useState<OccReview[] | null>(null);
  const requestId = useRef<string>(crypto.randomUUID());

  const [newPlace, setNewPlace] = useState<{ name: string; url: string } | null>(null);
  const blankType = () => ({ name: "", color: ACTIVITY_COLORS[types.length % ACTIVITY_COLORS.length].key as string });
  const [newType, setNewType] = useState<{ name: string; color: string } | null>(() => (types.some((t) => !t.archived_at) ? null : blankType())); // nothing to pick yet: start by naming one

  const type = typeById.get(typeId);
  const place = placeId ? placeById.get(placeId) : undefined;
  const activityName = type?.name ?? customActivity?.trim() ?? "";
  const placeName = place?.name ?? customPlace?.trim() ?? "";
  const generatedTitle = activityName ? (placeName ? `${activityName} at ${placeName}` : activityName) : "";
  const finalTitle = (titleEdited ? title : generatedTitle).trim() || generatedTitle;

  const activeTypes = types.filter((t) => !t.archived_at || t.id === typeId);
  const activePlaces = places.filter((p) => !p.archived_at || p.id === placeId);

  // Any change to timing or type invalidates a previous conflict check.
  useEffect(() => {
    setBlocking([]);
    setWarnings([]);
    setReview(null);
    setError(null);
  }, [typeId, date, start, end, status, repKey, scope]);

  // Opening More options opens fields below the fold: bring them into view.
  const moreRef = useReveal<HTMLDivElement>(more);
  const rule = toRule(rep, date, start, end, tz);

  // Editing "this and following": fetch how the series repeats, so it can be shown and changed.
  const seriesId = existing?.series_id ?? null;
  useEffect(() => {
    if (!seriesId || scope !== "series" || loadedRep !== null) return;
    let live = true;
    const read = (cols: string) => supabase.from("appointment_series").select(cols).eq("id", seriesId).maybeSingle();
    (async () => {
      let res = await read("rule, weekdays, end_date");
      if (res.error) res = await read("weekdays, end_date"); // before 0013_repeat_rule.sql there is no rule column
      if (!live || !res.data) return;
      const c = choiceFromSeries(res.data as unknown as { rule?: unknown; weekdays: number[]; end_date: string });
      setRep(c);
      setLoadedRep(JSON.stringify(c));
      setMore(true); // the Repeat section sits under More options
    })();
    return () => { live = false; };
  }, [seriesId, scope, loadedRep, supabase]);
  // On a series, a changed repeat (or first date) means the run from here on is made again, not just edited in place.
  const rebuild = !!seriesId && scope === "series" && loadedRep !== null && (repKey !== loadedRep || date !== DateTime.fromISO(existing!.starts_at).setZone(tz).toISODate());

  const interval = useMemo(() => toInterval(date, start, end, tz), [date, start, end, tz]);

  const goingKey = going.join(",");
  useEffect(() => {
    if (!ctx.people || !circleId || !going.length || !interval.valid) return setBusy([]);
    let live = true;
    supabase
      .rpc("circle_busy", { p_circle: circleId, p_users: going, p_from: interval.start.toUTC().toISO(), p_to: interval.end.toUTC().toISO(), p_exclude: existing?.id ?? null })
      .then(({ data }: { data: unknown }) => { if (live) setBusy((data as typeof busy | null) ?? []); });
    return () => { live = false; };
  }, [circleId, goingKey, interval]); // eslint-disable-line react-hooks/exhaustive-deps

  // After the appointment itself is saved: record who is going, on one appointment or a run of a series.
  async function saveGoing(target: { p_appt?: string; p_series?: string; p_from?: string }) {
    if (!ctx.people) return;
    const { error } = await supabase.rpc("set_participants", { p_appt: target.p_appt ?? null, p_series: target.p_series ?? null, p_from: target.p_from ?? null, p_users: circleId && !busyOnly ? going : [] });
    if (error) toast("error", `Saved, but couldn’t set who is going: ${error.message}`);
  }

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
      .eq("user_id", ctx.userId) // only my own can clash; shared ones from others are readable but not mine
      .neq("status", "cancelled")
      .lt("starts_at", toISO)
      .gt("ends_at", fromISO);
    if (error) throw error;
    return (data ?? []) as Appointment[];
  }

  function describe(a: Appointment) {
    return `${typeById.get(a.activity_type_id ?? "")?.name ?? a.custom_activity ?? "Appointment"} “${a.title}”, ${DateTime.fromISO(a.starts_at).setZone(tz).toFormat("ccc d LLL")} ${fmtRange(a.starts_at, a.ends_at, tz)}`;
  }

  function validate(): string | null {
    if (!typeId && !customActivity?.trim()) return "Choose an activity, or type one for this appointment.";
    if (!date) return "Choose a date.";
    if (!start || !end) return "Enter a start and end time.";
    if (!interval.valid) return "That date or time isn’t valid.";
    if (start === end) return "The end time must be after the start time.";
    if (repeat) {
      if (rep.freq === "weekly" && !rep.weekdays.length) return "Pick at least one weekday to repeat on.";
      if (rep.ends === "on" && !rep.until) return "Choose when the repeat ends.";
      if (rep.ends === "on" && rep.until < date) return "The repeat end date must be on or after the first date.";
    }
    return null;
  }

  function fields() {
    return {
      activity_type_id: typeId || null,
      custom_activity: typeId ? null : customActivity?.trim() || null,
      place_id: placeId || null,
      custom_place: placeId ? null : customPlace?.trim() || null,
      // Sent only when the database has the sharing columns.
      ...(ctx.sharing ? { circle_id: circleId || null } : {}),
      ...(ctx.replies ? { busy_only: !!circleId && busyOnly } : {}),
      title: finalTitle,
      status,
      team: team.trim() || null,
      notes: notes.trim() || null,
      reminder_minutes: reminder,
    };
  }

  async function handleDbError(err: { code?: string; message?: string }) {
    if (err.code === "42703" || err.code === "PGRST204" || err.code === "23502") {
      // Unknown column, or activity still required: the custom activity/place migration has not been run.
      setError("A one-off activity or place needs a one-time database update first: run supabase/migrations/0003_custom_activity_place.sql (or 0006_sharing.sql, if you are sharing with a circle) in the Supabase SQL editor.");
    } else if (isOverlapError(err)) {
      setError(`Another ${type?.name ?? "appointment of this type"} was just saved at an overlapping time, possibly from another device. Nothing was saved. Pick a different time.`);
    } else {
      setError(`Couldn’t save: ${err.message ?? "unknown error"}. Your changes are still here; try again.`);
    }
  }

  async function saveSingle(ack: boolean) {
    const cand = { id: existing?.id, activity_type_id: typeId || null, starts_at: interval.start.toUTC().toISO()!, ends_at: interval.end.toUTC().toISO()!, status };
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
      await saveGoing({ p_appt: existing.id });
      await refresh();
      toast("ok", "Appointment updated");
      onDone(date);
    } else {
      const { data, error } = await supabase
        .from("appointments")
        .insert({ ...row, client_request_id: requestId.current })
        .select("id")
        .single();
      if (error) {
        if (error.code === "23505") {
          // Same request already saved (double tap or retry): treat as success.
          await refresh();
          return onDone(date);
        }
        return handleDbError(error);
      }
      await saveGoing({ p_appt: data.id });
      await refresh();
      toast("ok", "Appointment saved");
      onDone(date);
    }
  }

  async function reviewSeries(): Promise<OccReview[] | null> {
    // "Never" on a series being changed leaves just this one appointment.
    const occ = repeat ? expandRule(rule) : [{ date, starts_at: interval.start.toUTC().toISO()!, ends_at: interval.end.toUTC().toISO()! }];
    if (!occ.length) {
      setError("No date matches that repeat before it ends.");
      return null;
    }
    // When a series is made again from here on, the appointments it replaces cannot clash with the new ones.
    let replaced: string[] = [];
    if (rebuild) {
      const { data, error } = await supabase.from("appointments").select("id").eq("series_id", seriesId!).gte("starts_at", existing!.starts_at);
      if (error) throw error;
      replaced = (data ?? []).map((x: { id: string }) => x.id);
    }
    const overlapping = await fetchOverlapping(occ[0].starts_at, occ[occ.length - 1].ends_at);
    return occ.map((o) => {
      const r = findConflicts({ activity_type_id: typeId || null, starts_at: o.starts_at, ends_at: o.ends_at, status }, overlapping, replaced);
      return { ...o, blocking: r.blocking, warnings: r.warnings, skip: r.blocking.length > 0 };
    });
  }

  async function saveSeries(rev: OccReview[]) {
    const keep = rev.filter((r) => !r.skip);
    if (!keep.length) {
      setError("Every date is skipped, so there is nothing to save.");
      return;
    }
    const args = {
      series: { weekdays: rep.freq === "weekly" ? rep.weekdays : [], start_date: date, end_date: rev[rev.length - 1].date, start_time: start, end_time: end, time_zone: tz },
      template: fields(),
      occurrences: keep.map((k) => ({ starts_at: k.starts_at, ends_at: k.ends_at })),
    };
    // Changing a series: this appointment and the ones after it are removed and the new run saved, in one step in the database.
    const { data, error } = rebuild
      ? await supabase.rpc("replace_series_from", { p_series: seriesId, p_from: existing!.starts_at, ...args })
      : await supabase.rpc("create_appointment_series", args);
    if (error) {
      if (error.code === "PGRST202") return setError("Changing how a series repeats needs a one-time database update first: run supabase/migrations/0014_series_edit.sql in the Supabase SQL editor.");
      return handleDbError(error);
    }
    // Keep the rule with the series. Without 0013_repeat_rule.sql the column is missing and this is skipped; the appointments are saved either way.
    if (repeat) await supabase.from("appointment_series").update({ rule: storedRule(rep, date) }).eq("id", data as string);
    await saveGoing({ p_series: data as string });
    await refresh();
    const skipped = rev.length - keep.length;
    toast("ok", `Saved ${keep.length} appointment${keep.length > 1 ? "s" : ""}${skipped ? `, skipped ${skipped}` : ""}`);
    onDone(keep[0] ? DateTime.fromISO(keep[0].starts_at).setZone(tz).toISODate()! : undefined); // first of the series
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
      const r = findConflicts({ ...c, activity_type_id: typeId || null, status }, overlapping, ids);
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
    await saveGoing({ p_series: existing.series_id!, p_from: existing.starts_at });
    await refresh();
    toast("ok", `Updated ${changes.length} appointment${changes.length > 1 ? "s" : ""} in the series`);
    onDone(date);
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
      if (existing && existing.series_id && scope === "series" && !rebuild) {
        await saveSeriesEdit(!!opts.ack);
      } else if (rebuild || (!existing && repeat)) {
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

  // Create an activity type without leaving the form, then select it.
  async function addType() {
    if (!newType) return;
    const name = newType.name.trim();
    if (!name) return setError("Give the activity a name.");
    if (types.some((t) => !t.archived_at && t.name.toLowerCase() === name.toLowerCase())) return setError("You already have an activity type with that name.");
    const { data, error } = await supabase.from("activity_types").insert({ name, color: newType.color }).select("id").single();
    if (error) return setError(`Couldn’t save the activity: ${error.message}`);
    await refresh();
    setTypeId(data.id);
    setNewType(null);
    setError(null);
  }

  const inSeriesScope = !!existing?.series_id && scope === "series";

  // "1 h 30 min", shown on the preview.
  const mins = interval.valid ? Math.round(interval.end.diff(interval.start, "minutes").minutes) : 0;
  const length = mins <= 0 ? "" : `${mins >= 60 ? `${Math.floor(mins / 60)} h` : ""}${mins % 60 ? ` ${mins % 60} min` : ""}`.trim();

  // What else is on the chosen day, so the bar under the times can show where this one falls among them.
  const dayStart = DateTime.fromISO(date, { zone: tz }).startOf("day");
  const sameDay = ctx.appointments.filter((a) => a.id !== existing?.id && a.status !== "cancelled" && !a.busy
    && DateTime.fromISO(a.starts_at) < dayStart.plus({ days: 1 }) && DateTime.fromISO(a.ends_at) > dayStart);

  return (
    <form className="form" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
      {/* The appointment as it will look, filling in as you choose. The title is edited right on it. */}
      <div className={`details-head form-preview act-${type?.color ?? "slate"} ${status === "tentative" ? "status-tentative" : ""}`}>
        <span className="type-label"><span className="swatch" aria-hidden />{activityName || "Choose an activity"}</span>
        <input
          className="preview-title"
          aria-label="Title"
          value={titleEdited ? title : generatedTitle}
          placeholder={generatedTitle || "Title"}
          onChange={(e) => { setTitleEdited(true); setTitle(e.target.value); }}
        />
        {titleEdited && generatedTitle && title !== generatedTitle && (
          <button type="button" className="link" onClick={() => { setTitleEdited(false); setTitle(""); }}>Use “{generatedTitle}”</button>
        )}
        <p className="details-when">
          {interval.valid ? (
            <>
              {interval.start.toFormat("cccc, d LLLL")}
              <br />
              {interval.start.toFormat("h:mm a")} – {interval.end.toFormat("h:mm a")} <span className="preview-length">{length}</span>
            </>
          ) : "Pick a date and time"}
          {placeName && <><br />{placeName}</>}
        </p>
      </div>

      {existing?.series_id && (
        <fieldset className="field">
          <legend><Named icon="repeat">Apply changes to</Named></legend>
          <div className="segmented">
            <button type="button" className={scope === "one" ? "is-active" : ""} aria-pressed={scope === "one"} onClick={() => setScope("one")}>This appointment</button>
            <button type="button" className={scope === "series" ? "is-active" : ""} aria-pressed={scope === "series"} onClick={() => setScope("series")}>This and following</button>
          </div>
        </fieldset>
      )}

      <fieldset className="field">
        <legend><Named icon="tag">Activity</Named></legend>
        {/* One line to type a one-off, with the saved activities as small picks under it. */}
        <input
          value={type?.name ?? customActivity ?? ""}
          onChange={(e) => { setTypeId(""); setCustomActivity(e.target.value); }}
          placeholder="Type an activity, or pick one"
          maxLength={100}
          aria-label="Activity"
        />
        <div className="chips chips-xs">
          {activeTypes.map((t) => (
            <button type="button" key={t.id} className={`chip act-${t.color} ${typeId === t.id ? "is-selected" : ""}`} aria-pressed={typeId === t.id} onClick={() => { setTypeId(t.id); setCustomActivity(null); }}>
              <span className="swatch" aria-hidden /> {t.name}
            </button>
          ))}
          {!newType && <button type="button" className="chip chip-dashed" onClick={() => setNewType(blankType())}>＋ Save a new one</button>}
        </div>
        {!typeId && customActivity?.trim() && <p className="hint">Only for this one. Not saved to your activities.</p>}
        {newType && (
          <div className="subform">
            <label className="field"><span>Activity name</span><input value={newType.name} onChange={(e) => setNewType({ ...newType, name: e.target.value })} placeholder="Cricket" autoFocus /></label>
            <ColorPicker value={newType.color} onChange={(color) => setNewType({ ...newType, color })} />
            <div className="row">
              <button type="button" className="btn" onClick={addType}>Save activity</button>
              <button type="button" className="btn btn-ghost" onClick={() => setNewType(null)}>Cancel</button>
            </div>
          </div>
        )}
      </fieldset>

      <fieldset className="field">
        <legend><Named icon="clock">When</Named></legend>
        <div className="chips">
          <button type="button" disabled={inSeriesScope} className={`chip ${date === today ? "is-selected" : ""}`} aria-pressed={date === today} onClick={() => setDate(today)}>Today</button>
          <button type="button" disabled={inSeriesScope} className={`chip ${date === tomorrow ? "is-selected" : ""}`} aria-pressed={date === tomorrow} onClick={() => setDate(tomorrow)}>Tomorrow</button>
          <input type="date" disabled={inSeriesScope} aria-label="Date" value={date} onChange={(e) => setDate(e.target.value)} className="input-inline" />
        </div>
        {inSeriesScope && <p className="hint">Dates stay the same for each occurrence; only the times change.</p>}
        <div className="time-row">
          <input type="time" required aria-label="Start" value={start} onChange={(e) => onStartChange(e.target.value)} />
          <span className="muted">to</span>
          <input type="time" required aria-label="End" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
        {/* The day as a bar: what is already booked, and this appointment outlined among it. */}
        {interval.valid && <DayBar appts={sameDay} typeById={typeById} day={date} tz={tz} ghost={{ from: interval.start, to: interval.end }} />}
      </fieldset>
      {interval.valid && interval.nextDay && start !== end && <p className="hint">Ends the next day, {interval.end.toFormat("ccc d LLL, h:mm a")}.</p>}

      <fieldset className="field">
        <legend><Named icon="pin">Place</Named></legend>
        <input
          value={place?.name ?? customPlace ?? ""}
          onChange={(e) => { setPlaceId(""); setCustomPlace(e.target.value); }}
          placeholder="Type a place, or pick one (optional)"
          maxLength={200}
          aria-label="Place"
        />
        <div className="chips chips-xs">
          {activePlaces.map((p) => (
            <button type="button" key={p.id} className={`chip ${placeId === p.id ? "is-selected" : ""}`} aria-pressed={placeId === p.id} onClick={() => { setPlaceId(placeId === p.id ? "" : p.id); setCustomPlace(null); }}>{p.name}</button>
          ))}
          {!newPlace && <button type="button" className="chip chip-dashed" onClick={() => setNewPlace({ name: "", url: "" })}>＋ Save a new one</button>}
        </div>
        {!placeId && customPlace?.trim() && <p className="hint">Only for this one. Not saved to your places.</p>}
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

      {ctx.sharing && circles.length > 0 && (
        <fieldset className="field">
          <legend><Named icon="people">Share with</Named></legend>
          <div className="chips chips-xs" style={{ marginTop: 0 }}>
            <button type="button" className={`chip ${!circleId ? "is-selected" : ""}`} aria-pressed={!circleId} onClick={() => share("")}>Just me</button>
            {circles.map((c) => (
              <button type="button" key={c.id} className={`chip ${circleId === c.id ? "is-selected" : ""}`} aria-pressed={circleId === c.id} onClick={() => share(c.id)}>{c.name}</button>
            ))}
          </div>
          {circleId && ctx.replies && (
            <div className="row seat-role">
              <span className="muted">They see</span>
              <span className="chips chips-xs" role="group" aria-label="What the circle sees">
                <button type="button" className={`chip ${!busyOnly ? "is-selected" : ""}`} aria-pressed={!busyOnly} onClick={() => setBusyOnly(false)}>Everything</button>
                <button type="button" className={`chip ${busyOnly ? "is-selected" : ""}`} aria-pressed={busyOnly} onClick={() => setBusyOnly(true)}>Busy only</button>
              </span>
            </div>
          )}
          {circleId && <span className="hint">{busyOnly && ctx.replies
            ? `${circles.find((c) => c.id === circleId)?.name} sees only that you are busy then.`
            : `Everyone in ${circles.find((c) => c.id === circleId)?.name} sees it. Only you can change it.`}</span>}
        </fieldset>
      )}

      {ctx.people && circleId && others.length > 0 && !(busyOnly && ctx.replies) && (
        <fieldset className="field">
          <legend><Named icon="people">Who is going</Named></legend>
          <div className="chips chips-xs" style={{ marginTop: 0 }}>
            <span className="chip is-selected going-you">You</span>
            {others.map((m) => {
              const on = going.includes(m.user_id);
              return (
                <button type="button" key={m.user_id} className={`chip ${on ? "is-selected" : ""}`} aria-pressed={on} title={m.email} onClick={() => setGoing(on ? going.filter((x) => x !== m.user_id) : [...going, m.user_id])}>
                  <span className={`who act-${m.color}`} aria-hidden>{m.letter}</span> {m.email.split("@")[0]}
                </button>
              );
            })}
          </div>
          {busy.map((b) => (
            <span key={b.user_id + b.starts_at} className="hint busy-note">{others.find((m) => m.user_id === b.user_id)?.email.split("@")[0] ?? "Someone"} is busy {fmtRange(b.starts_at, b.ends_at, tz)}.</span>
          ))}
          {going.length > 0 && <span className="hint">It goes in their calendar too, with their own reminder.</span>}
        </fieldset>
      )}

      <label className="field"><span><Named icon="note">Notes</Named></span><textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What to bring, who to call" /></label>

      {/* Folded, the three settings inside show as chips, so nothing has to be opened just to check it. */}
      <button type="button" className="disclosure more-toggle" aria-expanded={more} onClick={() => setMore(!more)}>
        <span>{more ? "▾" : "▸"} More</span>
        {!more && (
          <span className="chips chips-xs">
            <span className={`chip ${status === "tentative" ? "chip-dashed" : ""}`}>{status === "tentative" ? "Tentative" : "Confirmed"}</span>
            <span className="chip"><Named icon="bell">{reminderLabel(reminder)}</Named></span>
            {repeat && <span className="chip"><Named icon="repeat">Repeats</Named></span>}
          </span>
        )}
      </button>

      {more && (
        <div className="stack reveal" ref={moreRef}>
          {/* Each choice carries a sample of how the appointment will be drawn on the calendar: solid, or dashed. */}
          <fieldset className="field">
            <legend><Named icon="check">Status</Named></legend>
            <div className="status-pick">
              {([["confirmed", "Confirmed"], ["tentative", "Tentative"]] as const).map(([s, label]) => (
                <button type="button" key={s} className={`status-opt is-${s} ${status === s ? "is-selected" : ""}`} aria-pressed={status === s} onClick={() => setStatus(s)}>
                  <span className="status-sample" aria-hidden />
                  <span className="add-label">{label}</span>
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className="field">
            <legend><Named icon="bell">Reminder</Named></legend>
            <ReminderPicker value={reminder} onChange={setReminder} />
          </fieldset>

          {(!existing || (scope === "series" && loadedRep !== null)) && (
            <RepeatPicker
              value={rep} onChange={setRep} date={date} startTime={start} endTime={end} tz={tz} noun="appointment"
              note={rebuild && <span className="hint">Saving replaces this appointment and the ones after it with this new run. Earlier ones stay as they are.</span>}
            />
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
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? "Saving…" : review ? "Save remaining dates" : existing ? "Save changes" : "Save"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

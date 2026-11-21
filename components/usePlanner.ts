"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DateTime } from "luxon";
import { supabaseBrowser } from "@/lib/supabase/client";
import { deviceTimeZone } from "@/lib/time";
import type { ActivityType, Appointment, Place, Profile, Task } from "@/lib/types";

export const APPT_FIELDS =
  "id, user_id, activity_type_id, place_id, series_id, title, starts_at, ends_at, status, team, notes, reminder_minutes";
export const TASK_FIELDS = "id, user_id, title, due_date, due_time, notify_at, notes, state, completed_at";

export interface Toast {
  id: number;
  kind: "ok" | "error" | "info";
  text: string;
}

export function usePlanner() {
  const supabase = supabaseBrowser();
  const [email, setEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  // Every activity type and place this user can read: their own, plus those on appointments shared with their circles.
  const [allTypes, setAllTypes] = useState<ActivityType[]>([]);
  const [allPlaces, setAllPlaces] = useState<Place[]>([]);
  // True once the database is known to have the sharing columns (0006_sharing.sql). Until then nothing offers or sends circle_id.
  const [sharing, setSharing] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [types, setTypes] = useState<ActivityType[]>([]);
  const [places, setPlaces] = useState<Place[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  const tz = profile?.time_zone || deviceTimeZone();

  const toast = useCallback((kind: Toast["kind"], text: string) => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-1), { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 7000 : 2500);
  }, []);

  const loadBase = useCallback(async () => {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) {
      window.location.href = "/login";
      return;
    }
    setEmail(auth.user.email ?? null);
    setUserId(auth.user.id);
    const uid = auth.user.id;
    const since = DateTime.now().minus({ days: 60 }).toISODate();
    const loadTasks = (fields: string) =>
      supabase.from("tasks").select(fields).or(`state.eq.pending,due_date.gte.${since}`).order("due_date").order("due_time", { nullsFirst: true });
    let [p, t, pl, tk] = await Promise.all([
      supabase.from("profiles").select("user_id, time_zone, default_reminder_minutes, show_cancelled").maybeSingle(),
      supabase.from("activity_types").select("id, user_id, name, color, archived_at").order("name"),
      supabase.from("places").select("id, user_id, name, maps_url, notes, archived_at").order("name"),
      loadTasks(`${TASK_FIELDS}, circle_id`),
    ]);
    // 42703 = unknown column: the sharing migration has not been run yet.
    if (tk.error?.code === "42703") tk = await loadTasks(TASK_FIELDS);
    const err = p.error || t.error || pl.error || tk.error;
    if (err) {
      setLoadError(err.message);
      return;
    }
    let prof = p.data as Profile | null;
    if (!prof) {
      const ins = await supabase
        .from("profiles")
        .upsert({ user_id: auth.user.id, time_zone: deviceTimeZone() })
        .select("user_id, time_zone, default_reminder_minutes, show_cancelled")
        .single();
      prof = ins.data as Profile | null;
    } else if (!prof.time_zone) {
      // First visit: start from the device's time zone; it can be reviewed in Settings.
      const tzNow = deviceTimeZone();
      await supabase.from("profiles").update({ time_zone: tzNow }).eq("user_id", prof.user_id);
      prof = { ...prof, time_zone: tzNow };
    }
    setProfile(prof);
    const readableTypes = (t.data ?? []) as ActivityType[];
    const readablePlaces = (pl.data ?? []) as Place[];
    setAllTypes(readableTypes);
    setAllPlaces(readablePlaces);
    // The lists and pickers only ever offer the user's own.
    setTypes(readableTypes.filter((x) => x.user_id === uid));
    setPlaces(readablePlaces.filter((x) => x.user_id === uid));
    setTasks((tk.data ?? []) as unknown as Task[]);
    setLoadError(null);
  }, [supabase]);

  const loadAppointments = useCallback(
    async (r: { from: string; to: string }) => {
      const query = (fields: string) =>
        supabase.from("appointments").select(fields).lt("starts_at", r.to).gt("ends_at", r.from).order("starts_at");
      // 42703 = unknown column: a later migration has not been run yet. Fall back to fewer columns so the calendar still works.
      let { data, error } = await query(`${APPT_FIELDS}, outcome, outcome_reason, custom_activity, custom_place, circle_id`);
      setSharing(!error);
      if (error?.code === "42703") ({ data, error } = await query(`${APPT_FIELDS}, outcome, outcome_reason, custom_activity, custom_place`));
      if (error?.code === "42703") ({ data, error } = await query(`${APPT_FIELDS}, outcome, outcome_reason`));
      if (error?.code === "42703") ({ data, error } = await query(APPT_FIELDS));
      if (error) {
        setLoadError(error.message);
        return;
      }
      setAppointments((data ?? []) as unknown as Appointment[]);
    },
    [supabase],
  );

  useEffect(() => {
    (async () => {
      await loadBase();
      setLoading(false);
    })();
  }, [loadBase]);

  useEffect(() => {
    if (range) loadAppointments(range);
  }, [range, loadAppointments]);

  // Refresh when returning to the tab so edits from another device show up.
  useEffect(() => {
    const onFocus = () => {
      if (document.visibilityState !== "visible") return;
      loadBase();
      if (range) loadAppointments(range);
    };
    document.addEventListener("visibilitychange", onFocus);
    return () => document.removeEventListener("visibilitychange", onFocus);
  }, [loadBase, loadAppointments, range]);

  const refresh = useCallback(async () => {
    await Promise.all([loadBase(), range ? loadAppointments(range) : Promise.resolve()]);
  }, [loadBase, loadAppointments, range]);

  // Shared by the Tasks page and the Day view's task rows.
  const completeTask = useCallback(
    async (t: Task) => {
      const { error } = await supabase.from("tasks").update({ state: "completed", completed_at: new Date().toISOString() }).eq("id", t.id);
      if (error) return toast("error", `Couldn’t update: ${error.message}`);
      await refresh();
      toast("ok", `Done: ${t.title}`);
    },
    [supabase, toast, refresh],
  );

  const typeById = useMemo(() => new Map(allTypes.map((t) => [t.id, t])), [allTypes]);
  const placeById = useMemo(() => new Map(allPlaces.map((p) => [p.id, p])), [allPlaces]);

  return {
    supabase,
    email,
    userId,
    sharing,
    profile,
    setProfile,
    tz,
    types,
    places,
    tasks,
    appointments,
    typeById,
    placeById,
    setRange,
    loading,
    loadError,
    refresh,
    completeTask,
    toasts,
    toast,
  };
}

export type PlannerCtx = ReturnType<typeof usePlanner>;

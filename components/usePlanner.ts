"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DateTime } from "luxon";
import { supabaseBrowser } from "@/lib/supabase/client";
import { deviceTimeZone } from "@/lib/time";
import type { ActivityType, Appointment, Place, Profile, Task } from "@/lib/types";

export const APPT_FIELDS =
  "id, activity_type_id, place_id, series_id, title, starts_at, ends_at, status, team, notes, reminder_minutes";
export const TASK_FIELDS = "id, title, due_date, due_time, notify_at, notes, state, completed_at";

export interface Toast {
  id: number;
  kind: "ok" | "error" | "info";
  text: string;
}

export function usePlanner() {
  const supabase = supabaseBrowser();
  const [email, setEmail] = useState<string | null>(null);
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
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 7000 : 3500);
  }, []);

  const loadBase = useCallback(async () => {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) {
      window.location.href = "/login";
      return;
    }
    setEmail(auth.user.email ?? null);
    const since = DateTime.now().minus({ days: 60 }).toISODate();
    const [p, t, pl, tk] = await Promise.all([
      supabase.from("profiles").select("user_id, time_zone, default_reminder_minutes, show_cancelled").maybeSingle(),
      supabase.from("activity_types").select("id, name, color, archived_at").order("name"),
      supabase.from("places").select("id, name, maps_url, notes, archived_at").order("name"),
      supabase
        .from("tasks")
        .select(TASK_FIELDS)
        .or(`state.eq.pending,due_date.gte.${since}`)
        .order("due_date")
        .order("due_time", { nullsFirst: true }),
    ]);
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
    setTypes((t.data ?? []) as ActivityType[]);
    setPlaces((pl.data ?? []) as Place[]);
    setTasks((tk.data ?? []) as Task[]);
    setLoadError(null);
  }, [supabase]);

  const loadAppointments = useCallback(
    async (r: { from: string; to: string }) => {
      const { data, error } = await supabase
        .from("appointments")
        .select(APPT_FIELDS)
        .lt("starts_at", r.to)
        .gt("ends_at", r.from)
        .order("starts_at");
      if (error) {
        setLoadError(error.message);
        return;
      }
      setAppointments((data ?? []) as Appointment[]);
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

  const typeById = useMemo(() => new Map(types.map((t) => [t.id, t])), [types]);
  const placeById = useMemo(() => new Map(places.map((p) => [p.id, p])), [places]);

  return {
    supabase,
    email,
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
    toasts,
    toast,
  };
}

export type PlannerCtx = ReturnType<typeof usePlanner>;

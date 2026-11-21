"use client";
import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Circle, CircleInvite } from "@/lib/circles";

// Circles the user belongs to, and the invites they can see (addressed to them, or sent from a circle they own).
// `missing` is true when the circles tables do not exist yet (migration 0005 not run); the rest of the app is unaffected.
export function useCircles(supabase: SupabaseClient) {
  const [circles, setCircles] = useState<Circle[]>([]);
  const [invites, setInvites] = useState<CircleInvite[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [c, i] = await Promise.all([
      supabase.from("circles").select("id, name, owner_id, circle_members(user_id, email, role)").order("created_at"),
      supabase.from("circle_invites").select("id, token, circle_id, circle_name, inviter_email, email, role, expires_at, accepted_at, declined_at").order("created_at"),
    ]);
    const err = c.error ?? i.error;
    if (err) {
      // 42P01 / PGRST205: the table does not exist yet.
      if (err.code === "42P01" || err.code === "PGRST205") setMissing(true);
      else setError(err.message);
    } else {
      setCircles((c.data ?? []) as Circle[]);
      setInvites((i.data ?? []) as CircleInvite[]);
      setMissing(false);
      setError(null);
    }
    setReady(true);
  }, [supabase]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
    reload();
  }, [supabase, reload]);

  return { circles, invites, userId, ready, missing, error, reload };
}

export type CirclesState = ReturnType<typeof useCircles>;

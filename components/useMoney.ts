"use client";
import { useCallback, useEffect, useState } from "react";
import type { PlannerCtx } from "./usePlanner";
import type { Bank, Increase, MoneyEntry, MoneyItem, MoneyType, Person } from "@/lib/money";

export type Mode = "time" | "money";
// "missing": the database has no Money tables yet (0015_money.sql not run). "off": not turned on by this person.
export type MoneyStatus = "loading" | "missing" | "off" | "on";

const EMPTY = { banks: [] as Bank[], types: [] as MoneyType[], increases: [] as Increase[], people: [] as Person[], items: [] as MoneyItem[], entries: [] as MoneyEntry[], planned: [] as string[] };

/** Everything the Money side needs: whether it is on, the mode last used, and the budget itself. */
export function useMoney(ctx: PlannerCtx) {
  const { supabase, userId } = ctx;
  const [status, setStatus] = useState<MoneyStatus>("loading");
  const [lastMode, setLastMode] = useState<Mode>("time");
  const [data, setData] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    const [sub, prof] = await Promise.all([
      supabase.from("subscriptions").select("status").eq("product", "money").maybeSingle(),
      supabase.from("profiles").select("last_mode").maybeSingle(),
    ]);
    if (sub.error) return setStatus("missing");
    if (prof.data?.last_mode === "money") setLastMode("money");
    if (sub.data?.status !== "active") return setStatus("off");
    // The API returns at most 1000 rows a request, and an imported budget has more month entries than that.
    const allEntries = async () => {
      const rows: MoneyEntry[] = [];
      for (;;) {
        const page = await supabase.from("money_entries").select("item_id, month, budget, actual, paid_at, skipped").order("item_id").order("month").range(rows.length, rows.length + 999);
        if (page.error) return { data: rows, error: page.error };
        rows.push(...(page.data as MoneyEntry[]));
        if (page.data.length < 1000) return { data: rows, error: null };
      }
    };
    // shortcut: loads every item and month entry at once, fine for one household; load entries by month range if this grows past a few thousand rows
    const [banks, types, increases, people, items, entries, months] = await Promise.all([
      supabase.from("money_banks").select("id, name, balance, balance_at, archived_at").order("name"),
      supabase.from("money_types").select("id, name, kind, archived_at").order("name"),
      supabase.from("money_increases").select("id, name, percent, archived_at").order("percent"),
      supabase.from("money_people").select("id, name, relationship, archived_at").order("created_at"),
      supabase.from("money_items").select("id, kind, name, amount, freq, start_date, end_date, bank_id, type_id, increase_id, person_ids, notes").order("name"),
      allEntries(),
      supabase.from("money_months").select("month"),
    ]);
    const err = banks.error || types.error || increases.error || people.error || items.error || entries.error || months.error;
    setError(err?.message ?? null);
    if (!err) {
      setData({
        banks: banks.data as Bank[], types: types.data as MoneyType[], increases: increases.data as Increase[], people: people.data as Person[],
        items: items.data as MoneyItem[], entries: entries.data as MoneyEntry[], planned: (months.data as { month: string }[]).map((m) => m.month.slice(0, 7)),
      });
    }
    setStatus("on");
  }, [supabase, userId]);

  useEffect(() => {
    load();
  }, [load]);

  // Remembered on the profile, so the same side opens next time on any device. A failure here only loses the memory.
  const rememberMode = useCallback(
    async (mode: Mode) => {
      setLastMode(mode);
      if (userId && status !== "missing") await supabase.from("profiles").update({ last_mode: mode }).eq("user_id", userId);
    },
    [supabase, userId, status],
  );

  return { status, lastMode, rememberMode, error, reload: load, ...data };
}

export type MoneyCtx = ReturnType<typeof useMoney>;

"use client";
import { useCallback, useEffect, useState } from "react";
import type { PlannerCtx } from "./usePlanner";
import type { Bank, Increase, MoneyEntry, MoneyItem, MoneyType, Person, Proposal } from "@/lib/money";

export type Mode = "time" | "money";
// "missing": the database has no Money tables yet (0015_money.sql not run). "off": not turned on by this person.
export type MoneyStatus = "loading" | "missing" | "off" | "on";
/** A person's mark that a month is planned: private (circle_id null), or their part of a circle's agreement. */
export interface PlannedMark { month: string; circle_id: string | null; user_id: string }

const EMPTY = {
  banks: [] as Bank[], types: [] as MoneyType[], increases: [] as Increase[], people: [] as Person[], items: [] as MoneyItem[], entries: [] as MoneyEntry[],
  months: [] as PlannedMark[], proposals: [] as Proposal[], approvals: [] as { proposal_id: string; user_id: string }[],
  family: [] as string[], // circles whose family plan is on
  shared: false, // true once the database has shared budgets (0017_money_shared.sql)
  steps: false, // true once an item can change its amount from a date (0020_money_amount_steps.sql)
  loans: false, // true once an item can be a loan (0021_money_loans.sql)
};

/** Everything the Money side needs: whether it is on, the mode last used, and every budget this person can read. */
export function useMoney(ctx: PlannerCtx) {
  const { supabase, userId } = ctx;
  const [status, setStatus] = useState<MoneyStatus>("loading");
  const [lastMode, setLastMode] = useState<Mode>("time");
  const [data, setData] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    const subs = (shared: boolean) => supabase.from("subscriptions").select(shared ? "status, circle_id" : "status").eq("product", "money").eq("status", "active");
    // Newest shape first; without 0017 the sharing columns do not exist, so fall back to the private budget.
    let shared = true;
    let sub = await subs(true);
    if (sub.error) {
      shared = false;
      sub = await subs(false);
    }
    const prof = await supabase.from("profiles").select("last_mode").maybeSingle();
    if (sub.error) return setStatus("missing");
    if (prof.data?.last_mode === "money") setLastMode("money");
    const active = (sub.data ?? []) as unknown as { circle_id?: string | null }[];
    if (!active.length) return setStatus("off");
    const c = shared ? ", circle_id" : "";
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
    // Newest shape first; without 0020 there is no amount_steps column, so ask again without it.
    // Likewise loan, without 0021.
    const loadItems = (steps: boolean, loans = false) => supabase.from("money_items").select(`id, kind, name, amount, freq, start_date, end_date, bank_id, type_id, increase_id, person_ids, notes${c}${steps ? ", amount_steps" : ""}${loans ? ", loan" : ""}`).order("name");
    // shortcut: loads every item and month entry at once, fine for one household; load entries by month range if this grows past a few thousand rows
    const [banks, types, increases, people, items, entries, months, proposals, approvals] = await Promise.all([
      supabase.from("money_banks").select(`id, user_id, name, balance, balance_at, archived_at${c}`).order("name"),
      supabase.from("money_types").select(`id, name, kind, archived_at${c}`).order("name"),
      supabase.from("money_increases").select(`id, name, percent, archived_at${c}`).order("percent"),
      supabase.from("money_people").select(`id, name, relationship, archived_at${shared ? ", circle_id, member_id" : ""}`).order("created_at"),
      loadItems(true, true),
      allEntries(),
      supabase.from("money_months").select(`month, user_id${c}`),
      shared ? supabase.from("money_proposals").select("id, circle_id, item_id, action, payload, created_by, status, reason").in("status", ["pending", "rejected"]).order("created_at") : { data: [], error: null },
      shared ? supabase.from("money_approvals").select("proposal_id, user_id") : { data: [], error: null },
    ]);
    let steps = !items.error;
    const loans = !items.error;
    let itemRows = items;
    if (items.error) {
      itemRows = await loadItems(true);
      steps = !itemRows.error;
      if (itemRows.error) itemRows = await loadItems(false);
    }
    const err = banks.error || types.error || increases.error || people.error || itemRows.error || entries.error || months.error || proposals.error || approvals.error;
    setError(err?.message ?? null);
    if (!err) {
      setData({
        banks: banks.data as unknown as Bank[], types: types.data as unknown as MoneyType[], increases: increases.data as unknown as Increase[],
        people: people.data as unknown as Person[], items: itemRows.data as unknown as MoneyItem[], entries: entries.data as MoneyEntry[],
        months: (months.data as unknown as PlannedMark[]).map((m) => ({ month: m.month.slice(0, 7), circle_id: m.circle_id ?? null, user_id: m.user_id })),
        proposals: proposals.data as Proposal[], approvals: approvals.data as { proposal_id: string; user_id: string }[],
        family: active.flatMap((s) => (s.circle_id ? [s.circle_id] : [])), shared, steps, loans,
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

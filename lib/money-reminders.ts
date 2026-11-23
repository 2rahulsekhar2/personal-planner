import { DateTime } from "luxon";
import type { SupabaseClient } from "@supabase/supabase-js";
import { expected, inr, linesDueOn, monthLines, type Increase, type MoneyEntry, type MoneyItem } from "./money";

export interface BillReminder {
  user_id: string;
  money_ref: string; // "bill:<item>:<date>": one reminder a person, an item and a due date
  send_at: string;
  title: string;
  body: string;
}

/** The hour, in each person's own time zone, at which a bill due that day is announced. */
export const BILL_HOUR = 9;

/**
 * The reminders owed for expenses falling due today or tomorrow, as each recipient's time zone counts the days.
 * One goes out at 9 in the morning of the due date, or straight away when that hour has passed and the day has not.
 * Paid and skipped months, incomes, and daily or weekly items (a month's running total, not a bill for a day) get none.
 */
export function billReminders(input: {
  items: (MoneyItem & { user_id: string })[];
  entries: MoneyEntry[];
  increases: Increase[];
  recipients: (item: MoneyItem & { user_id: string }) => string[]; // who is told: the owner, or a circle's owners and members
  zoneOf: (userId: string) => string;
  bankName: (id: string) => string | undefined;
  now: DateTime;
}): BillReminder[] {
  const out: BillReminder[] = [];
  for (const item of input.items) {
    if (item.kind !== "expense") continue;
    for (const user_id of input.recipients(item)) {
      const local = input.now.setZone(input.zoneOf(user_id));
      if (!local.isValid) continue;
      for (const day of [local, local.plus({ days: 1 })]) {
        const date = day.toISODate()!;
        const [line] = linesDueOn(monthLines([item], input.entries, input.increases, date.slice(0, 7)), date);
        if (!line || line.paid) continue;
        const at = DateTime.max(day.set({ hour: BILL_HOUR, minute: 0, second: 0, millisecond: 0 }), input.now);
        const bank = item.bank_id ? input.bankName(item.bank_id) : undefined;
        out.push({
          user_id, money_ref: `bill:${item.id}:${date}`, send_at: at.toUTC().toISO()!,
          title: `${item.name} is due today`,
          body: `${inr(expected(line))}${bank ? ` from ${bank}` : ""}. Open Planner to mark it paid.`,
        });
      }
    }
  }
  return out;
}

/**
 * Writes the bill reminders that are owed and not yet written. Safe to run again and again: a reminder already
 * there (sent, cancelled or waiting) is left as it is. Throws when the database is behind (0019 not run).
 */
export async function planBillReminders(admin: SupabaseClient, now = DateTime.now()) {
  const need = async <T>(q: PromiseLike<{ data: T | null; error: { message: string } | null }>) => {
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data as T;
  };
  const since = now.minus({ days: 2 }).startOf("month").toISODate()!;
  // shortcut: reads every household's budget on each run, fine for a few families; move the due-date maths into SQL or shard by user if this grows
  const [subs, items, entries, increases, banks, members, profiles] = await Promise.all([
    need(admin.from("subscriptions").select("user_id, circle_id").eq("product", "money").eq("status", "active")),
    need(admin.from("money_items").select("id, user_id, circle_id, kind, name, amount, freq, start_date, end_date, bank_id, type_id, increase_id, person_ids, notes")),
    need(admin.from("money_entries").select("item_id, month, budget, actual, paid_at, skipped").gte("month", since)),
    need(admin.from("money_increases").select("id, name, percent, archived_at")),
    need(admin.from("money_banks").select("id, name")),
    need(admin.from("circle_members").select("circle_id, user_id, role, expires_at")),
    need(admin.from("profiles").select("user_id, time_zone")),
  ]);
  type Sub = { user_id: string; circle_id: string | null };
  type Member = { circle_id: string; user_id: string; role: string; expires_at: string | null };
  const families = new Set((subs as Sub[]).flatMap((s) => (s.circle_id ? [s.circle_id] : [])));
  const current = (members as Member[]).filter((m) => families.has(m.circle_id) && (!m.expires_at || Date.parse(m.expires_at) > now.toMillis()));
  // Money is on for a person with their own subscription, or in a circle that has a family plan.
  const on = new Set([...(subs as Sub[]).filter((s) => !s.circle_id).map((s) => s.user_id), ...current.map((m) => m.user_id)]);
  const zones = new Map((profiles as { user_id: string; time_zone: string | null }[]).map((p) => [p.user_id, p.time_zone || "UTC"]));
  const bankNames = new Map((banks as { id: string; name: string }[]).map((b) => [b.id, b.name]));

  const rows = billReminders({
    items: items as (MoneyItem & { user_id: string })[], entries: entries as MoneyEntry[], increases: increases as Increase[], now,
    recipients: (i) => (i.circle_id ? current.filter((m) => m.circle_id === i.circle_id && m.role !== "viewer").map((m) => m.user_id) : on.has(i.user_id) ? [i.user_id] : []),
    zoneOf: (u) => zones.get(u) ?? "UTC",
    bankName: (id) => bankNames.get(id),
  });
  if (rows.length) await need(admin.from("reminders").upsert(rows, { onConflict: "user_id,money_ref", ignoreDuplicates: true }));
  return rows.length;
}

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { sendToUser } from "@/lib/push-server";

export const dynamic = "force-dynamic";

/**
 * Called every minute by a scheduler (Supabase pg_cron, see supabase/cron.sql).
 * Reminders are claimed atomically in Postgres, so overlapping runs never
 * double-send; a reminder that crashes mid-send is retried after 5 minutes.
 */
async function run(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = supabaseAdmin();
  const { data: due, error } = await admin.rpc("claim_due_reminders", { batch_size: 100 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let sent = 0;
  for (const r of due ?? []) {
    try {
      const res = await sendToUser(admin, r.user_id, {
        title: r.title,
        body: r.body,
        tag: r.id,
        url: "/",
      });
      // Only mark sent if still 'sending' (it may have been cancelled meanwhile).
      await admin
        .from("reminders")
        .update({ status: res.delivered > 0 ? "sent" : "failed", sent_at: new Date().toISOString() })
        .eq("id", r.id)
        .eq("status", "sending");
      sent += res.delivered;
    } catch {
      // Leave as 'sending'; claim_due_reminders retries it later (max 3 attempts).
    }
  }
  return NextResponse.json({ claimed: due?.length ?? 0, delivered: sent });
}

export const GET = run;
export const POST = run;

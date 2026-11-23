import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { hashCode } from "@/lib/money-code";

const MAX_ATTEMPTS = 5;

// Checks the emailed code and, when it is right, gives the person their Money subscription.
// This is the only place a subscription is written: the database lets nobody add their own.
export async function POST(request: Request) {
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const body = await request.json().catch(() => null);
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (!/^\d{6}$/.test(code)) return NextResponse.json({ error: "Enter the 6-digit code from the email." }, { status: 400 });

  const admin = supabaseAdmin();
  const { data: row, error } = await admin.from("money_codes").select("code_hash, expires_at, attempts").eq("user_id", auth.user.id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!row || new Date(row.expires_at).getTime() < Date.now() || row.attempts >= MAX_ATTEMPTS) {
    return NextResponse.json({ error: "That code has expired. Send a new one." }, { status: 400 });
  }
  if (!timingSafeEqual(Buffer.from(row.code_hash), Buffer.from(hashCode(auth.user.id, code)))) {
    await admin.from("money_codes").update({ attempts: row.attempts + 1 }).eq("user_id", auth.user.id);
    return NextResponse.json({ error: "That code is not right. Check the email and try again." }, { status: 400 });
  }

  // Insert, or switch an ended one back on. Not an upsert: after 0017 the personal row is unique only through a partial index.
  let sub = await admin.from("subscriptions").insert({ user_id: auth.user.id, product: "money", plan: "personal", status: "active" });
  if (sub.error?.code === "23505") sub = await admin.from("subscriptions").update({ status: "active" }).eq("user_id", auth.user.id).eq("product", "money").eq("plan", "personal");
  if (sub.error) return NextResponse.json({ error: sub.error.message }, { status: 500 });
  await admin.from("money_codes").delete().eq("user_id", auth.user.id);
  return NextResponse.json({ ok: true });
}

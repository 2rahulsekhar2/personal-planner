import { randomInt } from "node:crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { mailReady, sendMoneyCodeEmail } from "@/lib/mail";
import { hashCode } from "@/lib/money-code";

// Emails the signed-in person a 6-digit code. Entering it (see ../activate) turns Money on.
// 501 means the app cannot do this here: no mailbox configured, or 0015_money.sql has not been run.
export async function POST() {
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user?.email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!mailReady()) return NextResponse.json({ error: "Email is not set up on this server, so a code cannot be sent." }, { status: 501 });

  const admin = supabaseAdmin();
  const last = await admin.from("money_codes").select("sent_at").eq("user_id", auth.user.id).maybeSingle();
  if (last.error) return NextResponse.json({ error: "Money is not set up on this server yet." }, { status: 501 });
  if (last.data && Date.now() - new Date(last.data.sent_at).getTime() < 60_000) {
    return NextResponse.json({ error: "A code was just sent. Wait a minute before asking for another." }, { status: 429 });
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const { error } = await admin.from("money_codes").upsert({
    user_id: auth.user.id, code_hash: hashCode(auth.user.id, code), sent_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(), attempts: 0,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  try {
    await sendMoneyCodeEmail(auth.user.email, code);
  } catch (e) {
    console.error("money code email failed", e);
    return NextResponse.json({ error: "The email could not be sent. Check the Gmail settings." }, { status: 502 });
  }
  return NextResponse.json({ ok: true, to: auth.user.email });
}

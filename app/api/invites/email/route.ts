import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { mailReady, sendInviteEmail } from "@/lib/mail";

// Emails an addressed circle invite. 501 means "the app cannot send mail here" (no mailbox configured, or the
// database update is missing); the Circles page then falls back to opening the owner's own mail app.
export async function POST(request: Request) {
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!mailReady()) return NextResponse.json({ error: "Email is not set up" }, { status: 501 });

  const body = await request.json().catch(() => null);
  const token = body?.token;
  if (typeof token !== "string" || !/^[0-9a-f-]{36}$/i.test(token)) return NextResponse.json({ error: "Invalid invite" }, { status: 400 });

  // The database decides: is this the owner's open invite, and is it within the sending limits.
  const { data, error } = await supabase.rpc("mark_invite_emailed", { p_token: token });
  if (error) {
    // PGRST202: the function does not exist yet (0012_invite_email.sql not run).
    return NextResponse.json({ error: error.message }, { status: error.code === "PGRST202" ? 501 : 400 });
  }
  const inv = (data as { email: string; circle_name: string; inviter_email: string; role: string; access_days: number | null }[] | null)?.[0];
  if (!inv) return NextResponse.json({ error: "Invite not found" }, { status: 400 });

  try {
    await sendInviteEmail({
      to: inv.email, circleName: inv.circle_name, inviterEmail: inv.inviter_email, role: inv.role, accessDays: inv.access_days,
      link: `${new URL(request.url).origin}/?invite=${token}`,
    });
  } catch (e) {
    console.error("invite email failed", e);
    return NextResponse.json({ error: "The email could not be sent. Check the Gmail settings, or share the link instead." }, { status: 502 });
  }
  return NextResponse.json({ ok: true, to: inv.email });
}

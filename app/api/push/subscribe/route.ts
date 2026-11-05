import { NextResponse } from "next/server";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";

async function currentUser() {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  return data.user;
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const body = await request.json().catch(() => null);
  const sub = body?.subscription;
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
  }
  // A browser endpoint belongs to whoever signed in on it most recently.
  const { error } = await supabaseAdmin()
    .from("push_subscriptions")
    .upsert(
      {
        user_id: user.id,
        endpoint: sub.endpoint,
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
        user_agent: request.headers.get("user-agent")?.slice(0, 300) ?? null,
      },
      { onConflict: "endpoint" },
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body?.endpoint) return NextResponse.json({ error: "Missing endpoint" }, { status: 400 });
  await supabaseAdmin().from("push_subscriptions").delete().eq("endpoint", body.endpoint).eq("user_id", user.id);
  return NextResponse.json({ ok: true });
}

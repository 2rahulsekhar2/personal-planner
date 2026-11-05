import { NextResponse } from "next/server";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { sendToUser } from "@/lib/push-server";

export async function POST() {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const result = await sendToUser(supabaseAdmin(), data.user.id, {
    title: "Test notification",
    body: "Reminders are working on this device.",
    tag: "test",
  });
  return NextResponse.json(result);
}

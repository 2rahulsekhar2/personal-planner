import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";

const PER_PAGE = 1000;

/** Tells the sign-in page whether an email has an account, so it can send new people to sign-up. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || email.length > 320) return NextResponse.json({ error: "Missing email" }, { status: 400 });

  // shortcut: scans the user list and has no rate limit, fine for a personal app; move to an indexed lookup with throttling if sign-up opens to the public
  const admin = supabaseAdmin();
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PER_PAGE });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (data.users.some((u) => u.email?.toLowerCase() === email)) return NextResponse.json({ exists: true });
    if (data.users.length < PER_PAGE) return NextResponse.json({ exists: false });
  }
}

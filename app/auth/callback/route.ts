import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  if (code) {
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    // "next" is matched against a fixed value, never used as a URL, so it can't redirect off-site.
    if (!error) return NextResponse.redirect(`${origin}/${searchParams.get("next") === "password" ? "?password" : ""}`);
  }
  return NextResponse.redirect(`${origin}/login?error=1`);
}

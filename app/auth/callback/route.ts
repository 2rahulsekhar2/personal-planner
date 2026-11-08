import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * Finishes sign-in for magic links and OAuth. Handles both the PKCE `code`
 * flow and the `token_hash` flow, and passes Supabase's own error reason back
 * to the login page so the user sees what went wrong.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const fail = (reason: string) =>
    NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(reason.slice(0, 200))}`);

  const upstream = searchParams.get("error_code") || searchParams.get("error_description") || searchParams.get("error");
  if (upstream) return fail(upstream);

  const supabase = await supabaseServer();
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return fail(error.code || error.message);
    return NextResponse.redirect(`${origin}/`);
  }
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) return fail(error.code || error.message);
    return NextResponse.redirect(`${origin}/`);
  }
  return fail("missing_code");
}

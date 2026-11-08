"use client";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");
  // Only offer Google once the provider is enabled in Supabase (Authentication → Providers).
  const googleEnabled = process.env.NEXT_PUBLIC_GOOGLE_SIGNIN === "true";
  // Read the error after mount so server and client render the same HTML.
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    const reason = new URLSearchParams(window.location.search).get("error");
    if (reason) setFailure(explainFailure(reason));
  }, []);

  async function google() {
    await supabaseBrowser().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }

  async function magicLink(e: React.FormEvent) {
    e.preventDefault();
    if (state === "sending") return;
    setState("sending");
    const { error } = await supabaseBrowser().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setState("error");
      setMessage(error.message);
    } else {
      setState("sent");
    }
  }

  return (
    <main className="login">
      <div className="login-card">
        <h1 className="brand">Personal Planner</h1>
        <p className="muted">Your commitments, free time and tasks in one calm place.</p>
        {failure && <p className="alert alert-error" role="alert">{failure}</p>}
        {googleEnabled && (
          <>
            <button className="btn btn-primary btn-block" onClick={google}>Continue with Google</button>
            <div className="divider"><span>or</span></div>
          </>
        )}
        {state === "sent" ? (
          <p className="alert alert-ok" role="status">Check {email} for a sign-in link.</p>
        ) : (
          <form onSubmit={magicLink} className="stack">
            <label className="field">
              <span>Email</span>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            </label>
            <button className={`btn btn-block ${googleEnabled ? "" : "btn-primary"}`} disabled={state === "sending"}>
              {state === "sending" ? "Sending…" : "Email me a sign-in link"}
            </button>
            {state === "error" && <p className="alert alert-error" role="alert">{message}</p>}
          </form>
        )}
      </div>
    </main>
  );
}

function explainFailure(reason: string): string {
  const r = reason.toLowerCase();
  if (r.includes("verifier") || r.includes("pkce") || r.includes("flow_state")) {
    return "That link was opened in a different browser or Chrome profile from the one you requested it in. Request a new link here, then open the email in this same browser window.";
  }
  if (r.includes("expired") || r.includes("otp") || r.includes("invalid")) {
    return "That sign-in link has expired or was already used. Request a new one below.";
  }
  return `That sign-in link didn’t work (${reason}). Please request a new one.`;
}

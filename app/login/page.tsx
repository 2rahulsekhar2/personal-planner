"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");
  const failed = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("error");

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
        {failed && <p className="alert alert-error" role="alert">That sign-in link didn’t work. Please try again.</p>}
        <button className="btn btn-primary btn-block" onClick={google}>Continue with Google</button>
        <div className="divider"><span>or</span></div>
        {state === "sent" ? (
          <p className="alert alert-ok" role="status">Check {email} for a sign-in link.</p>
        ) : (
          <form onSubmit={magicLink} className="stack">
            <label className="field">
              <span>Email</span>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            </label>
            <button className="btn btn-block" disabled={state === "sending"}>
              {state === "sending" ? "Sending…" : "Email me a sign-in link"}
            </button>
            {state === "error" && <p className="alert alert-error" role="alert">{message}</p>}
          </form>
        )}
      </div>
    </main>
  );
}

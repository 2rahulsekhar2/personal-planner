"use client";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

type Mode = "signin" | "signup" | "verify";

const COPY: Record<Mode, { title: string; sub: string; turn: number }> = {
  signin: { title: "Sign in to Planner", sub: "Your commitments, free time and tasks in one calm place.", turn: 0 },
  signup: { title: "Create your account", sub: "One account for your appointments, tasks and reminders.", turn: 120 },
  verify: { title: "Check your email", sub: "", turn: 240 },
};

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Read the error flag after mount so the server and first client render match (avoids a hydration error).
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("error")) setError("That sign-in link didn’t work. Try again.");
  }, []);

  function go(next: Mode, message = "") {
    setMode(next);
    setError("");
    setNotice(message);
    setPassword("");
    setConfirm("");
    setCode("");
  }

  /** Runs one auth action with the shared busy and error handling. */
  async function run(action: () => Promise<string | void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const problem = await action();
      if (problem) setError(problem);
    } catch {
      setError("Couldn’t reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const auth = () => supabaseBrowser().auth;

  const google = () =>
    run(async () => {
      const { error } = await auth().signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) return error.message;
    });

  const signIn = () =>
    run(async () => {
      const { error } = await auth().signInWithPassword({ email, password });
      if (!error) {
        window.location.href = "/";
        return;
      }
      if (error.code === "email_not_confirmed") {
        await auth().resend({ type: "signup", email });
        go("verify", "This email isn’t verified yet. We sent a new code.");
        return;
      }
      if (error.code !== "invalid_credentials") return error.message;
      // Supabase gives the same error for an unknown email and a wrong password; ask the server which it is.
      const res = await fetch("/auth/exists", { method: "POST", body: JSON.stringify({ email }) });
      const { exists } = await res.json();
      if (res.ok && exists === false) {
        go("signup", `No account uses ${email} yet. Create one here.`);
        return;
      }
      return "That password is wrong. Try again, or use “Forgot password?”.";
    });

  const signUp = () =>
    run(async () => {
      if (password.length < 8) return "Use at least 8 characters for the password.";
      if (password !== confirm) return "The two passwords don’t match.";
      const { data, error } = await auth().signUp({ email, password });
      if (error) return error.message;
      // Supabase returns a user with no identities when the email is already registered.
      if (data.user?.identities?.length === 0) {
        go("signin", `${email} already has an account. Sign in instead.`);
        return;
      }
      if (data.session) {
        window.location.href = "/";
        return;
      }
      go("verify");
    });

  const verify = () =>
    run(async () => {
      const { error } = await auth().verifyOtp({ email, token: code.trim(), type: "email" });
      if (error) return "That code is wrong or has expired. Check it, or send a new one.";
      window.location.href = "/";
    });

  const resend = () =>
    run(async () => {
      const { error } = await auth().resend({ type: "signup", email });
      if (error) return error.message;
      setNotice(`New code sent to ${email}.`);
    });

  // Recovery for accounts without a password: sign in by link, then set one in Settings.
  const forgot = () =>
    run(async () => {
      if (!email) return "Enter your email first.";
      const { error } = await auth().signInWithOtp({
        email,
        options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) return error.message;
      setNotice(`Sign-in link sent to ${email}. Open it, then set a new password in Settings.`);
    });

  const submit = (action: () => void) => (e: React.FormEvent) => {
    e.preventDefault();
    action();
  };
  const { title, sub, turn } = COPY[mode];

  return (
    <main className="login">
      <div className="auth">
        <svg className="auth-mark" viewBox="12 12 40 40" aria-hidden="true" style={{ transform: `rotate(${turn}deg)` }}>
          <path d="M47.04 26.53A16 16 0 1 1 37.47 16.96" fill="none" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" />
          <circle cx="43.3" cy="20.7" r="3.5" fill="var(--now)" />
        </svg>
        <h1>{title}</h1>
        <p className="auth-sub">{mode === "verify" ? <>Enter the code we sent to <strong>{email}</strong>.</> : sub}</p>

        {error && <p className="alert alert-error" role="alert">{error}</p>}
        {notice && <p className="alert alert-ok" role="status">{notice}</p>}

        {mode === "verify" ? (
          <form onSubmit={submit(verify)} className="stack">
            <label className="field">
              <span>Verification code</span>
              <input className="auth-code" inputMode="numeric" pattern="[0-9]{6,10}" maxLength={10} required autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} autoComplete="one-time-code" />
            </label>
            <button className="btn btn-primary btn-block" disabled={busy}>{busy ? "Checking…" : "Verify and sign in"}</button>
          </form>
        ) : (
          <>
            <form onSubmit={submit(mode === "signin" ? signIn : signUp)} className="stack">
              <label className="field">
                <span>Email</span>
                <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
              </label>
              <label className="field">
                <span>Password</span>
                <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "signin" ? "current-password" : "new-password"} />
              </label>
              {mode === "signup" && (
                <label className="field">
                  <span>Confirm password</span>
                  <input type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
                </label>
              )}
              <button className="btn btn-primary btn-block" disabled={busy}>
                {mode === "signin" ? (busy ? "Signing in…" : "Sign in") : busy ? "Creating account…" : "Create account"}
              </button>
            </form>
            <div className="divider"><span>or</span></div>
            <button className="btn btn-block" disabled={busy} onClick={google}>Continue with Google</button>
          </>
        )}

        <p className="auth-foot">
          {mode === "signin" && (
            <>
              <button type="button" className="link" onClick={forgot}>Forgot password?</button>
              <span>New here? <button type="button" className="link" onClick={() => go("signup")}>Create an account</button></span>
            </>
          )}
          {mode === "signup" && <span>Already have an account? <button type="button" className="link" onClick={() => go("signin")}>Back to sign in</button></span>}
          {mode === "verify" && (
            <>
              <button type="button" className="link" onClick={resend}>Send a new code</button>
              <button type="button" className="link" onClick={() => go("signin")}>Back to sign in</button>
            </>
          )}
        </p>
      </div>
    </main>
  );
}

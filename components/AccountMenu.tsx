"use client";
import { useCallback, useEffect, useState } from "react";
import type { PlannerCtx } from "./usePlanner";
import { useDismiss } from "./useDismiss";

// The avatar in the top bar: who is signed in, the theme for this device, and sign out.
export default function AccountMenu({ ctx, invites, onCircles, onActivity }: { ctx: PlannerCtx; invites: number; onCircles: () => void; onActivity: () => void }) {
  const { email, supabase, toast } = ctx;
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, useCallback(() => setOpen(false), []));

  // Theme is per device: stored in localStorage and applied as data-theme on <html>.
  const [theme, setThemeState] = useState("system");
  useEffect(() => {
    setThemeState(document.documentElement.dataset.theme ?? "system");
  }, []);
  function setTheme(t: string) {
    setThemeState(t);
    try {
      if (t === "system") {
        localStorage.removeItem("theme");
        delete document.documentElement.dataset.theme;
      } else {
        localStorage.setItem("theme", t);
        document.documentElement.dataset.theme = t;
      }
    } catch {
      toast("error", "Couldn’t save the theme on this device.");
    }
  }

  const initial = (email ?? "?")[0].toUpperCase();

  return (
    <div className="add-wrap" ref={ref}>
      <button className="avatar" aria-label={invites ? `Account, ${invites} circle invite${invites > 1 ? "s" : ""}` : "Account"} title="Account" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(!open)}>
        {initial}
        {invites > 0 && <span className="alert-dot" aria-hidden />}
      </button>
      {open && (
        <div className="pop-menu account-menu" role="group" aria-label="Account">
          <div className="account-who">
            <span className="avatar" aria-hidden>{initial}</span>
            <span className="grow">
              <span className="add-hint">Signed in as</span>
              <span className="account-email">{email}</span>
            </span>
          </div>
          <button className="add-item" onClick={() => { setOpen(false); onCircles(); }}>
            <span className="add-icon" aria-hidden>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16.5 11a3 3 0 1 0 0-6M17.5 14.6a5.5 5.5 0 0 1 4 5.4" />
              </svg>
            </span>
            <span className="grow">
              <span className="add-label">Circles</span>
              <span className="add-hint">{invites ? `${invites} invite${invites > 1 ? "s" : ""} waiting` : "Family, teams, friends"}</span>
            </span>
          </button>
          <button className="add-item" onClick={() => { setOpen(false); onActivity(); }}>
            <span className="add-icon" aria-hidden>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12h4l3-8 4 16 3-8h4" />
              </svg>
            </span>
            <span className="grow">
              <span className="add-label">Activity</span>
              <span className="add-hint">Who did what</span>
            </span>
          </button>
          <fieldset className="field account-theme">
            <legend>Theme on this device</legend>
            <div className="segmented">
              {["system", "light", "dark"].map((t) => (
                <button key={t} type="button" className={theme === t ? "is-active" : ""} aria-pressed={theme === t} onClick={() => setTheme(t)}>
                  {t[0].toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          </fieldset>
          <button className="add-item" onClick={async () => { await supabase.auth.signOut(); window.location.href = "/login"; }}>
            <span className="add-icon" aria-hidden>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9.5 20.5H6a2.5 2.5 0 0 1-2.5-2.5V6A2.5 2.5 0 0 1 6 3.5h3.5M15.5 16.5L20 12l-4.5-4.5M20 12H9.5" />
              </svg>
            </span>
            <span className="add-label">Sign out</span>
          </button>
        </div>
      )}
    </div>
  );
}

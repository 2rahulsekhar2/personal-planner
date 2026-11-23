"use client";
import { useEffect, useMemo, useState } from "react";
import type { PlannerCtx } from "./usePlanner";
import type { PushSubscriptionRow } from "@/lib/types";
import ReminderPicker from "./ReminderPicker";
import { deviceTimeZone } from "@/lib/time";
import { useNotificationStatus, STATUS_LABEL } from "./NotificationBadge";
import Select from "./Select";
import { disableNotifications, enableNotifications, isIOS, sendTestNotification } from "@/lib/push-client";

const icon = (d: string) => <svg className="set-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>;
// A picture in front of each setting's name.
const ICON = {
  bell: icon("M6 9.5a6 6 0 0 1 12 0c0 4.5 2 5.5 2 6.5H4c0-1 2-2 2-6.5zM10 19.5a2 2 0 0 0 4 0"),
  globe: icon("M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.500 5.600 12 3z"),
  strike: icon("M4 6.5h16v13H4zM8 3.5v5M16 3.5v5M7.500 13.500h9"),
  lock: icon("M6.5 11h11v9h-11zM8.5 11V8a3.5 3.5 0 0 1 7 0v3"),
};

function deviceName(ua: string | null) {
  if (!ua) return "Unknown device";
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "Device";
  const br = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return `${br} on ${os}`;
}

export default function SettingsView({ ctx }: { ctx: PlannerCtx }) {
  const { profile, setProfile, supabase, toast, tz } = ctx;
  const [status, setStatus] = useNotificationStatus();
  const [busy, setBusy] = useState(false);
  const [devices, setDevices] = useState<PushSubscriptionRow[]>([]);
  const zones = useMemo(() => {
    try {
      return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf("timeZone");
    } catch {
      return [tz];
    }
  }, [tz]);

  const loadDevices = async () => {
    const { data } = await supabase.from("push_subscriptions").select("id, endpoint, user_agent, created_at").order("created_at");
    setDevices((data ?? []) as PushSubscriptionRow[]);
  };
  useEffect(() => {
    loadDevices();
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  async function update(patch: Partial<NonNullable<typeof profile>>) {
    if (!profile) return;
    const prev = profile;
    setProfile({ ...profile, ...patch });
    const { error } = await supabase.from("profiles").update(patch).eq("user_id", profile.user_id);
    if (error) {
      setProfile(prev);
      toast("error", `Couldn’t save setting: ${error.message}`);
    } else {
      toast("ok", "Setting saved");
      if ("show_cancelled" in patch || "time_zone" in patch) ctx.refresh();
    }
  }

  async function enable() {
    setBusy(true);
    try {
      const s = await enableNotifications();
      setStatus(s);
      if (s === "enabled") toast("ok", "Reminders enabled on this device");
      if (s === "blocked") toast("error", "Notifications are blocked for this site in your browser settings.");
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      await disableNotifications();
      setStatus("not-enabled");
      toast("ok", "Reminders turned off on this device");
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    try {
      const r = await sendTestNotification();
      toast(r.delivered ? "ok" : "error", r.delivered ? `Test sent to ${r.delivered} device${r.delivered > 1 ? "s" : ""}` : "No device accepted the test. Try enabling reminders again.");
    } catch {
      toast("error", "Couldn’t send a test notification.");
    } finally {
      setBusy(false);
    }
  }

  async function removeDevice(id: string) {
    await supabase.from("push_subscriptions").delete().eq("id", id);
    loadDevices();
  }

  const [password, setPassword] = useState("");
  // Set when arriving from a password-reset link (/?password); the flag is then dropped from the URL.
  const [resetting] = useState(() => new URLSearchParams(window.location.search).has("password"));
  useEffect(() => {
    if (resetting) window.history.replaceState(null, "", "/");
  }, [resetting]);
  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      toast("error", `Couldn’t save password: ${error.message}`);
    } else {
      setPassword("");
      toast("ok", "Password saved. Use it with your email to sign in.");
    }
  }

  const deviceTz = deviceTimeZone();

  const ok = status === "enabled";
  // How to get reminders working, when it takes more than one step. A real sequence, so it is numbered.
  const steps =
    status === "blocked" ? ["Open your browser’s site settings (the icon left of the address bar).", "Set Notifications to Allow.", "Reload this page."]
    : status === "needs-home-screen" ? ["Tap Share.", "Tap “Add to Home Screen”.", "Open the app from there and enable reminders."]
    : null;

  return (
    <div className="page settings">
      <div className="page-head"><h1>Settings</h1></div>

      <section className="kit">
        <div className="kit-head"><h2>Reminders</h2></div>
        <div className={`card set-status ${ok ? "is-ok" : "is-warn"}`} role="status">
          <span className="set-bell" aria-hidden>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 9.5a6 6 0 0 1 12 0c0 4.5 2 5.5 2 6.5H4c0-1 2-2 2-6.5zM10 19.5a2 2 0 0 0 4 0" />
              {!ok && <path d="M4 4l16 16" />}
            </svg>
          </span>
          <div className="grow">
            <strong>{status ? STATUS_LABEL[status] : "Checking…"}</strong>
            <p className="set-desc">
              {status === "enabled" && "This device gets reminders even when the app is closed."}
              {status === "not-enabled" && "Each device is turned on separately."}
              {status === "blocked" && "Notifications are blocked for this site. To turn reminders on:"}
              {status === "needs-home-screen" && "On iPhone and iPad, add this app to your Home Screen first:"}
              {status === "unsupported" && "This browser can’t receive reminders. Try Chrome, Edge, Firefox or Safari 16.4+."}
            </p>
            {steps && <ol className="set-steps">{steps.map((x) => <li key={x}>{x}</li>)}</ol>}
          </div>
          {status === "not-enabled" && <button className="btn btn-primary" disabled={busy} onClick={enable}>Enable reminders</button>}
          {ok && <input type="checkbox" role="switch" className="switch" aria-label="Reminders on this device" checked disabled={busy} onChange={disable} />}
        </div>

        {/* Every device that receives reminders, as a tile. The cross takes one off the list. */}
        {(devices.length > 0 || ok) && (
          <ul className="kit-row set-devices">
            {devices.map((d) => {
              const name = deviceName(d.user_agent);
              const phone = /iPhone|Android/.test(name);
              return (
                <li key={d.id} className="kit-token">
                  <span className="kit-mono set-device" aria-hidden>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                      {phone ? <path d="M8 3h8a1.5 1.5 0 0 1 1.5 1.5v15A1.5 1.5 0 0 1 16 21H8a1.5 1.5 0 0 1-1.5-1.5v-15A1.5 1.5 0 0 1 8 3zM11 18h2" /> : <path d="M5 5.5h14v10H5zM2.5 19h19" />}
                    </svg>
                  </span>
                  <span><span className="kit-name">{name}</span><span className="kit-sub">since {new Date(d.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span></span>
                  <button className="icon-btn" aria-label={`Remove ${name}`} title="Remove" onClick={() => removeDevice(d.id)}>✕</button>
                </li>
              );
            })}
            {ok && <li><button className="kit-token kit-add" disabled={busy} onClick={test}><span className="kit-add-text">Send a test</span></button></li>}
          </ul>
        )}
        <p className="hint">Timing depends on the browser and connection, so it is not exact to the second{isIOS() ? ". On iOS it needs the Home Screen app" : ""}.</p>
      </section>

      <section className="kit">
        <div className="kit-head"><h2>Defaults</h2></div>
        <div className="card set-card">
          <div className="set-row">
            <span className="set-label">{ICON.bell}Remind me before appointments</span>
            <ReminderPicker id="set-reminder" value={profile?.default_reminder_minutes ?? null} onChange={(v) => update({ default_reminder_minutes: v })} />
          </div>
          <div className="set-row">
            <div>
              <label htmlFor="set-tz" className="set-label">{ICON.globe}Time zone</label>
              {profile?.time_zone && profile.time_zone !== deviceTz && (
                <p className="set-desc">This device is on {deviceTz}. <button className="link" onClick={() => update({ time_zone: deviceTz })}>Use it</button></p>
              )}
            </div>
            <Select id="set-tz" search value={profile?.time_zone ?? tz} options={zones.map((z) => ({ value: z, label: z.replace(/_/g, " ") }))} onChange={(v) => update({ time_zone: v })} />
          </div>
          <div className="set-row">
            <label htmlFor="set-cancelled" className="set-label">{ICON.strike}Show cancelled appointments</label>
            <input id="set-cancelled" type="checkbox" role="switch" className="switch" checked={!!profile?.show_cancelled} onChange={(e) => update({ show_cancelled: e.target.checked })} />
          </div>
        </div>
      </section>

      {/* Who is signed in, and sign out, live in the avatar menu. The password stays here: a reset link opens this page. */}
      <section className="kit">
        <div className="kit-head"><h2>Password</h2></div>
        <form onSubmit={savePassword} className="card set-card">
          <div className="set-row">
            <label htmlFor="set-password" className="set-label">{ICON.lock}{resetting ? "Choose a new password" : "New password"}</label>
            <div className="set-password">
              <input id="set-password" type="password" autoFocus={resetting} required minLength={8} placeholder="8 characters or more" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
              <button className="btn" disabled={password.length < 8}>Save</button>
            </div>
          </div>
        </form>
      </section>
    </div>
  );
}

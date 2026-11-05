"use client";
import { useEffect, useMemo, useState } from "react";
import type { PlannerCtx } from "./usePlanner";
import { REMINDER_CHOICES, type PushSubscriptionRow } from "@/lib/types";
import { deviceTimeZone } from "@/lib/time";
import { useNotificationStatus, STATUS_LABEL } from "./NotificationBadge";
import { disableNotifications, enableNotifications, isIOS, sendTestNotification } from "@/lib/push-client";

function deviceName(ua: string | null) {
  if (!ua) return "Unknown device";
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "Device";
  const br = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return `${br} on ${os}`;
}

export default function SettingsView({ ctx }: { ctx: PlannerCtx }) {
  const { profile, setProfile, supabase, toast, email, tz } = ctx;
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

  const deviceTz = deviceTimeZone();

  return (
    <div className="page">
      <div className="page-head"><h1>Settings</h1></div>

      <section className="card stack">
        <h2 className="section-title">Reminders on this device</h2>
        <p className={`status-line ${status === "enabled" ? "is-ok" : "is-warn"}`} role="status">
          <span aria-hidden>{status === "enabled" ? "🔔" : "🔕"}</span> <strong>{status ? STATUS_LABEL[status] : "Checking…"}</strong>
        </p>
        {status === "enabled" && <p className="muted">This browser will receive reminders even when the app isn’t open, as long as the device is online and system notifications are allowed.</p>}
        {status === "not-enabled" && <p className="muted">Reminders won’t reach this device until you enable them. Each browser and device is set up separately.</p>}
        {status === "blocked" && (
          <div className="alert alert-warn">
            Notifications are blocked for this site. Your calendar still works. To turn reminders on, open your browser’s site settings (the icon left of the address bar), set Notifications to Allow, then reload this page.
          </div>
        )}
        {status === "needs-home-screen" && (
          <div className="alert alert-warn">
            On iPhone and iPad, reminders only work after adding this app to your Home Screen: tap Share, then “Add to Home Screen”, then open the app from there and enable reminders.
          </div>
        )}
        {status === "unsupported" && <div className="alert alert-warn">This browser doesn’t support web push reminders. Try Chrome, Edge, Firefox or Safari 16.4+.</div>}
        <div className="row">
          {(status === "not-enabled") && <button className="btn btn-primary" disabled={busy} onClick={enable}>Enable reminders</button>}
          {status === "enabled" && <button className="btn" disabled={busy} onClick={test}>Send test notification</button>}
          {status === "enabled" && <button className="btn btn-ghost" disabled={busy} onClick={disable}>Turn off on this device</button>}
        </div>
        <p className="hint">Reminders can’t be guaranteed to the exact second. They depend on the browser, connection and system settings{isIOS() ? ", and on iOS the Home Screen app" : ""}.</p>

        {devices.length > 0 && (
          <>
            <h3 className="subhead">Devices receiving reminders</h3>
            <ul className="list">
              {devices.map((d) => (
                <li key={d.id} className="list-row">
                  <span className="grow">{deviceName(d.user_agent)} <span className="muted">· added {new Date(d.created_at).toLocaleDateString()}</span></span>
                  <button className="btn btn-ghost btn-sm" onClick={() => removeDevice(d.id)}>Remove</button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="card stack">
        <h2 className="section-title">Defaults</h2>
        <label className="field">
          <span>Default appointment reminder</span>
          <select value={profile?.default_reminder_minutes == null ? "none" : String(profile.default_reminder_minutes)} onChange={(e) => update({ default_reminder_minutes: e.target.value === "none" ? null : Number(e.target.value) })}>
            {REMINDER_CHOICES.map((c) => <option key={String(c.value)} value={c.value === null ? "none" : c.value}>{c.label}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Time zone</span>
          <select value={profile?.time_zone ?? tz} onChange={(e) => update({ time_zone: e.target.value })}>
            {zones.map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
          </select>
          {profile?.time_zone && profile.time_zone !== deviceTz && (
            <span className="hint">This device is set to {deviceTz}. <button className="link" onClick={() => update({ time_zone: deviceTz })}>Use it</button></span>
          )}
        </label>
        <label className="check">
          <input type="checkbox" checked={!!profile?.show_cancelled} onChange={(e) => update({ show_cancelled: e.target.checked })} /> Show cancelled appointments in the calendar
        </label>
      </section>

      <section className="card stack">
        <h2 className="section-title">Account</h2>
        <p>Signed in as <strong>{email}</strong></p>
        <div>
          <button className="btn" onClick={async () => { await supabase.auth.signOut(); window.location.href = "/login"; }}>Sign out</button>
        </div>
      </section>
    </div>
  );
}

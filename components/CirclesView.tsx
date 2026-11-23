"use client";
import { useEffect, useState } from "react";
import type { PlannerCtx } from "./usePlanner";
import type { CirclesState } from "./useCircles";
import { expiryLabel, inviteLink, isCurrent, isOpen, seatsOf, type Circle, type CircleMember } from "@/lib/circles";

const ROLE_LABEL = { owner: "Owner", member: "Member", viewer: "Viewer" } as const;

// What an invite link resolves to, before the person decides.
interface LinkInvite { circle_name: string; inviter_email: string; role: string; expires_at: string; usable: boolean; access_days?: number | null }

// How long an invited person stays. 0: no end.
const ACCESS = [{ days: 0, label: "For good" }, { days: 1, label: "1 day" }, { days: 7, label: "1 week" }, { days: 30, label: "1 month" }];
const stay = (days?: number | null) => (days ? ` Your access lasts ${days === 1 ? "1 day" : `${days} days`} from when you join.` : "");
const dayLabel = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
// "Viewer, until 3 Dec", "Member, access ended".
// A date field works in local days: yyyy-MM-dd of when access ends, and back to the last second of that day.
const localDay = (iso: string) => new Date(iso).toLocaleDateString("en-CA");
const endOfDay = (day: string) => new Date(`${day}T23:59:59`).toISOString();
const accessNote = (m: CircleMember) => (!m.expires_at ? "" : isCurrent(m) ? `, until ${dayLabel(m.expires_at)}` : ", access ended");

export default function CirclesView({ ctx, state, linkToken, clearLink }: { ctx: PlannerCtx; state: CirclesState; linkToken: string | null; clearLink: () => void }) {
  const { supabase, toast, email } = ctx;
  const { circles, invites, userId, ready, missing, roles, error, reload } = state;
  const me = email?.toLowerCase();
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState<string | null>(null); // null: the create form is closed
  const [draft, setDraft] = useState<{ circle: string; email: string; role: "member" | "viewer"; days: number } | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null); // key of the action waiting for a second press
  const [link, setLink] = useState<LinkInvite | null | "gone">(null);
  // The face that is open for managing: a member's user id or an invite's id, within one circle.
  const [open, setOpen] = useState<{ circle: string; key: string } | null>(null);

  useEffect(() => {
    if (!linkToken) return setLink(null);
    supabase.rpc("get_invite", { p_token: linkToken }).then(({ data }: { data: unknown }) => setLink((data as LinkInvite[] | null)?.[0] ?? "gone"));
  }, [linkToken, supabase]);

  // Every change goes through one database function; this runs it, reloads, and reports.
  async function run(fn: string, args: Record<string, unknown>, done: string) {
    if (busy) return null;
    setBusy(true);
    const { data, error } = await supabase.rpc(fn, args);
    setBusy(false);
    setConfirm(null);
    if (error) {
      toast("error", error.message);
      return null;
    }
    await reload();
    if (done) toast("ok", done);
    return data ?? true;
  }

  async function copy(token: string) {
    try {
      await navigator.clipboard.writeText(inviteLink(token));
      toast("ok", "Invite link copied");
    } catch {
      toast("error", `Couldn’t copy. The link is ${inviteLink(token)}`);
    }
  }

  // Asks the server to email an addressed invite. Returns "sent", "off" (the app cannot send mail here) or "failed".
  async function sendMail(token: string): Promise<"sent" | "off" | "failed"> {
    const res = await fetch("/api/invites/email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) }).catch(() => null);
    if (res?.ok) return "sent";
    if (res?.status === 501) return "off";
    toast("error", (await res?.json().catch(() => null))?.error ?? "The email could not be sent");
    return "failed";
  }

  // "Email it" on an invited row. Where the app cannot send mail, the owner's own mail app opens with the invite written out.
  async function emailInvite(token: string, to: string, circleName: string, expires: string) {
    if (busy) return;
    setBusy(true);
    const result = await sendMail(token);
    setBusy(false);
    if (result === "sent") toast("ok", `Invite emailed to ${to}`);
    else if (result === "off") {
      window.location.href = `mailto:${to}?subject=${encodeURIComponent(`Join ${circleName} on Planner`)}&body=${encodeURIComponent(`I've invited you to "${circleName}" on Planner, where we plan together.\n\nOpen this link and sign in with ${to}:\n${inviteLink(token)}\n\nThe invite ${expiryLabel(expires).toLowerCase()}.`)}`;
    }
  }

  // An empty email makes a one-time link. Either way the link ends up on the clipboard.
  async function invite(circle: string, to: string, role: string, days: number) {
    // p_days is sent only when the database knows it (0009).
    const token = await run("invite_to_circle", { p_circle: circle, p_email: to, p_role: role, ...(roles && days ? { p_days: days } : {}) }, "");
    if (typeof token !== "string") return;
    setDraft(null);
    // An addressed invite is emailed straight away when the app can; otherwise the link goes to the clipboard to share.
    if (to.trim() && (await sendMail(token)) === "sent") return toast("ok", `Invite emailed to ${to.trim()}`);
    if (to.trim()) toast("ok", `Invite ready for ${to.trim()}`);
    copy(token);
  }

  async function answer(token: string, accept: boolean, name: string) {
    const ok = await run("respond_to_invite", { p_token: token, p_accept: accept }, accept ? `You joined ${name}` : "Invite declined");
    if (ok && token === linkToken) clearLink();
  }

  // These three are plain functions returning markup, not components: a component declared here would be
  // recreated on every render and its inputs would lose focus while typing.

  // A button that asks once more before doing something that cannot be undone.
  const sure = (k: string, label: string, yes: string, onYes: () => void) =>
    confirm === k ? (
      <span className="row" key={k}>
        <button className="btn btn-sm btn-danger" disabled={busy} onClick={onYes}>{yes}</button>
        <button className="btn btn-sm btn-ghost" onClick={() => setConfirm(null)}>Keep</button>
      </span>
    ) : (
      <button key={k} className="btn btn-sm btn-ghost btn-danger" onClick={() => setConfirm(k)}>{label}</button>
    );

  const forMe = invites.filter((i) => i.email === me && isOpen(i) && i.token !== linkToken);

  const inviteCard = (token: string, name: string, from: string, role: string, expires: string, days?: number | null) => (
    <section key={token} className="card stack circle-invite">
      <p className="muted">{from} invited you</p>
      <h2 className="circle-name">Join {name}?</h2>
      <p>
        You will see what members share with this circle. Your own calendar stays private unless you share an item.
        {role === "viewer" ? " You are invited as a viewer: you can look, but not add." : ""}{stay(days)} You can leave at any time.
      </p>
      <div className="form-actions">
        <button className="btn btn-primary" disabled={busy} onClick={() => answer(token, true, name)}>Join {name}</button>
        <button className="btn btn-ghost" disabled={busy} onClick={() => answer(token, false, name)}>Decline</button>
        <span className="muted hint">{expiryLabel(expires)}</span>
      </div>
    </section>
  );

  const circleCard = (c: Circle) => {
    const owner = c.owner_id === userId;
    // My access ended: the circle's name is all I can still see. Leaving removes me from it for good.
    const self = c.circle_members.find((m) => m.user_id === userId);
    if (self && !isCurrent(self)) {
      return (
        <section key={c.id} className="card stack">
          <h2 className="circle-name">{c.name}</h2>
          <p className="muted">Your access ended on {dayLabel(self.expires_at!)}. You no longer see what this circle shares. The owner can let you back in.</p>
          <div className="form-actions">{sure(`leave:${c.id}`, "Leave circle", `Leave ${c.name}`, () => run("leave_circle", { p_circle: c.id }, `You left ${c.name}`))}</div>
        </section>
      );
    }
    const others = c.circle_members.filter((m) => m.user_id !== userId);
    const sent = invites.filter((i) => i.circle_id === c.id && isOpen(i));
    const d = draft?.circle === c.id ? draft : null;
    // Owner first, then by email, so each person keeps the same seat and colour between visits.
    const members = seatsOf(c);
    const seats = [
      ...members.map((m) => ({ key: m.user_id, letter: m.letter, color: m.color, pending: false, owner: m.role === "owner", draft: false })),
      ...sent.map((i) => ({ key: i.id, letter: i.email?.[0].toUpperCase() ?? "?", color: "", pending: true, owner: false, draft: false })),
      ...(d ? [{ key: "draft", letter: d.email.trim()[0]?.toUpperCase() ?? "+", color: "", pending: true, owner: false, draft: true }] : []),
    ];
    return (
      <section key={c.id} className="card stack">
        {/* The circle drawn as one: members sit on a ring around its initial, invited people as dashed seats. */}
        <div className="circle-head">
          <div className="orbit" style={{ ["--n" as string]: Math.min(seats.length, 8) }} aria-hidden>
            <span className="orbit-core">{c.name.trim()[0]?.toUpperCase()}</span>
            {seats.slice(0, 8).map((seat, n) => (
              <span
                key={seat.key}
                className={`orbit-seat ${seat.pending ? "is-pending" : `act-${seat.color}`} ${seat.owner ? "is-owner" : ""} ${seat.draft ? "is-draft" : ""}`}
                style={{ ["--i" as string]: n }}
              >
                {seats.length > 8 && n === 7 ? `+${seats.length - 7}` : seat.letter}
              </span>
            ))}
          </div>
          <div className="grow">
            <h2 className="circle-name">{c.name}</h2>
            <p className="muted circle-count">
              {members.length === 1 ? "Just you so far" : `${members.length} members`}
              {sent.length > 0 && `, ${sent.length} invited`}
            </p>
          </div>
        </div>

        {/* Everyone as a face. The owner presses one to manage that person; the dashed face invites someone new. */}
        <ul className="kit-row kit-faces circle-faces">
          {members.map((m) => {
            const can = owner && m.user_id !== userId;
            const on = open?.circle === c.id && open.key === m.user_id;
            const inner = (
              <>
                <span className={`kit-face ${m.role === "owner" ? "is-owner" : ""}`}>{m.letter}{m.role === "viewer" && <span className="kit-badge is-viewer" title="Viewer"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" /><circle cx="12" cy="12" r="2.5" /></svg></span>}</span>
                <span className="kit-name">{m.user_id === userId ? "You" : m.email.split("@")[0]}</span>
                <span className="kit-sub">{ROLE_LABEL[m.role]}{accessNote(m)}</span>
              </>
            );
            return (
              <li key={m.user_id}>
                {can
                  ? <button className={`kit-token act-${m.color} ${on ? "is-open" : ""}`} title={m.email} aria-expanded={on} aria-label={`Manage ${m.email}, ${ROLE_LABEL[m.role]}`} onClick={() => { setOpen(on ? null : { circle: c.id, key: m.user_id }); setConfirm(null); }}>{inner}</button>
                  : <span className={`kit-token act-${m.color}`} title={m.email}>{inner}</span>}
              </li>
            );
          })}
          {sent.map((i) => {
            const on = open?.circle === c.id && open.key === i.id;
            const inner = (
              <>
                <span className="kit-face is-pending">{i.email?.[0].toUpperCase() ?? "?"}</span>
                <span className="kit-name">{i.email ? i.email.split("@")[0] : "Link"}</span>
                <span className="kit-sub">Invited</span>
              </>
            );
            return (
              <li key={i.id}>
                {owner
                  ? <button className={`kit-token ${on ? "is-open" : ""}`} title={i.email ?? "Invite link"} aria-expanded={on} aria-label={`Manage the invite for ${i.email ?? "a link"}`} onClick={() => setOpen(on ? null : { circle: c.id, key: i.id })}>{inner}</button>
                  : <span className="kit-token" title={i.email ?? "Invite link"}>{inner}</span>}
              </li>
            );
          })}
          {owner && (
            <li>
              <button className={`kit-token kit-add ${d ? "is-open" : ""}`} aria-expanded={!!d} onClick={() => { setOpen(null); setDraft(d ? null : { circle: c.id, email: "", role: "member", days: 0 }); }}>
                <span className="kit-add-mark"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg></span>
                <span className="kit-add-text">Invite</span>
              </button>
            </li>
          )}
        </ul>

        {/* The open face's controls. */}
        {owner && open?.circle === c.id && members.filter((m) => m.user_id === open.key).map((m) => (
          <div key={m.user_id} className="seat-form">
            <strong className="circle-email">{m.email}</strong>
            {roles && (
              <div className="row seat-role">
                <span className="muted">Role</span>
                <span className="chips chips-xs" role="group" aria-label="Role">
                  {(["member", "viewer"] as const).map((r) => (
                    <button key={r} type="button" className={`chip ${m.role === r ? "is-selected" : ""}`} aria-pressed={m.role === r} disabled={busy || m.role === r}
                      onClick={() => run("update_circle_member", { p_circle: c.id, p_user: m.user_id, p_role: r, p_until: m.expires_at ?? null }, `${m.email} is now a ${r}`)}>{ROLE_LABEL[r]}</button>
                  ))}
                </span>
              </div>
            )}
            {roles && (
              <div className="row seat-role">
                <span className="muted">Stays until</span>
                <input
                  type="date" className="input-inline" aria-label={`Date ${m.email}'s access ends`}
                  value={m.expires_at ? localDay(m.expires_at) : ""} min={localDay(new Date().toISOString())} disabled={busy}
                  onChange={(e) => run("update_circle_member", { p_circle: c.id, p_user: m.user_id, p_role: m.role, p_until: e.target.value ? endOfDay(e.target.value) : null }, e.target.value ? `${m.email} stays until ${dayLabel(endOfDay(e.target.value))}` : `${m.email} stays for good`)}
                />
                {m.expires_at
                  ? <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => run("update_circle_member", { p_circle: c.id, p_user: m.user_id, p_role: m.role, p_until: null }, `${m.email} stays for good`)}>For good</button>
                  : <span className="muted">no end</span>}
              </div>
            )}
            <div className="row">
              {sure(`own:${c.id}:${m.user_id}`, "Make owner", "Hand over", () => run("transfer_circle", { p_circle: c.id, p_user: m.user_id }, `${m.email} now owns ${c.name}`))}
              {sure(`rm:${c.id}:${m.user_id}`, "Remove", "Remove", async () => { if (await run("remove_circle_member", { p_circle: c.id, p_user: m.user_id }, `${m.email} removed`)) setOpen(null); })}
            </div>
          </div>
        ))}
        {owner && open?.circle === c.id && sent.filter((i) => i.id === open.key).map((i) => (
          <div key={i.id} className="seat-form">
            <strong className="circle-email">{i.email ?? "Invite link"}</strong>
            <span className="muted">{expiryLabel(i.expires_at)}{i.access_days ? `, then stays ${i.access_days === 1 ? "1 day" : `${i.access_days} days`}` : ""}</span>
            <div className="row">
              {i.email && <button className="btn btn-sm" disabled={busy} onClick={() => emailInvite(i.token, i.email!, c.name, i.expires_at)}>Email it</button>}
              <button className="btn btn-sm" onClick={() => copy(i.token)}>Copy link</button>
              <button className="btn btn-sm btn-ghost btn-danger" disabled={busy} onClick={async () => { if (await run("revoke_invite", { p_invite: i.id }, "Invite withdrawn")) setOpen(null); }}>Withdraw</button>
            </div>
          </div>
        ))}

        {/* Adding a seat: while this is open, the new seat previews on the ring above. */}
        {owner && d && (
          <form className="seat-form" onSubmit={(e) => { e.preventDefault(); invite(c.id, d.email, d.role, d.days); }}>
            <input type="email" required value={d.email} onChange={(e) => setDraft({ ...d, email: e.target.value })} placeholder="Their email" aria-label="Their email" autoFocus />
            <div className="row seat-role">
              <span className="muted">Joins as</span>
              <span className="chips chips-xs" role="group" aria-label="Role">
                {(["member", "viewer"] as const).map((r) => (
                  <button key={r} type="button" className={`chip ${d.role === r ? "is-selected" : ""}`} aria-pressed={d.role === r} onClick={() => setDraft({ ...d, role: r })}>{ROLE_LABEL[r]}</button>
                ))}
              </span>
            </div>
            {roles && (
              <div className="row seat-role">
                <span className="muted">Stays</span>
                <span className="chips chips-xs" role="group" aria-label="How long they stay">
                  {ACCESS.map((a) => (
                    <button key={a.days} type="button" className={`chip ${d.days === a.days ? "is-selected" : ""}`} aria-pressed={d.days === a.days} onClick={() => setDraft({ ...d, days: a.days })}>{a.label}</button>
                  ))}
                </span>
                <input type="number" className="input-inline days-input" min={1} max={365} aria-label="Or a number of days" placeholder="days" value={d.days || ""} onChange={(e) => setDraft({ ...d, days: Math.max(0, Math.min(365, Math.floor(Number(e.target.value) || 0))) })} />
              </div>
            )}
            <div className="row">
              <button className="btn btn-primary" disabled={busy}>Invite</button>
              <button type="button" className="btn" disabled={busy} onClick={() => invite(c.id, "", d.role, d.days)}>Copy a one-time link</button>
              <button type="button" className="btn btn-ghost" onClick={() => setDraft(null)}>Cancel</button>
            </div>
            <p className="hint">A link works for whoever opens it first. A viewer can look, not add.</p>
          </form>
        )}

        <div className="form-actions">
          {!owner && sure(`leave:${c.id}`, "Leave circle", `Leave ${c.name}`, () => run("leave_circle", { p_circle: c.id }, `You left ${c.name}`))}
          {owner && others.length > 0 && <span className="hint">To leave, make someone else the owner first.</span>}
          {owner && sure(`del:${c.id}`, "Delete circle", `Delete ${c.name} for everyone`, () => run("delete_circle", { p_circle: c.id }, `${c.name} deleted`))}
        </div>
      </section>
    );
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>Circles</h1>
        {newName === null && !missing && <button className="btn btn-primary" onClick={() => setNewName("")}>New circle</button>}
      </div>

      {missing && <div className="alert alert-warn">Circles need a one-time database update: run supabase/migrations/0005_circles.sql in the Supabase SQL editor, then reload.</div>}
      {error && <div className="alert alert-error" role="alert">Couldn’t load circles: {error}. <button className="link" onClick={reload}>Retry</button></div>}

      {link === "gone" && <div className="alert alert-warn">That invite link doesn’t work any more. Ask for a new one. <button className="link" onClick={clearLink}>Dismiss</button></div>}
      {link && link !== "gone" && linkToken && (link.usable
        ? inviteCard(linkToken, link.circle_name, link.inviter_email, link.role, link.expires_at, link.access_days)
        : <div className="alert alert-warn">The invite to {link.circle_name} can’t be used: it was already used, has expired, is for a different email address, or you are already a member. <button className="link" onClick={clearLink}>Dismiss</button></div>)}
      {forMe.map((i) => inviteCard(i.token, i.circle_name, i.inviter_email, i.role, i.expires_at, i.access_days))}

      {newName !== null && (
        <form className="card stack" onSubmit={async (e) => {
          e.preventDefault();
          if (!newName.trim()) return;
          if (await run("create_circle", { p_name: newName }, `${newName.trim()} created`)) setNewName(null);
        }}>
          <label className="field"><span>Circle name</span><input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Family" maxLength={60} autoFocus /></label>
          <div className="row">
            <button className="btn btn-primary" disabled={busy || !newName.trim()}>Create circle</button>
            <button type="button" className="btn btn-ghost" onClick={() => setNewName(null)}>Cancel</button>
          </div>
        </form>
      )}

      {circles.map(circleCard)}
      {ready && !missing && !error && circles.length === 0 && newName === null && <p className="empty">No circles yet. A circle is a group you plan with: family, a team, friends. Joining one shares nothing by itself.</p>}
    </div>
  );
}

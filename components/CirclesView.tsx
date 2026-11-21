"use client";
import { useEffect, useState } from "react";
import type { PlannerCtx } from "./usePlanner";
import type { CirclesState } from "./useCircles";
import { expiryLabel, inviteLink, isOpen, seatsOf, type Circle } from "@/lib/circles";

const ROLE_LABEL = { owner: "Owner", member: "Member", viewer: "Viewer" } as const;

// What an invite link resolves to, before the person decides.
interface LinkInvite { circle_name: string; inviter_email: string; role: string; expires_at: string; usable: boolean }

export default function CirclesView({ ctx, state, linkToken, clearLink }: { ctx: PlannerCtx; state: CirclesState; linkToken: string | null; clearLink: () => void }) {
  const { supabase, toast, email } = ctx;
  const { circles, invites, userId, ready, missing, error, reload } = state;
  const me = email?.toLowerCase();
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState<string | null>(null); // null: the create form is closed
  const [draft, setDraft] = useState<{ circle: string; email: string; role: "member" | "viewer" } | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null); // key of the action waiting for a second press
  const [link, setLink] = useState<LinkInvite | null | "gone">(null);

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

  // An empty email makes a one-time link. Either way the link ends up on the clipboard.
  async function invite(circle: string, to: string, role: string) {
    const token = await run("invite_to_circle", { p_circle: circle, p_email: to, p_role: role }, to.trim() ? `Invite ready for ${to.trim()}` : "");
    if (typeof token === "string") { setDraft(null); copy(token); }
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

  const inviteCard = (token: string, name: string, from: string, role: string, expires: string) => (
    <section key={token} className="card stack circle-invite">
      <p className="muted">{from} invited you</p>
      <h2 className="circle-name">Join {name}?</h2>
      <p>
        You will see what members share with this circle. Your own calendar stays private unless you share an item.
        {role === "viewer" ? " You are invited as a viewer." : ""} You can leave at any time.
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
            {owner && !d && <button className="btn btn-sm" onClick={() => setDraft({ circle: c.id, email: "", role: "member" })}>Invite someone</button>}
          </div>
        </div>

        <ul className="list circle-people">
          {members.map((m) => (
            <li key={m.user_id} className="list-row">
              <span className={`avatar avatar-sm act-${m.color}`} aria-hidden>{m.letter}</span>
              <span className="grow circle-who">
                <span className="circle-email">{m.email}</span>
                <span className="muted">{ROLE_LABEL[m.role]}{m.user_id === userId ? ", you" : ""}</span>
              </span>
              {owner && m.user_id !== userId && (
                <span className="row-actions">
                  {sure(`own:${c.id}:${m.user_id}`, "Make owner", "Hand over", () => run("transfer_circle", { p_circle: c.id, p_user: m.user_id }, `${m.email} now owns ${c.name}`))}
                  {sure(`rm:${c.id}:${m.user_id}`, "Remove", "Remove", () => run("remove_circle_member", { p_circle: c.id, p_user: m.user_id }, `${m.email} removed`))}
                </span>
              )}
            </li>
          ))}
          {sent.map((i) => (
            <li key={i.id} className="list-row">
              <span className="avatar avatar-sm avatar-pending" aria-hidden>?</span>
              <span className="grow circle-who">
                <span className="circle-email">{i.email ?? "Invite link"}</span>
                <span className="muted">Invited. {expiryLabel(i.expires_at)}</span>
              </span>
              {owner && (
                <span className="row-actions">
                  <button className="btn btn-sm btn-ghost" onClick={() => copy(i.token)}>Copy link</button>
                  <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => run("revoke_invite", { p_invite: i.id }, "Invite withdrawn")}>Withdraw</button>
                </span>
              )}
            </li>
          ))}
        </ul>

        {/* Adding a seat: while this is open, the new seat previews on the ring above. */}
        {owner && d && (
          <form className="seat-form" onSubmit={(e) => { e.preventDefault(); invite(c.id, d.email, d.role); }}>
            <input type="email" required value={d.email} onChange={(e) => setDraft({ ...d, email: e.target.value })} placeholder="Their email" aria-label="Their email" autoFocus />
            <div className="row seat-role">
              <span className="muted">Joins as</span>
              <span className="chips chips-xs" role="group" aria-label="Role">
                {(["member", "viewer"] as const).map((r) => (
                  <button key={r} type="button" className={`chip ${d.role === r ? "is-selected" : ""}`} aria-pressed={d.role === r} onClick={() => setDraft({ ...d, role: r })}>{ROLE_LABEL[r]}</button>
                ))}
              </span>
            </div>
            <div className="row">
              <button className="btn btn-primary" disabled={busy}>Invite</button>
              <button type="button" className="btn" disabled={busy} onClick={() => invite(c.id, "", d.role)}>Copy a one-time link</button>
              <button type="button" className="btn btn-ghost" onClick={() => setDraft(null)}>Cancel</button>
            </div>
            <p className="hint">No email is sent: they see the invite when they sign in with this address. A link works for whoever opens it first. Roles take effect once sharing is added.</p>
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
      <p className="hint">A circle is a group you plan with: your family, a team, friends. Joining one shares nothing by itself.</p>

      {missing && <div className="alert alert-warn">Circles need a one-time database update: run supabase/migrations/0005_circles.sql in the Supabase SQL editor, then reload.</div>}
      {error && <div className="alert alert-error" role="alert">Couldn’t load circles: {error}. <button className="link" onClick={reload}>Retry</button></div>}

      {link === "gone" && <div className="alert alert-warn">That invite link doesn’t work any more. Ask for a new one. <button className="link" onClick={clearLink}>Dismiss</button></div>}
      {link && link !== "gone" && linkToken && (link.usable
        ? inviteCard(linkToken, link.circle_name, link.inviter_email, link.role, link.expires_at)
        : <div className="alert alert-warn">The invite to {link.circle_name} can’t be used: it was already used, has expired, is for a different email address, or you are already a member. <button className="link" onClick={clearLink}>Dismiss</button></div>)}
      {forMe.map((i) => inviteCard(i.token, i.circle_name, i.inviter_email, i.role, i.expires_at))}

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
      {ready && !missing && !error && circles.length === 0 && newName === null && <p className="empty">No circles yet. Create one, then invite the people you plan with.</p>}
    </div>
  );
}

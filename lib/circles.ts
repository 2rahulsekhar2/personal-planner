export type CircleRole = "owner" | "member" | "viewer";

export interface CircleMember {
  user_id: string;
  email: string;
  role: CircleRole;
}

export interface Circle {
  id: string;
  name: string;
  owner_id: string;
  circle_members: CircleMember[];
}

export interface CircleInvite {
  id: string;
  token: string;
  circle_id: string;
  circle_name: string;
  inviter_email: string;
  email: string | null; // null: a link invite
  role: "member" | "viewer";
  expires_at: string;
  accepted_at: string | null;
  declined_at: string | null;
}

/** An invite can still be answered: not used, not declined, not past its date. */
export function isOpen(i: Pick<CircleInvite, "expires_at" | "accepted_at" | "declined_at">, now = Date.now()): boolean {
  return !i.accepted_at && !i.declined_at && Date.parse(i.expires_at) > now;
}

/** "Expires today", "Expires tomorrow", "Expires in 5 days". */
export function expiryLabel(expiresAt: string, now = Date.now()): string {
  const days = Math.floor((Date.parse(expiresAt) - now) / 86400000);
  return days <= 0 ? "Expires today" : days === 1 ? "Expires tomorrow" : `Expires in ${days} days`;
}

export const inviteLink = (token: string) => `${window.location.origin}/?invite=${token}`;

export type CircleRole = "owner" | "member" | "viewer";

export interface CircleMember {
  user_id: string;
  email: string;
  role: CircleRole;
  expires_at?: string | null; // access ends then; absent until 0009_roles.sql has been run
}

/** Still in the circle: no end date, or one that has not passed. */
export const isCurrent = (m: Pick<CircleMember, "expires_at">, now = Date.now()) => !m.expires_at || Date.parse(m.expires_at) > now;

/** May add to the circle and be given tasks: a current owner or member, not a viewer. */
export const canAdd = (c: Circle, userId: string | null | undefined, now = Date.now()) =>
  c.circle_members.some((m) => m.user_id === userId && m.role !== "viewer" && isCurrent(m, now));

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
  access_days?: number | null; // how long the access lasts once accepted; null: no end
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

// Member colours, from the activity palette, handed out in seat order.
const SEAT_COLORS = ["lilac", "sky", "sage", "amber", "rose", "teal", "clay", "slate"];

export interface Seat extends CircleMember {
  color: string;
  letter: string;
}

/** Members in seat order (owner first, then by email), each with a stable colour and initial. */
export function seatsOf(c: Circle): Seat[] {
  return [...c.circle_members]
    .sort((a, b) => Number(b.role === "owner") - Number(a.role === "owner") || a.email.localeCompare(b.email))
    .map((m, n) => ({ ...m, color: SEAT_COLORS[n % SEAT_COLORS.length], letter: m.email[0].toUpperCase() }));
}

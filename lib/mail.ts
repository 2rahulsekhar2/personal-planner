import nodemailer from "nodemailer";

export interface InviteMail {
  to: string;
  circleName: string;
  inviterEmail: string;
  role: string;
  accessDays: number | null;
  link: string;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** The invite as an email. Names come from users, so the HTML copy escapes them and the subject drops line breaks. */
export function buildInviteEmail(m: InviteMail) {
  const stay = m.accessDays ? ` Your access lasts ${m.accessDays === 1 ? "1 day" : `${m.accessDays} days`} from when you join.` : "";
  const viewer = m.role === "viewer" ? " You are invited as a viewer: you can look, but not add." : "";
  const what = `You will see what members share with this circle. Your own calendar stays private unless you share an item.${viewer}${stay}`;
  const how = `Open the link and sign in with ${m.to}. The invite works for 7 days.`;
  return {
    subject: `${m.inviterEmail} invited you to ${m.circleName} on Planner`.replace(/[\r\n]+/g, " "),
    text: `${m.inviterEmail} invited you to "${m.circleName}" on Planner.\n\n${what}\n\n${how}\n${m.link}\n\nIf you did not expect this, ignore this email.`,
    html: `<p><strong>${esc(m.inviterEmail)}</strong> invited you to <strong>${esc(m.circleName)}</strong> on Planner.</p>`
      + `<p>${esc(what)}</p><p>${esc(how)}</p>`
      + `<p><a href="${esc(m.link)}">Join ${esc(m.circleName)}</a></p>`
      + `<p style="color:#666">If you did not expect this, ignore this email.</p>`,
  };
}

/** True when the Gmail account that sends mail is configured. */
export const mailReady = () => !!process.env.GMAIL_USER && !!process.env.GMAIL_APP_PASSWORD;

/** Sends through Gmail with an app password. Replies go to the person who invited, not to the sending mailbox. */
export async function sendInviteEmail(m: InviteMail) {
  const transport = nodemailer.createTransport({ service: "gmail", auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD } });
  await transport.sendMail({ from: `"Planner" <${process.env.GMAIL_USER}>`, to: m.to, replyTo: m.inviterEmail, ...buildInviteEmail(m) });
}

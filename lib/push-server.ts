import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";

let configured = false;
function configure() {
  if (configured) return;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:admin@example.com",
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
  configured = true;
}

export interface PushPayload {
  title: string;
  body: string;
  tag?: string;
  url?: string;
}

/**
 * Send a payload to every device the user enabled. Expired subscriptions
 * (404/410) are removed. Returns how many devices accepted the message.
 */
export async function sendToUser(admin: SupabaseClient, userId: string, payload: PushPayload) {
  configure();
  const { data: subs, error } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId);
  if (error) throw error;

  let delivered = 0;
  let failed = 0;
  await Promise.all(
    (subs ?? []).map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload),
          { TTL: 60 * 60, urgency: "high" },
        );
        delivered++;
        await admin.from("push_subscriptions").update({ last_success_at: new Date().toISOString() }).eq("id", s.id);
      } catch (err: unknown) {
        failed++;
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) {
          await admin.from("push_subscriptions").delete().eq("id", s.id);
        }
      }
    }),
  );
  return { devices: subs?.length ?? 0, delivered, failed };
}

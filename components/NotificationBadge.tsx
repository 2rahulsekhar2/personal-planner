"use client";
import { useEffect, useState } from "react";
import { getNotificationStatus, type NotificationStatus } from "@/lib/push-client";

export const STATUS_LABEL: Record<NotificationStatus, string> = {
  enabled: "Reminders on",
  "not-enabled": "Reminders off",
  blocked: "Reminders blocked",
  unsupported: "Reminders unsupported",
  "needs-home-screen": "Add to Home Screen for reminders",
};

export function useNotificationStatus() {
  const [status, setStatus] = useState<NotificationStatus | null>(null);
  useEffect(() => {
    let alive = true;
    const check = () => getNotificationStatus().then((s) => alive && setStatus(s)).catch(() => alive && setStatus("unsupported"));
    check();
    document.addEventListener("visibilitychange", check);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", check);
    };
  }, []);
  return [status, setStatus] as const;
}

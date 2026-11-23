import { DateTime } from "luxon";
import type { Appointment, ActivityType } from "@/lib/types";

/**
 * A day drawn as one bar, 6 AM to 10 PM: each appointment a block in its activity's colour, a tentative one
 * hatched, a tick for now. What is left is the free time. Pass the day's appointments, cancelled ones left out.
 */
export default function DayBar({ appts, typeById, day, tz, now = DateTime.now() }: { appts: Appointment[]; typeById: Map<string, ActivityType>; day: string; tz: string; now?: DateTime }) {
  const from = DateTime.fromISO(day, { zone: tz }).startOf("day").set({ hour: 6 });
  const at = (d: DateTime) => Math.max(0, Math.min(100, (d.diff(from, "minutes").minutes / (16 * 60)) * 100));
  const blocks = appts.map((a) => {
    const left = at(DateTime.fromISO(a.starts_at).setZone(tz));
    return { id: a.id, left, width: at(DateTime.fromISO(a.ends_at).setZone(tz)) - left, color: typeById.get(a.activity_type_id ?? "")?.color ?? "slate", tentative: a.status === "tentative" };
  }).filter((b) => b.width > 0);
  const nowAt = now.setZone(tz).toISODate() === day ? at(now.setZone(tz)) : null;
  return (
    <div className="day-bar-wrap">
      <div className="day-bar" role="img" aria-label={`${appts.length} ${appts.length === 1 ? "appointment" : "appointments"} between 6 AM and 10 PM`}>
        {blocks.map((b) => <span key={b.id} className={`day-bar-block act-${b.color} ${b.tentative ? "is-tentative" : ""}`} style={{ left: `${b.left}%`, width: `${b.width}%` }} />)}
        {nowAt !== null && nowAt > 0 && nowAt < 100 && <span className="day-bar-now" style={{ left: `${nowAt}%` }} />}
      </div>
      {/* Every third hour, each label under its own place on the bar. */}
      <div className="day-bar-hours" aria-hidden>{[6, 9, 12, 15, 18, 21].map((h) => <span key={h} style={{ left: `${((h - 6) / 16) * 100}%` }}>{h > 12 ? h - 12 : h}</span>)}</div>
    </div>
  );
}

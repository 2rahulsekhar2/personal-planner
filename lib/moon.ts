// Moon phase from the mean synodic month, counted from the new moon of 2000-01-06 18:14 UTC. Good to a few hours.
export function moonPhase(d: Date): number {
  const days = (d.getTime() - Date.UTC(2000, 0, 6, 18, 14)) / 86400000;
  return ((days / 29.530588853) % 1 + 1) % 1;
}

/** Every ISO date from `start` to `end` inclusive (UTC, so no DST drift);
 *  empty for a malformed or inverted range, capped at a year. B2435. */
export function tripDays(start: string, end: string): string[] {
  const a = Date.parse(`${start}T00:00:00Z`);
  const b = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return [];
  const days: string[] = [];
  for (let t = a; t <= b && days.length < 366; t += 86_400_000) days.push(new Date(t).toISOString().slice(0, 10));
  return days;
}

/**
 * Turning a wall clock in a named zone into a true instant, and back.
 *
 * No dependency, and deliberately not a stored offset — `lib/digest/quiet.ts`
 * already made this argument: "the offset of Europe/Zurich is not a
 * constant", so the only correct source is `Intl` asked about the actual
 * date, not today's. Shared between `lib/feed.ts` (server, building an RSS
 * `pubDate`) and `components/DualTime.tsx` (browser, after hydration, once it
 * knows the reader's own zone) — neither runs on the other's side of that
 * line, but both need the identical conversion, so it lives once, with no
 * "server-only" import.
 */

/** How far `zone`'s wall clock is ahead of UTC, in minutes, at the instant
 * `at` — read off `Intl` rather than a table, so DST is never a special case. */
function offsetMinutesAt(zone: string, at: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24, // midnight renders "24" in some locales' h23
    Number(parts.minute),
    Number(parts.second),
  );
  return (asIfUtc - at.getTime()) / 60_000;
}

/**
 * The true UTC instant for wall clock `time` (HH:mm) on `date` (YYYY-MM-DD)
 * in `zone`.
 *
 * Two passes: the first guesses the instant as if the wall clock were UTC,
 * reads `zone`'s offset there, and corrects; the second re-reads the offset
 * at the corrected instant, in case the first guess landed on the far side of
 * a DST transition. Good enough for a travel day's own clock — the one hour a
 * year a zone's clock repeats itself is a corner nothing here claims to
 * resolve exactly.
 */
export function zonedTimeToUtc(date: string, time: string, zone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const wallAsUtc = Date.UTC(y, m - 1, d, hh, mm, 0);
  let instantMs = wallAsUtc;
  for (let i = 0; i < 2; i++) {
    instantMs = wallAsUtc - offsetMinutesAt(zone, new Date(instantMs)) * 60_000;
  }
  return new Date(instantMs);
}

/** `date`/`time` local to `zone`, read back as HH:mm local to `targetZone` —
 * what the dual clock shows for the reader's own equivalent. */
export function formatTimeInZone(date: string, time: string, zone: string, targetZone: string): string {
  const instant = zonedTimeToUtc(date, time, zone);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: targetZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(instant);
}

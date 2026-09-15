/**
 * "How long have I got?" as a duration, not a timestamp — B1805.
 *
 * The resume screen used to hand a person `run.expiresAt` and a
 * `toLocaleString()`, which makes them do the arithmetic against today's
 * date and the current time themselves. This turns the same two instants
 * into the answer they actually want, at the precision the urgency calls
 * for: days and hours far out, minutes once it is down to a few hours,
 * seconds in the last one.
 *
 * Pure — no clock of its own, `now` is a parameter — so both the formatting
 * and the zero/past-zero edge can be tested without `Date.now()` or a
 * timer.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** The pivot between the "days and hours" tier and the "minutes" tier — the
 *  ticket's own "a few hours". */
const FEW_HOURS = 3 * HOUR;

export type CountdownTier =
  | { unit: "now" }
  | { unit: "days"; days: number; hours: number }
  | { unit: "minutes"; minutes: number }
  | { unit: "seconds"; seconds: number };

/**
 * `expiresAt` and `now` as an ISO string and a `Date` — never a bare number
 * of milliseconds — because every caller already has the two as a manifest
 * field and a clock reading, and turning them into a duration is this
 * function's whole job.
 *
 * The sweep runs when somebody *starts* a run, not on a timer, so a run can
 * sit past its own `expiresAt` and still be listed — `ms <= 0` reads as
 * "now", never a negative count.
 */
export function countdownFor(expiresAt: string, now: Date): CountdownTier {
  const ms = Date.parse(expiresAt) - now.getTime();
  if (ms <= 0) return { unit: "now" };
  if (ms >= FEW_HOURS) {
    return { unit: "days", days: Math.floor(ms / DAY), hours: Math.floor((ms % DAY) / HOUR) };
  }
  if (ms >= HOUR) {
    return { unit: "minutes", minutes: Math.ceil(ms / MINUTE) };
  }
  return { unit: "seconds", seconds: Math.ceil(ms / 1000) };
}

/**
 * How soon the display needs to be recomputed for this tier to stay honest
 * — a per-second re-render of "2 days left" is wasted work on a phone, and
 * the resume list can hold several runs at once.
 *
 * `0` means "never on its own" — a run already at `now` does not need a
 * timer to keep saying so.
 */
export function tickIntervalFor(tier: CountdownTier): number {
  switch (tier.unit) {
    case "now":
      return 0;
    case "days":
      return MINUTE;
    case "minutes":
      return 30_000;
    case "seconds":
      return 1000;
  }
}

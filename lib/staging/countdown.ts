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
 * How soon the display needs to be recomputed for this tier to stay honest.
 *
 * One second at every tier that is still counting, because `segmentsFor`
 * draws a seconds box at every one of them — a coarser interval would leave
 * that box frozen for a minute and then jump it by sixty, which reads as a
 * broken clock rather than a saved wake-up. It is one shared `setTimeout`
 * over a handful of cards, not a per-frame animation.
 *
 * `0` means "never on its own" — a run already at `now` does not need a
 * timer to keep saying so.
 */
export function tickIntervalFor(tier: CountdownTier): number {
  return tier.unit === "now" ? 0 : 1000;
}

/**
 * The ticker's four states — B1806. The same tiers `countdownFor` already
 * sorts a run into, read as a colour and a shape rather than a sentence:
 * `calm` while a whole day remains, `soon` once it drops under a day (both
 * the "days" tier once it has run out of days, and the whole of the
 * "minutes" tier — the ticket's own "under a day, at least an hour" rung),
 * `urgent` under an hour, and `gone` once the run is already past its own
 * deadline and the sweep just hasn't reached it yet.
 */
export type Urgency = "calm" | "soon" | "urgent" | "gone";

export function urgencyFor(tier: CountdownTier): Urgency {
  switch (tier.unit) {
    case "now":
      return "gone";
    case "days":
      return tier.days > 0 ? "calm" : "soon";
    case "minutes":
      return "soon";
    case "seconds":
      return "urgent";
  }
}

/** One digit box — `01`, labelled `days`. */
export type Segment = { unit: "days" | "hours" | "minutes" | "seconds"; value: number };

/**
 * The digit boxes to draw for one tier — B1806.
 *
 * Four segments while a whole day remains, three below that, two below an
 * hour: the same shape the design draft calls for, derived from the tier
 * `countdownFor` already computed rather than a second set of thresholds
 * that could drift from it. Values are floored straight from the
 * milliseconds remaining — not read back off the tier's own rounded fields,
 * since the "minutes" tier reports one lump sum for its sentence
 * (`describe()` in `ResumeScreen.tsx`) and the ticker needs the hours and
 * seconds inside that sum broken back out.
 *
 * `ms` is the same value `countdownFor` was given to produce `tier` — pass
 * `Date.parse(run.expiresAt) - now.getTime()`, not clamped: this function
 * clamps it itself, so a run already past zero still gets a well-formed
 * (all-00) set of segments rather than negative digits.
 */
export function segmentsFor(tier: CountdownTier, ms: number): Segment[] {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (tier.unit === "now") {
    return [
      { unit: "hours", value: 0 },
      { unit: "minutes", value: 0 },
      { unit: "seconds", value: 0 },
    ];
  }
  if (tier.unit === "days" && tier.days > 0) {
    return [
      { unit: "days", value: days },
      { unit: "hours", value: hours },
      { unit: "minutes", value: minutes },
      { unit: "seconds", value: seconds },
    ];
  }
  if (tier.unit === "seconds") {
    return [
      { unit: "minutes", value: minutes },
      { unit: "seconds", value: seconds },
    ];
  }
  // "days" tier with no days left (3h–24h out) or the "minutes" tier
  // (1h–3h out) — both read as the same three-segment shape.
  return [
    { unit: "hours", value: Math.floor(totalSeconds / 3600) },
    { unit: "minutes", value: minutes },
    { unit: "seconds", value: seconds },
  ];
}

/**
 * How much of the *current* window is left, 0..1 — the hairline bar under
 * the digits, B1806.
 *
 * "Current" because an extension changes what window is being measured
 * against, and the bar has to refill rather than stay pinned to whatever
 * fraction of the *original* 48 hours happened to be left the moment it was
 * extended. The window's start is read off whichever of the manifest's own
 * timestamps last moved the deadline — `extendedAt` if the run has been
 * extended, else `warnedAt` if it has been warned, else `createdAt` — and
 * its length is simply `expiresAt` minus that start, since every place that
 * sets `expiresAt` (`start`, `extendOnTouch`, the nightly sweep's own warn
 * branch) sets it to exactly "now plus this window's length" by
 * construction. Reading it back this way needs no constant of its own, and
 * so cannot drift from whichever of them last wrote `expiresAt`.
 *
 * Never negative, never over 1: a run already past its own `expiresAt`
 * reads as an empty bar, not an empty-then-negative one.
 */
export function windowFractionFor(
  run: { createdAt: string; warnedAt?: string; extendedAt?: string; expiresAt: string },
  now: Date,
): number {
  const start = Date.parse(run.extendedAt ?? run.warnedAt ?? run.createdAt);
  const end = Date.parse(run.expiresAt);
  const total = end - start;
  if (total <= 0) return 0;
  return Math.max(0, Math.min(1, (end - now.getTime()) / total));
}

/**
 * Pure date math for B2197's local notices — kept apart from the shell-only
 * effect that calls `@capacitor/local-notifications` so it can be unit
 * tested with no Capacitor, no device clock and no simulator. All inputs and
 * outputs are device-local: a trip's `start`/`end` are `YYYY-MM-DD` with no
 * timezone of their own, so "18:00 the evening before" means 18:00 in
 * whatever zone the phone itself is in — the only clock a phone has.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** `YYYY-MM-DD` at local midnight. `NaN` for anything else. */
function localMidnight(dateISO: string): number {
  const [y, m, d] = dateISO.split("-").map(Number);
  if (!y || !m || !d) return NaN;
  return new Date(y, m - 1, d).getTime();
}

/**
 * When to fire "Your trip to <title> starts tomorrow. Record your route?" —
 * B2197. 18:00 device time the evening before `start`, or three hours from
 * `nowMs` if that moment has already passed and the trip has not started
 * yet. `null` once the trip has started (or ended) — there is nothing left
 * to ask before.
 */
export function beforeTripNoticeTime(nowMs: number, trip: { start: string }): number | null {
  const startMidnight = localMidnight(trip.start);
  if (Number.isNaN(startMidnight)) return null;
  if (nowMs >= startMidnight) return null; // already started
  const eveningBefore = startMidnight - DAY_MS + 18 * HOUR_MS;
  if (eveningBefore > nowMs) return eveningBefore;
  return nowMs + 3 * HOUR_MS;
}

/**
 * The cooldown end — D2: one full day after the trip's last day, at local
 * midnight. Also the moment `status()` must report the trip off without
 * anything being tapped, and the moment the stop notice fires (unless
 * open-ended, D3).
 */
export function stopNoticeTime(trip: { end: string }): number {
  const endMidnight = localMidnight(trip.end);
  return endMidnight + 2 * DAY_MS;
}

/** Every 7 days from `sinceMs` while a trip stays open-ended (D3) — the
 * next reminder due strictly after `nowMs`. */
export function nextOpenEndedReminder(sinceMs: number, nowMs: number): number {
  const interval = 7 * DAY_MS;
  if (nowMs < sinceMs) return sinceMs + interval;
  const elapsed = nowMs - sinceMs;
  const cycles = Math.floor(elapsed / interval) + 1;
  return sinceMs + cycles * interval;
}

export type NoticeTrip = { id: string; title: string; start: string; end: string };

/** A future trip earns a before-trip notice once: not started, not armed,
 * not declined. Used by the hub's scheduling effect to decide which trips
 * to (re)schedule and which to cancel — B2197's "changed dates or a deleted
 * trip reschedule or cancel it on the next load". */
export function tripsNeedingBeforeNotice(
  nowMs: number,
  trips: readonly NoticeTrip[],
  armedOrDeclined: ReadonlySet<string>,
): NoticeTrip[] {
  return trips.filter((trip) => !armedOrDeclined.has(trip.id) && localMidnight(trip.start) > nowMs);
}

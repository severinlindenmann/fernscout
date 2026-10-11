import { kmBetween, type Point } from "../mapFrame";

/**
 * B-2980 — pure rules the map page applies before anything is drawn: which
 * photo pins are believable, which days a non-live reader must not see yet.
 */

/** A pin farther than this from everything the day says about itself is a bad tag. */
const PIN_MAX_KM = 300;

/** (0,0) is "no fix", not the Gulf of Guinea; and a pin must sit near its day's route/place when the day has one. */
export function plausiblePin(pin: Point, refs: readonly Point[], maxKm = PIN_MAX_KM): boolean {
  if (pin.lat === 0 && pin.lng === 0) return false;
  if (refs.length === 0) return true;
  return refs.some((r) => kmBetween(r, pin) <= maxKm);
}

/** Pins that belong to the region on screen; none of the others may stretch its fit. */
export function pinsInRegion<P extends Point>(pins: readonly P[], places: readonly Point[], maxKm = PIN_MAX_KM): P[] {
  if (places.length === 0) return [...pins];
  return pins.filter((p) => places.some((q) => kmBetween(q, p) <= maxKm));
}

/** The same 24 h rule `readerTrack` keeps for recordings: from this date on, a day is "too recent" for a reader without live access. */
export function recentCutoffDate(now = Date.now()): string {
  return new Date(now - 24 * 3_600_000).toISOString().slice(0, 10);
}

export const isTooRecent = (date: string, live: boolean, now = Date.now()): boolean =>
  !live && date >= recentCutoffDate(now);

/**
 * Each calendar date mapped to the day number of the place that stay is drawn
 * as. `getPlaces` merges consecutive same-name days into one place numbered by
 * its first day, so every date from `firstDate` to `lastDate` takes that number.
 */
export function placeDayByDate(
  days: readonly { date: string }[],
  places: readonly { firstDate: string; lastDate: string }[],
  dayNumberByDate: ReadonlyMap<string, number>,
): Map<string, number> {
  const out = new Map<string, number>(dayNumberByDate);
  for (const place of places) {
    const n = dayNumberByDate.get(place.firstDate);
    if (n === undefined) continue;
    for (const d of days) if (d.date >= place.firstDate && d.date <= place.lastDate) out.set(d.date, n);
  }
  return out;
}

/** Whether two recorded pieces may be bridged: one original segment and a short hole, never across a cut spot. */
const BRIDGE_MAX_KM = 2;
export function mayBridge(a: Point, b: Point, sameSegment: boolean): boolean {
  return sameSegment && kmBetween(a, b) < BRIDGE_MAX_KM;
}

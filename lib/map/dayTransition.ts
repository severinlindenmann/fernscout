/**
 * B-2980 — pure decisions behind moving from one day to the next on the map:
 * which day is adjacent, and how the camera should travel between them.
 * Kept free of MapLibre and React so the thresholds can be run and argued with.
 */

/** A leg this long is a flight whatever the day's own entry says. */
export const FLIGHT_KM = 600;

/** The adjacent date in `dates` (in order), or null at either end or for an unknown date. No wrap-around: the ends are ends. */
export function adjacentDate(dates: readonly string[], date: string | null, step: 1 | -1): string | null {
  if (date === null) return null;
  const i = dates.indexOf(date);
  if (i < 0) return null;
  return dates[i + step] ?? null;
}

/** Great-circle distance in kilometres. */
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type CameraPlan =
  /** Reduced motion: no animation at all. */
  | { kind: "jump" }
  /** Short hop: ease along, via a frame holding both ends when neither view does. */
  | { kind: "hop"; duration: number }
  /** A flight or a very long leg: slower, with a high arc (zoom out, then in). */
  | { kind: "flight"; duration: number; curve: number };

export function planCamera(input: { km: number; flight: boolean; reduced: boolean }): CameraPlan {
  if (input.reduced) return { kind: "jump" };
  if (input.flight || input.km > FLIGHT_KM) {
    return { kind: "flight", duration: Math.round(1600 + Math.min(input.km, 5000) * 0.12), curve: 1.9 };
  }
  // 700ms for a hop next door, up to 900ms for the longest short leg.
  return { kind: "hop", duration: Math.round(700 + (Math.min(input.km, FLIGHT_KM) / FLIGHT_KM) * 200) };
}

/**
 * B-2980: whether the camera should travel (rather than frame in place) when
 * the overview changes — a region chip, or the whole-trip chip. Only between
 * two views of one map, only with no day selected (a day has its own travel).
 * `prev` is undefined on a map's first frame.
 */
export function viewTravels(prev: string | undefined, next: string, selectedDay: number | null): boolean {
  return selectedDay === null && prev !== undefined && prev !== next;
}

/** A region switch spans more than a region apart (300 km+), so it flies. */
export const REGION_FLIGHT_KM = 300;

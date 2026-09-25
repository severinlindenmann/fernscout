/**
 * Pure planner helpers — B2011. No fs, no fetch, safe to import from a
 * client component and to unit-test directly.
 *
 * `previewNightsSchedule` mirrors `derivePlan`'s own nights-mode loop
 * (`lib/api/v2/write.ts`) on purpose: the server is the one place a saved
 * route's dates are actually derived, but the composer's confirm card has to
 * show "Arrive 20 Feb, leave 22 Feb, X moves to 22 Feb" *before* the person
 * saves anything, so this is the same arithmetic, kept in one place so
 * the preview and the save never disagree about what nights mode means.
 */

export type ScheduleStop = {
  id?: string;
  location: string;
  nights?: number;
  arrive?: string;
  leave?: string;
};

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The nights-mode derivation, exactly as `derivePlan` runs it server-side —
 * a stop with no `nights` keeps the `arrive` the chain already carried it
 * to, loses its own `leave`, and every later stop loses both. */
export function previewNightsSchedule<T extends ScheduleStop>(route: readonly T[], tripStart: string): T[] {
  let cursor: string | undefined = tripStart;
  return route.map((stop) => {
    let nights = stop.nights;
    if (nights === undefined && stop.arrive !== undefined && stop.leave !== undefined) {
      nights = daysBetween(stop.arrive, stop.leave);
    }
    if (cursor === undefined) {
      return { ...stop, nights, arrive: undefined, leave: undefined } as T;
    }
    const arrive = cursor;
    if (nights !== undefined) {
      const leave = addDays(arrive, nights);
      cursor = leave;
      return { ...stop, nights, arrive, leave } as T;
    }
    cursor = undefined;
    return { ...stop, nights, arrive, leave: undefined } as T;
  });
}

/** Move one stop from `from` to `to` (both indices into `route`), returning
 * a new array — the shared reorder for Up/Down chips and for a completed
 * drag, so the two paths cannot drift apart on what "move" means. */
export function moveStop<T>(route: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= route.length || to < 0 || to >= route.length || from === to) return [...route];
  const next = [...route];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** "Chiang Mai → **Chiang Rai** → Luang Prabang" as three parts, so the
 * caller can bold the middle one — the fix for the Codex finding that
 * "after …" chips hid the insertion point. `insertAt` is the index the new
 * stop WOULD occupy once inserted. */
export function sequenceContext(
  route: readonly { location: string }[],
  insertAt: number,
): { before: string | null; after: string | null } {
  const before = insertAt > 0 ? route[insertAt - 1]?.location ?? null : null;
  const after = insertAt < route.length ? route[insertAt]?.location ?? null : null;
  return { before, after };
}

const EARTH_RADIUS_KM = 6371;

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(la1) * Math.cos(la2);
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/** How close a new place has to be to an existing stop to read as "inside
 * that stop's town" rather than a new one — generous like `lib/plan.ts`'s
 * own `REACHED_KM`, but tighter: that one asks "did we get there", this one
 * asks "is this the same town", and a stop 75km away is not the same town. */
const SAME_TOWN_KM = 15;

/** How close a WhatsApp pin has to be to an existing stop to say so and offer
 * "a visit in X" — the same generosity as the trip map's own reached marker
 * (`REACHED_KM`, `lib/plan.ts`), duplicated rather than imported because that
 * module is `server-only` and this one has to run in the composer's own
 * client bundle. A pin is a rough drop from a moving phone, not a typed
 * search, so it earns the looser of the two thresholds this file has. */
export const PIN_NEAR_KM = 75;

/** The nearest stop within `SAME_TOWN_KM` (or a caller-supplied threshold,
 * such as `PIN_NEAR_KM`), or `null` when the point is nobody's town yet —
 * the fork between "a visit in X" and "a new stop". */
export function nearestStopWithin<T extends { lat: number; lng: number }>(
  route: readonly T[],
  point: { lat: number; lng: number },
  kmThreshold = SAME_TOWN_KM,
): T | null {
  let best: T | null = null;
  let bestKm = Infinity;
  for (const stop of route) {
    const km = haversineKm(stop, point);
    if (km <= kmThreshold && km < bestKm) {
      best = stop;
      bestKm = km;
    }
  }
  return best;
}

/** For a brand-new stop with no existing town to join, the index of the
 * geographically nearest stop already in the route — the sensible default
 * insertion point ("after the place you are already closest to") rather
 * than always appending at the end. `null` on an empty route. */
export function nearestStopIndex<T extends { lat: number; lng: number }>(
  route: readonly T[],
  point: { lat: number; lng: number },
): number | null {
  if (route.length === 0) return null;
  let best = 0;
  let bestKm = Infinity;
  route.forEach((stop, i) => {
    const km = haversineKm(stop, point);
    if (km < bestKm) {
      best = i;
      bestKm = km;
    }
  });
  return best;
}

/** A name that reads as somewhere to sleep rather than somewhere to visit —
 * one keyword list, English only like `readPasted.ts`'s own category guess,
 * used only to pick which confirm card to show first; the person always
 * sees both options as chips and can correct a wrong guess in one tap. */
const STAY_WORDS = /\b(hotel|hostel|inn|ryokan|guesthouse|guest house|resort|B&B|bnb)\b/i;

export function looksLikeStay(name: string): boolean {
  return STAY_WORDS.test(name);
}

/** Every date the route's own stays do not cover — the mode switch's own
 * "1 gap: 15 Feb has no stop" line. A gap is never blocked, only shown
 * (the ticket's own words): consecutive stops whose leave/arrive do not
 * meet leave one open day between them, named by its first uncovered date. */
export function findGaps(route: readonly { arrive?: string; leave?: string }[]): string[] {
  const gaps: string[] = [];
  for (let i = 0; i < route.length - 1; i++) {
    const a = route[i];
    const b = route[i + 1];
    if (a.leave !== undefined && b.arrive !== undefined && a.leave !== b.arrive) {
      gaps.push(a.leave);
    }
  }
  return gaps;
}

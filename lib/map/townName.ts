import "server-only";
import { geodataAvailable, reverseGeocode } from "../ingest/geo";

/**
 * The town-level name a reader's map should show for a coordinate — B2543,
 * the plan's own "Places and names" rule: a map label, a chip and the map
 * page's day strip all draw at town level ("Bangkok"), never the owner's own
 * words for the day ("Khlong Toei District", a nature reserve's full name, a
 * single landmark). The day page and every list outside the map keep the
 * owner's text exactly as written — this is a map-drawing rule, not a
 * privacy one, so it is never reader/owner-gated the way `isHiddenPlace`/
 * `isHomePlace` are.
 *
 * Backed by the same offline index `reverseGeocode` (`lib/ingest/geo.ts`)
 * already uses for photo captions, asked for the coarser answer
 * (`townOnly: true`, B2543's own addition there) that skips a GeoNames
 * section the way `placesInBox` already did for a route map's own labels.
 *
 * Falls back to `fallback` (the owner's own text) when the index is not
 * built at all, or holds nothing within reach of this point — never blank,
 * never a guess.
 *
 * Cached per coordinate, rounded to three decimal places (~100 m, well
 * inside `SAME_PLACE_KM`'s 5 km "same stop" radius): the lookup itself is
 * cheap once loaded, but a caller can run this once per day of a
 * thousand-day trip and the same stop repeats for many of them.
 */
const cache = new Map<string, string | null>();

export function townNameFor(lat: number, lng: number, fallback: string): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !geodataAvailable()) return fallback;
  const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  let name = cache.get(key);
  if (name === undefined) {
    name = reverseGeocode(lat, lng, { townOnly: true })?.name ?? null;
    cache.set(key, name);
  }
  return name ?? fallback;
}

/** Test seam — a long-lived process (dev server, test runner) must not let
 * one trip's coordinates answer for another's after a fixture changes. */
export function clearTownNameCache(): void {
  cache.clear();
}

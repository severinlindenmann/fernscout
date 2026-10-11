import "server-only";
import { getDays, placeEntry, type ReadOptions } from "@/lib/entries";
import { pinTooRecent, plausiblePin } from "./mapSafety";
import { kmBetween } from "@/lib/mapFrame";
import { isHiddenPlace, readTrackEdits } from "@/lib/gps/edits";
import { isHomePlace } from "@/lib/gps/enrich";
import { mediaKey } from "@/lib/photos";
import { readTripSidecar } from "@/lib/sidecar";
import { parseTripRef } from "@/lib/trips";
import type { GalleryItem } from "@/lib/types";

/** A photograph drawn at its own measured position — B-2980. */
export type PhotoPin = {
  lat: number;
  lng: number;
  date: string;
  item: GalleryItem;
  /** The nearest recorded-route point, only when within `TETHER_M` of it. */
  tether?: [number, number];
};

const TETHER_M = 150;
const STRETCH_MARGIN_MIN = 30;

const minutes = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/**
 * Whether a photo was taken during a stretch the owner cut from the route.
 * `takenAt` is camera wall-clock, a stretch is local wall-clock on its date,
 * so the two compare directly with no timezone and no GPS store, widened by a
 * margin for camera clock drift. No usable `takenAt` fails closed.
 */
export function inHiddenStretch(takenAt: string | undefined, date: string, stretches: { date: string; from: string; to: string }[]): boolean {
  if (stretches.length === 0) return false;
  // Camera wall-clock as written: `YYYY-MM-DDTHH:MM[:SS[.fff]]`, optionally with an offset. A UTC `Z` time or
  // anything else cannot be compared with a local wall clock, so it is not parsed.
  const m = takenAt?.match(/^(\d{4}-\d\d-\d\d)[T ](\d\d:\d\d)(?::\d\d(?:\.\d+)?)?(Z|[+-]\d\d:?\d\d)?$/);
  // Both the entry's day and the day the photo says it was taken on count: a photo from a stretch day
  // filed under another day's entry must not slip past.
  const mine = stretches.filter((s) => s.date === date || (m !== null && m !== undefined && s.date === m[1]));
  if (mine.length === 0) return false;
  if (!m || m[3] === "Z") return true;
  const at = minutes(m[2]);
  return mine.some((s) => m[1] === s.date && at >= minutes(s.from) - STRETCH_MARGIN_MIN && at <= minutes(s.to) + STRETCH_MARGIN_MIN);
}

/**
 * Pins for the photographs this reader may see. The sidecar is read here, on
 * the server, and only lat/lon leaves it. `getDays` already applied the same
 * `visible()` filter the gallery uses, so a photo labelled above this reader's
 * level is not in `entries` at all. Home zone, hidden spots and hidden stretches (by the photo's own clock time) are skipped the
 * way `getPlaces` skips them (never for the owner's own read).
 */
export function getPhotoPins(
  ref: string,
  options: ReadOptions | undefined,
  trackByDay: readonly { date?: string; points: [number, number][] }[],
  /** Whether this reader may see the last 24 h (owner, live guests); others get no pin from a day that recent. Closed by default: a caller that forgets it gets the stricter rule. */
  live = false,
): PhotoPin[] {
  const owner = parseTripRef(ref);
  if (!owner) return [];
  const checkHidden = options?.reader !== "person";
  const stretches = checkHidden ? readTrackEdits(owner.username, owner.tripId).hiddenStretches : [];
  const pins: PhotoPin[] = [];
  for (const day of getDays(ref, options)) {
    const route = trackByDay.filter((s) => s.date === day.date).flatMap((s) => s.points);
    // What the day itself says about where it was: its recording, else its typed place.
    const lead = placeEntry(day);
    const refs = route.length > 0
      ? route.map(([lat, lng]) => ({ lat, lng }))
      : Number.isFinite(lead.lat) && Number.isFinite(lead.lng) ? [{ lat: lead.lat as number, lng: lead.lng as number }] : [];
    for (const entry of day.entries) {
      for (const item of entry.gallery) {
        if (item.type !== "image") continue;
        const rel = mediaKey(item.src).split("/").slice(1).join("/");
        const side = rel ? readTripSidecar(ref, rel) : null;
        if (!side || !Number.isFinite(side.lat) || !Number.isFinite(side.lon)) continue;
        const [lat, lng] = [side.lat as number, side.lon as number];
        // A (0,0) fix or a tag hundreds of km from its own day is a bad tag, not a place.
        if (pinTooRecent(side.takenAt, day.date, live, Date.now(), { lat, lng })) continue;
        if (inHiddenStretch(side.takenAt, day.date, stretches)) continue;
        if (!plausiblePin({ lat, lng }, refs)) continue;
        if (checkHidden && (isHiddenPlace(owner.username, owner.tripId, { lat, lon: lng }) || isHomePlace(owner.username, { lat, lon: lng }))) continue;
        let tether: [number, number] | undefined;
        let best = TETHER_M / 1000;
        for (const p of route) {
          const km = kmBetween({ lat, lng }, { lat: p[0], lng: p[1] });
          if (km <= best) {
            best = km;
            tether = p;
          }
        }
        pins.push({ lat, lng, date: day.date, item, tether });
      }
    }
  }
  return pins;
}

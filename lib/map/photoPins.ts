import "server-only";
import { getDays, type ReadOptions } from "@/lib/entries";
import { kmBetween } from "@/lib/mapFrame";
import { isHiddenPlace } from "@/lib/gps/edits";
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

/**
 * Pins for the photographs this reader may see. The sidecar is read here, on
 * the server, and only lat/lon leaves it. `getDays` already applied the same
 * `visible()` filter the gallery uses, so a photo labelled above this reader's
 * level is not in `entries` at all. Home zone and hidden spots are skipped the
 * way `getPlaces` skips them (never for the owner's own read).
 */
export function getPhotoPins(
  ref: string,
  options: ReadOptions | undefined,
  trackByDay: readonly { date?: string; points: [number, number][] }[],
): PhotoPin[] {
  const owner = parseTripRef(ref);
  if (!owner) return [];
  const checkHidden = options?.reader !== "person";
  const pins: PhotoPin[] = [];
  for (const day of getDays(ref, options)) {
    const route = trackByDay.filter((s) => s.date === day.date).flatMap((s) => s.points);
    for (const entry of day.entries) {
      for (const item of entry.gallery) {
        if (item.type !== "image") continue;
        const rel = mediaKey(item.src).split("/").slice(1).join("/");
        const side = rel ? readTripSidecar(ref, rel) : null;
        if (!side || !Number.isFinite(side.lat) || !Number.isFinite(side.lon)) continue;
        const [lat, lng] = [side.lat as number, side.lon as number];
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

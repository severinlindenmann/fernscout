/**
 * OpenFreeMap — the hosted street-map tiles an operator can choose instead of
 * keeping PMTiles files under `MAPS_DIR` (FERN-6). Free, no key, no account,
 * commercial use allowed; tiles are OpenMapTiles-schema vector tiles cut from
 * OpenStreetMap, served from `tiles.openfreemap.org`.
 *
 * No `server-only` here: the client style (`paperFlavor.ts`) and the server
 * (`lib/maps/dir.ts`, the card renderer) both need to recognise the URL.
 */

/** `features.streetMaps.provider` — `lib/maps/dir.ts`'s `streetMapsProvider`. */
export type StreetMapsProvider = "local" | "openfreemap";
export const STREET_MAPS_PROVIDERS: readonly StreetMapsProvider[] = ["local", "openfreemap"];

export const OPENFREEMAP_ORIGIN = "https://tiles.openfreemap.org";

/** OpenFreeMap's TileJSON for the whole planet, z0–14. Its `tiles` template
 * names a dated build (`/planet/20261115_080022_pt/{z}/{x}/{y}.pbf`), so tile
 * URLs change with each weekly build and stay cacheable for good. */
export const OPENFREEMAP_TILEJSON = `${OPENFREEMAP_ORIGIN}/planet`;

/** The planet build's own deepest zoom; MapLibre overzooms past it. */
export const OPENFREEMAP_MAX_ZOOM = 14;

/** Glyphs for the three Noto Sans faces the style asks for, every Unicode
 * range — unlike `public/fonts/`, which carries Latin only. */
export const OPENFREEMAP_GLYPHS = `${OPENFREEMAP_ORIGIN}/fonts/{fontstack}/{range}.pbf`;

/** Whether a street-map URL handed to the client is OpenFreeMap's rather than
 * one of this instance's own `/api/maps/*.pmtiles` files. */
export function isOpenFreeMap(url: string): boolean {
  return url === OPENFREEMAP_TILEJSON;
}

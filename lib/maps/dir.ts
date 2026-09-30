import "server-only";
import fs from "node:fs";
import path from "node:path";

/**
 * Where an operator's Protomaps PMTiles files live — B2535.
 *
 * Unset means the capability is off (see lib/capabilities.ts): nothing here
 * is ever consulted unless `features.streetMaps` has already resolved `true`,
 * so a caller that skipped that check would read `undefined` rather than
 * some default path nobody configured.
 */
function mapsDir(): string | undefined {
  const dir = process.env.MAPS_DIR?.trim();
  return dir ? dir : undefined;
}

/** The one file `streetMaps` requires to exist before it can be on. */
function worldFile(): string | undefined {
  const dir = mapsDir();
  return dir ? path.join(dir, "world.pmtiles") : undefined;
}

function indexFile(): string | undefined {
  const dir = mapsDir();
  return dir ? path.join(dir, "index.json") : undefined;
}

/**
 * Only `[a-z0-9_-]` segments, joined by `/`, ending `.pmtiles` — B2535's
 * route contract. The charset alone refuses a traversal attempt: `..`, a
 * leading `/` and a trailing dot all contain a character this excludes, so
 * there is no path this can resolve outside `MAPS_DIR` to guard against
 * separately.
 */
const SAFE_RELATIVE_PATH = /^[a-z0-9_-]+(?:\/[a-z0-9_-]+)*\.pmtiles$/;

/**
 * Resolves a requested tile file to an absolute path under `MAPS_DIR`, or
 * `null` for anything that isn't exactly that — an unsafe name, a missing
 * `MAPS_DIR`, or a file that doesn't exist. The route this serves 404s on
 * `null` the same way it 404s on the capability being off, so neither a
 * prober nor a caller can tell the two apart.
 */
export function resolveMapsFile(segments: readonly string[]): string | null {
  const dir = mapsDir();
  if (!dir) return null;
  const rel = segments.join("/");
  if (!SAFE_RELATIVE_PATH.test(rel)) return null;
  const full = path.join(dir, rel);
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return null;
  return full;
}

/** A font stack name (e.g. `Noto Sans Regular`) — letters and spaces only,
 * matching the `@protomaps/basemaps` names this style actually asks for. No
 * `.`, so `..` can never appear, and no `/`, so a single dynamic route
 * segment already can't cross a directory boundary either way. */
const SAFE_FONT_STACK = /^[A-Za-z0-9 _-]+$/;
/** A glyph range, e.g. `1024-1279` — the `{start}-{end}` MapLibre asks for. */
const SAFE_FONT_RANGE = /^\d{1,6}-\d{1,6}$/;

/**
 * Resolves a `{fontstack}/{range}.pbf` glyph request to an absolute path —
 * `MAPS_DIR/fonts/<stack>/<range>.pbf` first (an operator's own full
 * download, `npm run maps:world`), then the Latin-only ranges shipped in
 * `public/fonts/` (this repo's own baked-in fallback). `null` for an unsafe
 * name or a range neither has — the route this serves answers that with an
 * empty glyph tile, never a 404 (B2560): a reader whose script needs a range
 * nobody has downloaded yet loses those characters, not the whole map.
 */
export function resolveFontFile(stack: string, range: string): string | null {
  if (!SAFE_FONT_STACK.test(stack) || !SAFE_FONT_RANGE.test(range)) return null;
  const rel = path.join(stack, `${range}.pbf`);
  const dir = mapsDir();
  if (dir) {
    const full = path.join(dir, "fonts", rel);
    if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
  }
  const fallback = path.join(process.cwd(), "public", "fonts", rel);
  if (fs.existsSync(fallback) && fs.statSync(fallback).isFile()) return fallback;
  return null;
}

/** One region's file and the bbox it covers, in `[minLon, minLat, maxLon, maxLat]`. */
export type MapRegion = { file: string; bbox: [number, number, number, number] };

/** Whether a point falls inside a region's own bbox — the "does this file
 * cover that place" test both `primaryStreetMap` and `streetMapRegionFiles`
 * callers need. */
function inBbox(point: { lat: number; lng: number }, bbox: MapRegion["bbox"]): boolean {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  return point.lng >= minLon && point.lng <= maxLon && point.lat >= minLat && point.lat <= maxLat;
}

/**
 * Among a trip's extracted region files, the one whose bbox covers the most
 * of `points` — B2560. An operator's `index.json` lists a trip's files in
 * whatever order `maps:trip` extracted them (often the operator's own home
 * region first, since that is wherever the GPS store starts), so picking
 * `[0]` picked "first extracted", not "the trip's own main region". `points`
 * is the caller's main-region day places (`tripFrame`'s own region rule);
 * ties, or an empty `points`, keep the first file — the previous behaviour,
 * and still the only sane answer when nobody can say which file matters
 * more.
 */
function pickCoveringRegion(
  regions: readonly MapRegion[],
  points: readonly { lat: number; lng: number }[],
): MapRegion {
  if (points.length === 0) return regions[0];
  let best = regions[0];
  let bestCount = -1;
  for (const region of regions) {
    const count = points.filter((p) => inBbox(p, region.bbox)).length;
    if (count > bestCount) {
      bestCount = count;
      best = region;
    }
  }
  return best;
}

type MapsIndex = { trips: Record<string, MapRegion[]> };

function readIndex(): MapsIndex | null {
  const file = indexFile();
  if (!file) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    if (raw && typeof raw === "object" && raw.trips && typeof raw.trips === "object") {
      return raw as MapsIndex;
    }
  } catch {
    // No index yet, or a bad one — same as "this trip has no file": the SVG
    // map is what renders, never a broken page.
  }
  return null;
}

/**
 * The region files `npm run maps:trip` has already extracted for this trip,
 * if any — the client picks among these rather than guessing a filename.
 * `undefined` (no entry, or `MAPS_DIR` unset) is the ordinary case for a
 * trip nobody has extracted yet, and callers fall back to the drawn map.
 * With a world file (B2566) it is never undefined: that file is appended.
 */
export function tripMapRegions(user: string, tripId: string): MapRegion[] | undefined {
  const index = readIndex();
  const key = `${user}/${tripId}`;
  const regions = index?.trips[key] ?? [];
  // B2566: the world file comes last, so a trip's own file wins wherever it
  // covers as many places (`pickCoveringRegion` needs strictly more) and the
  // world file covers every place no extract was ever cut for.
  const planet = planetRegion();
  const all = planet ? [...regions, planet] : regions;
  return all.length > 0 ? all : undefined;
}

/** `MAPS_DIR/planet.pmtiles` — one street-level file for the whole world
 * (`npm run maps:planet`, B2566). Web Mercator stops at ±85.0511°. */
const PLANET_FILE = "planet.pmtiles";

function planetRegion(): MapRegion | undefined {
  const dir = mapsDir();
  if (!dir || !fs.existsSync(path.join(dir, PLANET_FILE))) return undefined;
  return { file: PLANET_FILE, bbox: [-180, -85.0511, 180, 85.0511] };
}

/** The file a map with no trip behind it (the studio's private-zone picker)
 * draws: the world file at street level when there is one, else the z0–6
 * underlay every street-map instance has. */
export function worldStreetMapUrl(): string {
  return mapsFileUrl(planetRegion()?.file ?? "world.pmtiles");
}

/** The URL `components/map/StreetMap.tsx` fetches a region file from. */
function mapsFileUrl(relFile: string): string {
  return `/api/maps/${relFile}`;
}

export type StreetMapFile = { url: string; bounds: [[number, number], [number, number]] };

function toStreetMapFile(region: MapRegion): StreetMapFile {
  const [minLon, minLat, maxLon, maxLat] = region.bbox;
  return { url: mapsFileUrl(region.file), bounds: [[minLon, minLat], [maxLon, maxLat]] };
}

/**
 * This trip's primary region file, as the `StreetMap` prop the map pages
 * want — `undefined` whenever the SVG map should keep rendering instead (the
 * capability is off, or nothing has been extracted for this trip yet).
 *
 * `mainRegionPoints` is the trip's own main-region day places (the same
 * points `tripFrame`'s region rule already picked, e.g. via `framePoints`) —
 * whichever extracted file covers the most of them wins (B2560). Omitting it
 * (or passing none) keeps the previous behaviour of the first-listed file,
 * for a caller that has no places to check against.
 */
export function primaryStreetMap(
  user: string,
  tripId: string,
  mainRegionPoints: readonly { lat: number; lng: number }[] = [],
): StreetMapFile | undefined {
  const regions = tripMapRegions(user, tripId);
  if (!regions) return undefined;
  return toStreetMapFile(pickCoveringRegion(regions, mainRegionPoints));
}

/**
 * The region file (path + bbox) covering the most of `points` — the same
 * choice `primaryStreetMap` makes, for a server-side caller that reads the
 * file itself (the trip/day card, B2538) rather than handing a URL to the
 * browser. `undefined` under the same conditions as `tripMapRegions`.
 */
export function coveringRegion(
  user: string,
  tripId: string,
  points: readonly { lat: number; lng: number }[],
): MapRegion | undefined {
  const regions = tripMapRegions(user, tripId);
  return regions && regions.length > 0 ? pickCoveringRegion(regions, points) : undefined;
}

/**
 * Every region file `maps:trip` extracted for this trip, each with its own
 * bbox — what a reader's region switch (B2537/B2560) picks among client-side
 * so that switching regions still shows street tiles, not just moved
 * markers over the primary region's file. `undefined` under the same
 * conditions as `tripMapRegions`.
 */
export function streetMapRegionFiles(user: string, tripId: string): StreetMapFile[] | undefined {
  const regions = tripMapRegions(user, tripId);
  return regions?.map(toStreetMapFile);
}

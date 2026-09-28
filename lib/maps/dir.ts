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

/** One region's file and the bbox it covers, in `[minLon, minLat, maxLon, maxLat]`. */
export type MapRegion = { file: string; bbox: [number, number, number, number] };

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
 */
export function tripMapRegions(user: string, tripId: string): MapRegion[] | undefined {
  const index = readIndex();
  const key = `${user}/${tripId}`;
  const regions = index?.trips[key];
  return regions && regions.length > 0 ? regions : undefined;
}

/** The URL `components/map/StreetMap.tsx` fetches a region file from. */
function mapsFileUrl(relFile: string): string {
  return `/api/maps/${relFile}`;
}

/**
 * This trip's primary region, as the `StreetMap` prop the map pages want —
 * `undefined` whenever the SVG map should keep rendering instead (the
 * capability is off, or nothing has been extracted for this trip yet).
 * Only the first (largest) region: a trip that crosses several is B2537's
 * region-switcher to build, not this one.
 */
export function primaryStreetMap(
  user: string,
  tripId: string,
): { url: string; bounds: [[number, number], [number, number]] } | undefined {
  const region = tripMapRegions(user, tripId)?.[0];
  if (!region) return undefined;
  const [minLon, minLat, maxLon, maxLat] = region.bbox;
  return { url: mapsFileUrl(region.file), bounds: [[minLon, minLat], [maxLon, maxLat]] };
}

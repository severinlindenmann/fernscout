import "server-only";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { placesInBox } from "./ingest/geo";
import { DEG_PER_UNIT, kmForUnits, type Frame } from "./mapFrame";
import { MAP_VIEWBOX } from "./mapProjection.mjs";

/**
 * The piece of the world a trip's map is drawn on.
 *
 * B46 measured what the old basemap could say and the answer was almost
 * nothing: `lib/worldLand.json` is 1:110m *coastline*, its points 63 km apart,
 * with no borders, lakes or towns — so an inland trip was drawn on a blank
 * green field at every zoom, because Switzerland has no coast.
 *
 * This assembles the replacement, per frame, on the server:
 *
 * - **borders, lakes and rivers** clipped out of `mapdata/basemap.json.gz`,
 *   which `scripts/build-mapdata.mjs` bakes from Natural Earth 10m;
 * - **peaks** from the same file;
 * - **towns** from `ingest/data/places.bin.gz`, the GeoNames index that was
 *   already committed for reverse-geocoding photographs.
 *
 * Clipping here rather than in the browser is the whole point. The bundle is
 * eleven megabytes; a reader gets the few dozen kilobytes their trip actually
 * covers, and there is no generated artefact anywhere to go stale when a trip
 * grows a stop — the answer is derived per request from files on disk, exactly
 * as `getPlaces` is.
 */

/** One shape: its bounding box in projected units, then its SVG path. */
type Shape = [number, number, number, number, string];

type Bundle = {
  version: number;
  attribution: string;
  borders: Shape[];
  admin1: Shape[];
  relief: Shape[];
  glaciers: Shape[];
  parks: Shape[];
  railroads: Shape[];
  roads: Shape[];
  lakes: Shape[];
  rivers: Shape[];
  /** x, y, metres, name. */
  peaks: [number, number, number, string][];
};

export type BasemapLabel = {
  x: number;
  y: number;
  name: string;
  /** Metres, for a peak. Absent for a town. */
  metres?: number;
};

export type Basemap = {
  borders: string[];
  /** States, cantons, prefectures — the border crossed inside one country. */
  admin1: string[];
  /** Mountain ranges, plateaus and foothills — high ground, not contours. */
  relief: string[];
  glaciers: string[];
  /** Protected land. Natural Earth ships the US Park Service only. */
  parks: string[];
  /** Main lines and motorways. Empty unless the frame is close enough to care. */
  railroads: string[];
  roads: string[];
  lakes: string[];
  rivers: string[];
  peaks: BasemapLabel[];
  towns: BasemapLabel[];
  attribution: string;
};

/**
 * How many town labels a frame is allowed, before it becomes a wall of text.
 *
 * The ceiling is generous because `spread` below is what actually decides:
 * candidates are offered largest-first and rejected on collision, so a crowded
 * frame runs out of room long before it runs out of towns. On a phone the
 * frame is the same shape and the labels the same fraction of it, so the same
 * number fits — this is not a desktop figure being squeezed onto mobile.
 */
const MAX_TOWNS = 22;

/** And how many peaks. Fewer: they carry a name *and* an altitude. */
const MAX_PEAKS = 8;

/**
 * How wide a frame may be, in kilometres, before roads and railways are
 * dropped from it.
 *
 * They are the two heaviest layers in the bundle and the two that stop being
 * information soonest. On a map of Asia every motorway in China is a grey haze
 * laid over the route the trip actually took; on a map of one valley the road
 * *is* the trip. Eight hundred kilometres is about a long drive — the scale at
 * which "which way did they go" is still a question about roads.
 */
const WAYS_BELOW_KM = 800;

function bundleFile(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "mapdata", "basemap.json.gz");
}

let cached: Bundle | null | undefined;

/**
 * The baked bundle, or null if it was never built.
 *
 * Absent is a supported state, not an error: a checkout that has not run
 * `npm run build:mapdata` still serves maps, just without a basemap under
 * them. That is the same fallback a frame too close in for Natural Earth to
 * say anything about already gets, so there is a correct thing to draw.
 */
function bundle(): Bundle | null {
  if (cached !== undefined) return cached;
  const file = bundleFile();
  try {
    cached = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString("utf8")) as Bundle;
  } catch {
    cached = null;
  }
  return cached;
}

/** Test seam — the bundle is read once and held for the life of the process. */
export function clearBasemapCache(): void {
  cached = undefined;
}

/** Whether two boxes touch at all. */
function overlaps(shape: Shape, x0: number, y0: number, x1: number, y1: number): boolean {
  return shape[0] <= x1 && shape[2] >= x0 && shape[1] <= y1 && shape[3] >= y0;
}

function clip(shapes: Shape[], x0: number, y0: number, x1: number, y1: number): string[] {
  const out: string[] = [];
  for (const shape of shapes) if (overlaps(shape, x0, y0, x1, y1)) out.push(shape[4]);
  return out;
}

/**
 * The basemap for one frame.
 *
 * Coordinates come back in **uncorrected** projected units, the space the
 * bundle is baked in — the caller applies `frame.lngScale`, the same way it
 * already does for `lib/worldLand.json`. Labels are the exception and are
 * returned corrected, because they are positioned rather than drawn as paths
 * and would otherwise need the caller to know which of the two spaces each
 * field is in.
 */
export function basemapFor(frame: Frame): Basemap | null {
  const data = bundle();
  if (!data) return null;

  const ways = kmForUnits(frame.w) < WAYS_BELOW_KM;

  // The frame is in corrected space; the bundle is not. Undo the correction to
  // get the box to test against, and pad it by half a frame so that panning a
  // little does not run off the edge of what was clipped.
  const pad = frame.w * 0.5;
  const x0 = (frame.x - pad) / frame.lngScale;
  const x1 = (frame.x + frame.w + pad) / frame.lngScale;
  const y0 = frame.y - frame.h * 0.5;
  const y1 = frame.y + frame.h * 1.5;

  // **Labels use the frame itself, not the padded box.** Shapes are padded
  // because a coastline half off-screen still has to be drawn to the edge; a
  // name half off-screen is just a name in the wrong place. Clipping labels to
  // what is actually visible is also what stops "the fourteen largest towns
  // near the Alps" from being fourteen cities the reader cannot see.
  //
  // Inset on the right, because a label is drawn to the *right* of its dot: a
  // town found in the last tenth of the frame has its name run off the edge and
  // arrives as "Mor…". Better not to name it than to name it half.
  const lx0 = frame.x / frame.lngScale;
  const lx1 = (frame.x + frame.w * 0.88) / frame.lngScale;
  const ly0 = frame.y;
  const ly1 = frame.y + frame.h;

  // Back to degrees for the place index, which is stored in lat/lng.
  const west = lx0 * DEG_PER_UNIT - 180;
  const east = lx1 * DEG_PER_UNIT - 180;
  const north = 90 - ly0 * DEG_PER_UNIT;
  const south = 90 - ly1 * DEG_PER_UNIT;

  const peakCandidates: BasemapLabel[] = [];
  for (const [x, y, metres, name] of data.peaks) {
    if (x < lx0 || x > lx1 || y < ly0 || y > ly1) continue;
    peakCandidates.push({ x: x * frame.lngScale, y, name, metres });
  }
  // Tallest first, so a crowded range keeps the ones worth naming.
  peakCandidates.sort((a, b) => (b.metres ?? 0) - (a.metres ?? 0));

  const townCandidates: BasemapLabel[] = placesInBox(south, west, north, east, MAX_TOWNS * 3).map(
    (p) => ({
      x: ((p.lng + 180) / 360) * MAP_VIEWBOX.width * frame.lngScale,
      y: ((90 - p.lat) / 180) * MAP_VIEWBOX.height,
      name: p.name,
    }),
  );

  return {
    borders: clip(data.borders, x0, y0, x1, y1),
    admin1: clip(data.admin1 ?? [], x0, y0, x1, y1),
    relief: clip(data.relief ?? [], x0, y0, x1, y1),
    glaciers: clip(data.glaciers ?? [], x0, y0, x1, y1),
    parks: clip(data.parks ?? [], x0, y0, x1, y1),
    // Roads and railways only once the frame is small enough for them to mean
    // something. On a map of Asia every motorway in China is a grey haze over
    // the route the trip actually took; on a map of one valley the road *is*
    // the trip. The threshold is the same one `isCloseRange` names.
    railroads: ways ? clip(data.railroads ?? [], x0, y0, x1, y1) : [],
    roads: ways ? clip(data.roads ?? [], x0, y0, x1, y1) : [],
    lakes: clip(data.lakes, x0, y0, x1, y1),
    rivers: clip(data.rivers, x0, y0, x1, y1),
    peaks: spread(peakCandidates, frame, MAX_PEAKS),
    towns: spread(townCandidates, frame, MAX_TOWNS),
    attribution: data.attribution,
  };
}

/**
 * As many labels as will fit without landing on top of each other.
 *
 * Candidates arrive in priority order — tallest peak, largest town — and each
 * is kept only if nothing already kept is within a minimum separation. Without
 * this the Alps drew "Matterhorn", "Mont Blanc" and "Monte Rosa" across each
 * other in one illegible line, which is worse than naming one of them.
 *
 * The separation is a fraction of the frame rather than a distance, because
 * what must not overlap is the drawn text, and that keeps its size on screen
 * however far the map is zoomed.
 */
function spread(candidates: BasemapLabel[], frame: Frame, limit: number): BasemapLabel[] {
  const apartX = frame.w * 0.22;
  const apartY = frame.h * 0.07;
  const kept: BasemapLabel[] = [];
  for (const candidate of candidates) {
    if (kept.length >= limit) break;
    const collides = kept.some(
      (k) => Math.abs(k.x - candidate.x) < apartX && Math.abs(k.y - candidate.y) < apartY,
    );
    if (!collides) kept.push(candidate);
  }
  return kept;
}

/**
 * Whether a frame is close enough in that labelling every town would crowd it.
 *
 * Not a threshold for *whether* to draw a basemap — B46 originally proposed one
 * at 30 km, and it turned out not to be needed. Nothing has to decide in
 * advance whether Natural Earth has anything to say about a place: the clip
 * either returns shapes or it does not, and an empty clip draws the clean
 * background all by itself. This only decides how much labelling is decent.
 */
export function isCloseRange(frame: Frame): boolean {
  return kmForUnits(frame.w) < 60;
}

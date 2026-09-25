import "server-only";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { paddedFrameBox, placesInBox } from "./ingest/geo";
import { peaksInBox } from "./ingest/peaks";
import { clipPath, type ClipBox } from "./mapClip";
import { DEG_PER_UNIT, frameRoute, isPlottable, kmForUnits, type Frame, type Point } from "./mapFrame";
import { areaKey } from "./tripMap";
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
 * 6.7 MB gzipped and 25 MB parsed; a reader gets the few dozen kilobytes their
 * trip actually covers, and there is no generated artefact anywhere to go
 * stale when a trip grows a stop — the answer is derived per request from
 * files on disk, exactly as `getPlaces` is.
 *
 * "The few dozen kilobytes" was a claim about *shape selection* and it was not
 * true: a shape whose bounding box grazed the frame travelled whole, so
 * `alps-2024` — four stops inside 68 km — came to 518,867 bytes, and the trip
 * page to 1,092,881. B177 made the sentence true by cutting the geometry as
 * well as choosing the shapes (`lib/mapClip.ts`): 64,616 and 192,102.
 */

/** One shape: its bounding box in projected units, then its SVG path. */
type Shape = [number, number, number, number, string];

type Bundle = {
  version: number;
  attribution: string;
  borders: Shape[];
  bordersMid: Shape[];
  bordersCoarse: Shape[];
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

type BasemapLabel = {
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

/**
 * How wide a frame may be before it drops to the coarse basemap.
 *
 * Resolution has to match scale, or a page pays for detail nobody can see. The
 * clip had no ceiling: `asia-2023` was shipping 754 KB gzipped, and a route
 * from Zurich to Vietnam — measured, not guessed — came to 7,448 shapes and
 * thirteen megabytes of path text, because 10m coastline was being clipped to
 * a frame sixteen thousand kilometres across where a whole island is one pixel.
 *
 * Above this, the map draws 1:110m country outlines and nothing else: no
 * lakes, no rivers, no ice, no relief. All of those are invisible at that
 * width and all of them are most of the weight. Two and a half thousand
 * kilometres is about the width of a continent, which is the scale at which
 * 10m stops being legible and starts being ballast.
 */
const DETAIL_BELOW_KM = 900;

/**
 * And where the middle level gives way to the coarsest.
 *
 * Three bands, not two, because two were not enough: `asia-2023` frames at
 * 2,400 km, where 1:110m is visibly blocky along the Vietnamese coast but 1:10m
 * was still 1.2 MB of path text — at that resolution one country polygon,
 * Indonesia or China, is tens of kilobytes by itself. 1:50m is the level that
 * looks right in between and weighs a tenth.
 */
const MID_BELOW_KM = 6000;

/**
 * How far past the frame the clip reaches, as a fraction of the frame.
 *
 * Two jobs, and it had only the first before B177. **Panning**: the map drags,
 * so a reader who pulls the Alps a little to the left must not pull them off
 * the edge of what the server sent. **And now the cut edge**: a clipped
 * country is stroked along the box as though a border ran there
 * (`lib/mapClip.ts`), and half a frame is how far away those edges stay.
 *
 * B177 asked whether it earns its keep, on the premise that the map does not
 * pan. It does — `WorldMap` has drag handlers and the map page is where a
 * reader looks at a route properly — so the question is what the room costs
 * now that it is bought by area rather than by whole countries. Measured, at
 * 0.25 instead of 0.5: `alps-2024` 41,439 bytes rather than 64,616, and
 * `usa-2026` 40,278 rather than 85,436. Real, and still small beside the
 * 454,251 bytes clipping took off `alps-2024` on its own — so the drag stays
 * a half frame, and this is the number to revisit first if it ever has to give.
 */
const PAD_FRACTION = 0.5;

function bundleFile(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "mapdata", "basemap.json.gz");
}

/**
 * The parsed bundle once it is in hand.
 *
 * `undefined` is "not read yet", `null` is **never built** — the one absent
 * state that is supported and permanent. A failed read is *not* recorded here;
 * see `readProblem`.
 */
let cached: Bundle | null | undefined;

/**
 * A read that failed for a reason other than the file not being there.
 *
 * **Why this is not just `cached = null`.** It was, and B179 is what that
 * cost: one `ENOMEM`, one interrupted read, one `RangeError` on a 25 MB parse,
 * and every map on the instance drew with no borders, no water and no labels
 * until somebody restarted the process — silently, because "never built" and
 * "could not be read" were the same branch. The file is 6.7 MB gzipped and
 * 25 MB parsed, the largest single allocation this server makes, so a
 * transient failure under memory pressure is not hypothetical.
 *
 * Kept separately from `cached` so that a fault is *retried* and *sayable*
 * where absence is neither, and following `rootProblem` in lib/users.ts
 * (B197): recorded rather than thrown, because the person who needs it is not
 * in the request — they are looking at a monitor asking why every map went
 * blank.
 */
let readProblem: { message: string; at: number; attempts: number } | null = null;

/**
 * How many failures in a row are retried at once, before backing off.
 *
 * A transient fault deserves the next request; a corrupt file does not deserve
 * a 6.7 MB read and a 25 MB parse on every page render for the rest of the
 * process's life. Three is enough to ride out a moment of memory pressure, and
 * few enough that a genuinely broken file costs three attempts rather than
 * thousands.
 */
const EAGER_RETRIES = 3;

/** And how long the backoff is, once the eager retries are spent. */
const RETRY_AFTER_MS = 30_000;

/**
 * Why the bundle could not be read, if the last attempt failed.
 *
 * Null both when the bundle loaded and when it was never built — absence is
 * not a fault. `/api/health` reports it; nothing else should branch on it,
 * because the answer to "no basemap" is the same either way: draw the clean
 * background.
 */
export function basemapProblem(): string | null {
  return readProblem?.message ?? null;
}

/**
 * The baked bundle, or null if it was never built — or cannot be read.
 *
 * Absent is a supported state, not an error: a checkout that has not run
 * `npm run build:mapdata` still serves maps, just without a basemap under
 * them. That is the same fallback a frame too close in for Natural Earth to
 * say anything about already gets, so there is a correct thing to draw.
 *
 * A *failed* read is a different thing wearing the same face. It returns the
 * same null — a map with no borders beats a page that will not render — but it
 * is remembered as a fault rather than as an answer, warned about once, and
 * tried again.
 */
function bundle(): Bundle | null {
  if (cached !== undefined) return cached;
  if (
    readProblem &&
    readProblem.attempts >= EAGER_RETRIES &&
    Date.now() - readProblem.at < RETRY_AFTER_MS
  ) {
    return null;
  }

  const file = bundleFile();
  try {
    const data = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString("utf8")) as Bundle;
    cached = data;
    readProblem = null;
    return data;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      // Never built. Permanent, silent, and correct: this is the state a
      // checkout that skipped `npm run build:mapdata` is meant to be in.
      cached = null;
      readProblem = null;
      return null;
    }
    const message = `${file} could not be read: ${(error as Error).message}`;
    // Once per distinct fault, not once per map: a trip page builds two of
    // these, and a line repeated on every render is how the warnings that
    // matter stop being read. Repeated when the message changes, because a
    // fault that turned from EACCES into a parse error is news.
    if (readProblem?.message !== message) {
      console.warn(
        `[basemap] ${message} — every map on this instance draws without ` +
          `borders, water or labels until it reads again. /api/health says so.`,
      );
    }
    readProblem = { message, at: Date.now(), attempts: (readProblem?.attempts ?? 0) + 1 };
    return null;
  }
}

/**
 * Test seam — drops the parsed bundle and any recorded read failure with it.
 *
 * Both, for the reason `clearUserCache()` gives: a test that mocked
 * `readFileSync` into throwing must not leave the next one reporting an
 * instance whose maps are broken.
 */
export function clearBasemapCache(): void {
  cached = undefined;
  readProblem = null;
  worldParksCached = undefined;
  worldHydroCached = undefined;
}

/**
 * The worldwide parks layer — B2212's `scripts/build-parks.ts`, baked
 * separately from `mapdata/basemap.json.gz` rather than merged into it: it
 * comes from a different source (OpenStreetMap, ODbL) under a different
 * licence than every Natural Earth layer the main bundle carries, it is
 * rebuilt by a different, much slower script (Overpass, not a static file),
 * and today it covers only Europe and Asia rather than the whole world —
 * keeping it separate means a partial or failed rebuild of this file cannot
 * touch borders, water or the rest of the basemap. Absent, not broken, the
 * same as the main bundle: a checkout that has not baked it draws only
 * `data.parks` (Natural Earth's US-only extract), exactly as before B2212.
 */
type ParksBundle = { version: number; attribution: string; parks: Shape[] };
let worldParksCached: ParksBundle | null | undefined;

function worldParksFile(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "mapdata", "parks-world.json.gz");
}

function worldParksBundle(): ParksBundle | null {
  if (worldParksCached !== undefined) return worldParksCached;
  try {
    const data = JSON.parse(
      zlib.gunzipSync(fs.readFileSync(worldParksFile())).toString("utf8"),
    ) as ParksBundle;
    worldParksCached = data;
  } catch {
    // Never built, or unreadable — either way, draw without it. Not worth
    // the main bundle's elaborate retry/backoff bookkeeping: this layer is
    // one fill colour, not borders and water for every map on the instance.
    worldParksCached = null;
  }
  return worldParksCached;
}

/**
 * The worldwide rivers/lakes layer — B2222's `scripts/build-hydro.ts`, baked
 * separately for the same reasons `worldParksBundle` is: a different source
 * (HydroSHEDS' HydroRIVERS/HydroLAKES, CC BY 4.0) under a different licence
 * than the Natural Earth layers in the main bundle, rebuilt by a different,
 * much slower script (two very large one-time downloads, not a static
 * mirror), so a partial or failed rebuild of this file cannot touch borders
 * or the rest of the basemap. Absent, not broken: a checkout that has not
 * baked it draws only `data.rivers`/`data.lakes` (Natural Earth's own,
 * coarser layers), exactly as before B2222.
 */
type HydroBundle = { version: number; attribution: string; rivers: Shape[]; lakes: Shape[] };
let worldHydroCached: HydroBundle | null | undefined;

function worldHydroFile(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "mapdata", "hydro-world.json.gz");
}

function worldHydroBundle(): HydroBundle | null {
  if (worldHydroCached !== undefined) return worldHydroCached;
  try {
    const data = JSON.parse(
      zlib.gunzipSync(fs.readFileSync(worldHydroFile())).toString("utf8"),
    ) as HydroBundle;
    worldHydroCached = data;
  } catch {
    worldHydroCached = null;
  }
  return worldHydroCached;
}

/** Whether two boxes touch at all. */
function overlaps(shape: Shape, box: ClipBox): boolean {
  return shape[0] <= box.x1 && shape[2] >= box.x0 && shape[1] <= box.y1 && shape[3] >= box.y0;
}

/**
 * One layer, cut to the box.
 *
 * Selection is by bounding box, as it always was; what changed with B177 is
 * what a *selected* shape costs. A shape used to travel whole, so `alps-2024`
 * — four stops inside 68 km — was handed 518,867 bytes of basemap, 465,472 of
 * it seven country polygons drawn a thousand kilometres past the edge of a
 * frame 186 km wide. The reader downloaded Sicily to look at the Grimsel.
 * `lib/mapClip.ts` cuts the geometry to the box instead.
 *
 * A shape lying *wholly* inside the box is passed through untouched, which is
 * not only an optimisation: it is what keeps a wide map byte-for-byte what it
 * was. At continental width every shape the clip returns is contained, so
 * nothing is parsed, nothing is re-serialised, and the coarse band pays
 * nothing for a fix aimed at the close one.
 *
 * `close` is the bake's own flag for the layer (`scripts/build-mapdata.mjs`):
 * a filled shape has to come back closed or the fill leaks into the sea, and a
 * stroked line must not be closed or a river joins its own mouth.
 */
function clip(shapes: Shape[], box: ClipBox, close: boolean): string[] {
  const out: string[] = [];
  for (const shape of shapes) {
    if (!overlaps(shape, box)) continue;
    if (shape[0] >= box.x0 && shape[1] >= box.y0 && shape[2] <= box.x1 && shape[3] <= box.y1) {
      out.push(shape[4]);
      continue;
    }
    const cut = clipPath(shape[4], box, close);
    if (cut) out.push(cut);
  }
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
export function basemapFor(
  frame: Frame,
  opts: { worldParks?: boolean; worldRivers?: boolean } = {},
): Basemap | null {
  const data = bundle();
  if (!data) return null;

  const spanKm = kmForUnits(frame.w);
  const ways = spanKm < WAYS_BELOW_KM;
  const detailed = spanKm < DETAIL_BELOW_KM;
  const outlines = detailed
    ? data.borders
    : spanKm < MID_BELOW_KM
      ? (data.bordersMid ?? data.borders)
      : (data.bordersCoarse ?? data.borders);

  // The frame is in corrected space; the bundle is not. Undo the correction to
  // get the box to clip against, and pad it (PAD_FRACTION) so that panning a
  // little does not run off the edge of what was kept.
  const pad = frame.w * PAD_FRACTION;
  const box: ClipBox = {
    x0: (frame.x - pad) / frame.lngScale,
    x1: (frame.x + frame.w + pad) / frame.lngScale,
    y0: frame.y - frame.h * PAD_FRACTION,
    y1: frame.y + frame.h * (1 + PAD_FRACTION),
  };

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
    borders: clip(outlines, box, true),
    // Everything below is detail that a continental frame cannot show and
    // should not carry. See DETAIL_BELOW_KM.
    admin1: detailed ? clip(data.admin1 ?? [], box, false) : [],
    relief: detailed ? clip(data.relief ?? [], box, true) : [],
    glaciers: detailed ? clip(data.glaciers ?? [], box, true) : [],
    // B2212: Natural Earth's US-only extract, plus the worldwide OSM layer
    // when the caller asked for it (`opts.worldParks`) and it has been baked
    // (`worldParksBundle`) — both clipped and concatenated the same way
    // `outlines` above already merges two resolutions of one layer. Opt-in
    // rather than always-on: the public trip page and the in-app map read
    // this same `Basemap` for every page load on the site, and the worldwide
    // layer alone can be a few hundred KB *of one frame* near a park-dense
    // region — this file's own "weighs kilobytes, not half a megabyte" test
    // is what caught that. The photobook route map is the one caller that
    // opts in (`routeMap.ts`), and only when it is itself off unless
    // `mapPlaces` is on.
    parks: detailed
      ? clip(
          [...(data.parks ?? []), ...(opts.worldParks ? (worldParksBundle()?.parks ?? []) : [])],
          box,
          true,
        )
      : [],
    // Roads and railways only once the frame is small enough for them to mean
    // something. On a map of Asia every motorway in China is a grey haze over
    // the route the trip actually took; on a map of one valley the road *is*
    // the trip. The threshold is the same one `isCloseRange` names.
    railroads: ways ? clip(data.railroads ?? [], box, false) : [],
    roads: ways ? clip(data.roads ?? [], box, false) : [],
    // B2222: HydroSHEDS' worldwide rivers/lakes, added the same opt-in way
    // B2212 added worldwide parks above — a checkout that has not baked
    // `hydro-world.json.gz`, or a caller that did not ask, draws only the
    // Natural Earth layer it always has.
    lakes: detailed
      ? clip([...data.lakes, ...(opts.worldRivers ? (worldHydroBundle()?.lakes ?? []) : [])], box, true)
      : [],
    rivers: detailed
      ? clip([...data.rivers, ...(opts.worldRivers ? (worldHydroBundle()?.rivers ?? []) : [])], box, false)
      : [],
    peaks: spread(peakCandidates, frame, MAX_PEAKS),
    towns: spread(townCandidates, frame, MAX_TOWNS),
    attribution: data.attribution,
  };
}

/**
 * The basemap for a route, or null when there is no route to draw one under.
 *
 * `frameRoute([])` frames the whole world, deliberately (lib/mapFrame.ts), and
 * clipping the bundle to the whole world clips almost nothing — 160 KB of 1:110m
 * country outlines and thirty labels, serialised into the page. That is the
 * right answer for a map of the world and the wrong one for a page that draws
 * no map at all, which is what an upcoming trip with no `plan.md` is (B85).
 *
 * The bug was the *distance* between two conditions: every component here is
 * already guarded on having something to draw, and every server call site
 * built the basemap before asking. This is the pair, in one place, so the next
 * call site cannot separate them again. `frameRoute` is unchanged — the caller
 * is what must not ask.
 */
export function basemapForRoute(
  points: readonly Point[],
  opts: { worldParks?: boolean; worldRivers?: boolean } = {},
): Basemap | null {
  return points.length > 0 ? basemapFor(frameRoute(points), opts) : null;
}

/**
 * Named peaks near a route's own stops, in plain lat/lng — B2049's
 * `mapTerrain`, for the photobook's own map (`paid/photobook/lib/photobook/routeMap.ts`).
 *
 * Deliberately not `Basemap.peaks`: that list is already laid out for one
 * specific SVG frame — `lib/mapFrame.ts`'s `lngScale` squeeze, then
 * `spread`'s own collision nudging — positions the book's `d3-geo`
 * projection has no business reading back as geography.
 *
 * Reads `lib/ingest/peaks.ts`'s `peaksInBox` — GeoNames `PK` peaks over
 * 300 m, ~47,500 worldwide — rather than `data.peaks`, the world-atlas
 * bundle's Natural Earth "famous peaks" layer (a few hundred named summits
 * total, `WorldMap`'s own `Basemap.peaks` field still reads that one). B2212:
 * outside the handful of ranges Natural Earth happens to have named, that
 * sparse layer had nothing inside any frame at all, however the query box
 * was shaped.
 *
 * Sorted tallest first; the caller places what fits on its own page and lets
 * the rest go. The query box pads the route's own bounding box
 * proportionally to its size (`paddedFrameBox`, B2211) rather than by a
 * fixed number of degrees — a fixed pad found only the tallest peaks in the
 * *region*, which reads as "nearby" only where the regional giants happen to
 * sit on the route (the Alps); elsewhere it returned real mountains from
 * hundreds of kilometres away while the frame's own small, actually-visible
 * peak went unqueried.
 */
/** @public open core: paid/ uses this (tagged by open-core/split). */
export function peaksNear(
  points: readonly Point[],
  limit: number,
): { name: string; lat: number; lng: number; metres: number }[] {
  if (points.length === 0) return [];
  const { south, west, north, east } = paddedFrameBox(points);
  return peaksInBox(south, west, north, east, limit);
}

/**
 * How many town-scale basemaps one trip may carry, beside its overview.
 *
 * The trip map's "surroundings" view frames one stop at town scale, and the
 * overview's clip cannot answer that for a long trip: a frame across Asia is
 * served coarse outlines with no lakes, rivers or relief at all
 * (DETAIL_BELOW_KM), so magnifying it shows a bigger version of nothing. One
 * clip per area answers it from the same bundle at the right resolution.
 *
 * Measured rather than guessed: an 8 km frame clips to 0.4-2.5 KB of JSON —
 * Zurich 2,427 bytes, Chiang Mai 1,723, Phuket 363 — so twenty-four of them
 * is tens of kilobytes beside a trip page that already carries an overview of
 * 24 KB (alps-2024) to 150 KB (asia-2023). Past the cap the overview's own
 * basemap stands in, which is what the small trips use anyway.
 */
const MAX_LOCAL_AREAS = 24;

/**
 * A town-scale basemap for each area a trip stopped in, keyed by `areaKey`.
 *
 * Keyed by area rather than by day so that six days written in one town cost
 * one clip, and so that the client can look one up from a stop's coordinates
 * without either side sharing a notion of which days group together — see
 * lib/tripMap.ts, which owns that key and is shared by both.
 */
export function localBasemaps(points: readonly Point[]): Record<string, Basemap> {
  const out: Record<string, Basemap> = {};
  for (const point of points) {
    if (!isPlottable(point)) continue;
    const key = areaKey(point);
    if (key in out) continue;
    if (Object.keys(out).length >= MAX_LOCAL_AREAS) break;
    const map = basemapFor(frameRoute([point]));
    if (map) out[key] = map;
  }
  return out;
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
function spread<T extends { x: number; y: number }>(
  candidates: T[],
  frame: Frame,
  limit: number,
): T[] {
  const apartX = frame.w * 0.22;
  const apartY = frame.h * 0.07;
  const kept: T[] = [];
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
 * B46 proposed a "too close in to draw a basemap" threshold at about 30 km, and
 * an `isCloseRange` helper stood here to answer it. Neither is needed, and the
 * reason is worth keeping: nothing has to decide in advance whether Natural
 * Earth has anything to say about a place. The clip either returns shapes or it
 * does not, and an empty clip draws the clean background by itself — correct at
 * every scale rather than at the one scale somebody guessed.
 *
 * The one range question that *is* asked is `WAYS_BELOW_KM` above, and it is
 * about roads and railways being noise on a continental map, not about whether
 * a basemap exists.
 */

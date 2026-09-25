/**
 * Builds the worldwide rivers/lakes layer the photobook route map paints —
 * B2222. B2212 shipped worldwide parks and peaks and named this file, a
 * HydroSHEDS supplement, as the item cut for time; the owner then chose
 * HydroRIVERS/HydroLAKES over a Natural Earth regional supplement after
 * seeing both rendered (docs/tasks — B2222).
 *
 *   npm run build:hydro
 *
 * The output — lib/mapdata/hydro-world.json.gz — is committed for the same
 * reason `parks-world.json.gz` is: a page render must not depend on a live
 * query or a multi-hundred-megabyte download at request time.
 *
 * HydroRIVERS_v10 and HydroLAKES_v10 (hydrosheds.org, verified 2026-09-24)
 * ship only as full-resolution ESRI shapefiles — 544 MB and 820 MB zipped,
 * ~8.5 million river reaches and ~1.4 million lakes worldwide — with no
 * generalised or GeoJSON mirror the way Natural Earth publishes one. No
 * shapefile-reading package is a dependency here (`AGENTS.md`: no new
 * dependency for what a few hundred lines can do), so `shapefile-reader.ts`
 * is a small from-scratch `.shp`/`.dbf` reader, restricted to exactly the
 * two shape types these two files use.
 *
 * **Filtered hard**, per the ticket's budget (3 MB gzipped): rivers by
 * `ORD_STRA`, the Strahler stream order HydroRIVERS carries per reach — the
 * standard measure of "how major is this watercourse", not a length or
 * discharge threshold that would keep a short, wide river and drop a long,
 * modest one; lakes by `Lake_area` (km²). Then simplified (RDP, in the same
 * projected space and to the same tolerance style as `build-parks.ts`) and
 * quantised to `build-mapdata.mjs`'s own two-decimal (400 m) grid, so this
 * layer costs no more per point than the Natural Earth ones it draws beside.
 *
 * Not run automatically, not part of `npm run verify` — a one-time bake
 * against a licensed third-party download, the same footing `build:parks`
 * and `build:mapdata` already stand on.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import { project } from "../lib/mapProjection.mjs";
import { readShp, readDbf } from "./shapefile-reader.ts";

const OUT_FILE = path.join(import.meta.dirname, "..", "lib", "mapdata", "hydro-world.json.gz");
// Under /tmp, never the repo: these are two very large third-party
// downloads (544 MB + 820 MB zipped), and nothing here needs them to
// survive past the bake — same rule the build brief states for evidence.
const CACHE_DIR = path.join("/tmp", "fernscout-hydro-cache");

const RIVERS_URL = "https://data.hydrosheds.org/file/HydroRIVERS/HydroRIVERS_v10_shp.zip";
const LAKES_URL = "https://data.hydrosheds.org/file/hydrolakes/HydroLAKES_polys_v10_shp.zip";

const ATTRIBUTION =
  "Rivers and lakes from HydroSHEDS (Lehner & Grill 2013; Messager et al. 2016), " +
  "hydrosheds.org, under the Creative Commons Attribution 4.0 licence.";

/**
 * Strahler stream order floor — a river reach below this is dropped
 * entirely. HydroRIVERS ranks every reach 1 (a headwater) to the low
 * teens (the Amazon); a close route-map frame (100-300 km, the ticket's own
 * range) wants the Danube's named tributaries and the Rhine's Neckar/Main,
 * not the stream behind a stop's hotel. Chosen empirically against the
 * renders this ticket asks for — see docs/tasks evidence.
 */
const RIVER_ORDER_MIN = arg("river-order") ? Number(arg("river-order")) : 5;

/** Lakes smaller than this, in km², are dropped — the same idea as
 * `build-mapdata.mjs`'s `MIN_LAKE_KM`, applied to HydroLAKES' own area field
 * rather than a bounding diameter. */
const LAKE_AREA_MIN_SKM = arg("lake-area") ? Number(arg("lake-area")) : 3;

/** Two decimals — the same 400 m grid `build-mapdata.mjs` and
 * `build-parks.ts` both quantise to, so this layer costs the same per point
 * as the ones it draws beside. */
const DECIMALS = 2;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function unitsForKm(km: number): number {
  return km / ((360 / 1000) * 111.32);
}

/** A ground distance as degrees of latitude/longitude — for the raw-
 * coordinate pre-filter in `partToShape`, which runs before projection. */
function degreesForKm(km: number): number {
  return km / 111.32;
}

/** Rivers read at a finer tolerance than lakes — a river is a thin line
 * whose whole point is its wiggle, a lake a filled area whose edge can give
 * up more of it. */
const RIVER_EPSILON = unitsForKm(arg("river-epsilon") ? Number(arg("river-epsilon")) : 1.2);
const LAKE_EPSILON = unitsForKm(1.5);

/** A lake ring — outer shoreline or island — narrower than this on its own
 * longest side is dropped whole rather than simplified. HydroLAKES' own
 * shoreline detail is finer than a route map's own scale can show, and a
 * handful of the largest lakes each carry hundreds of tiny island rings
 * (the Caspian Sea alone over a thousand) that RDP alone barely shrinks —
 * they are individually small, not individually straight. */
const LAKE_ISLAND_MIN_SPAN_DEG = degreesForKm(2);

type Pt = [number, number];

function perpDistance(p: Pt, a: Pt, b: Pt): number {
  const [ax, ay] = a;
  const [bx, by] = b;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p[0] - ax, p[1] - ay);
  const t = ((p[0] - ax) * dx + (p[1] - ay) * dy) / len2;
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(p[0] - cx, p[1] - cy);
}

/** Ramer-Douglas-Peucker — the same algorithm `build-parks.ts` uses, copied
 * rather than imported for the reason its own comment gives: this runs as
 * plain ESM outside the app, and duplicating forty lines costs less than a
 * shared module that has to work both inside and outside it. */
function simplify(points: Pt[], epsilon: number): Pt[] {
  if (points.length < 3) return points;
  let maxDist = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpDistance(points[i], points[0], points[points.length - 1]);
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }
  if (maxDist > epsilon) {
    const left = simplify(points.slice(0, index + 1), epsilon);
    const right = simplify(points.slice(index), epsilon);
    return [...left.slice(0, -1), ...right];
  }
  return [points[0], points[points.length - 1]];
}

/** One part (ring or line), projected, simplified and turned into an SVG
 * path plus its bounding box — the same `[minX, minY, maxX, maxY, d]` shape
 * every other baked layer here uses. Splits at the antimeridian the same
 * way `build-mapdata.mjs`'s `ringToShape` does: a shapefile point is
 * `[lng, lat]` same as GeoJSON, so a reach or shoreline that crosses ±180°
 * would otherwise draw one straight line across the whole map. */
function partToShape(
  part: Pt[],
  epsilon: number,
  close: boolean,
  minSpanDeg = 0,
): [number, number, number, number, string] | null {
  // A raw-coordinate pre-filter, before the cost of simplifying: a lake's
  // shoreline ring can carry a thousand-plus tiny island rings (the Caspian
  // Sea alone has over a thousand), each a handful of points that simplify
  // barely shrinks and a route map's own scale cannot show. Dropped by span
  // rather than point count, the same idea `build-mapdata.mjs`'s own
  // `minSpanUnits` filter uses for Natural Earth's layers.
  if (minSpanDeg > 0) {
    let rawMinLng = Infinity;
    let rawMinLat = Infinity;
    let rawMaxLng = -Infinity;
    let rawMaxLat = -Infinity;
    for (const [lng, lat] of part) {
      if (lng < rawMinLng) rawMinLng = lng;
      if (lng > rawMaxLng) rawMaxLng = lng;
      if (lat < rawMinLat) rawMinLat = lat;
      if (lat > rawMaxLat) rawMaxLat = lat;
    }
    if (Math.max(rawMaxLng - rawMinLng, rawMaxLat - rawMinLat) < minSpanDeg) return null;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const runs: string[][] = [];
  let run: string[] = [];
  let prevLng: number | null = null;
  const simplified = simplify(part, epsilon);
  for (const [lng, lat] of simplified) {
    if (prevLng !== null && Math.abs(lng - prevLng) > 180) {
      if (run.length > 1) runs.push(run);
      run = [];
    }
    prevLng = lng;
    const [x, y] = project(lat, lng);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    run.push(`${x.toFixed(DECIMALS)},${y.toFixed(DECIMALS)}`);
  }
  if (run.length > 1) runs.push(run);
  if (runs.length === 0) return null;
  const d = runs.map((r) => `M${r.join(" L")}${close ? " Z" : ""}`).join(" ");
  return [
    Number(minX.toFixed(DECIMALS)),
    Number(minY.toFixed(DECIMALS)),
    Number(maxX.toFixed(DECIMALS)),
    Number(maxY.toFixed(DECIMALS)),
    d,
  ];
}

async function download(url: string, dest: string) {
  if (fs.existsSync(dest) && !process.argv.includes("--no-cache")) {
    process.stdout.write(`  ${path.basename(dest)} … cached\n`);
    return;
  }
  process.stdout.write(`  ${path.basename(dest)} … downloading\n`);
  const res = await fetch(url, {
    headers: { "user-agent": "fernscout-mapdata-bake/1.0 (+https://fernscout.ch; one-off build script)" },
  });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  await fs.promises.writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

function unzip(zipFile: string, intoDir: string) {
  fs.mkdirSync(intoDir, { recursive: true });
  execFileSync("unzip", ["-o", "-q", zipFile, "-d", intoDir]);
}

function findFile(dir: string, suffix: string): string {
  const found = fs
    .readdirSync(dir, { recursive: true, encoding: "utf8" })
    .find((f) => f.endsWith(suffix));
  if (!found) throw new Error(`no ${suffix} under ${dir}`);
  return path.join(dir, found);
}

async function main() {
  console.log(`Rivers: ORD_STRA >= ${RIVER_ORDER_MIN}. Lakes: Lake_area >= ${LAKE_AREA_MIN_SKM} km².`);

  const riversZip = path.join(CACHE_DIR, "HydroRIVERS_v10_shp.zip");
  const lakesZip = path.join(CACHE_DIR, "HydroLAKES_polys_v10_shp.zip");
  await download(RIVERS_URL, riversZip);
  await download(LAKES_URL, lakesZip);

  const riversDir = path.join(CACHE_DIR, "rivers");
  const lakesDir = path.join(CACHE_DIR, "lakes");
  if (!fs.existsSync(riversDir)) unzip(riversZip, riversDir);
  if (!fs.existsSync(lakesDir)) unzip(lakesZip, lakesDir);

  console.log("Reading HydroRIVERS (streamed, row by row)…");
  const riverShp = findFile(riversDir, ".shp");
  const riverDbf = findFile(riversDir, ".dbf");
  const riverShapes: [number, number, number, number, string][] = [];
  {
    // HydroRIVERS digitises the world as 8.5 million short reaches — a Rhine
    // spanning several hundred kilometres is thousands of two-to-twenty-
    // point records, each carrying its own bounding box. A per-reach filter
    // alone (kept them all, drew them all) cost the same per point whether
    // that point belonged to a long river or a short one, so the size was
    // dominated by *record count*, not by geometry. Strahler order only ever
    // rises going downstream, so once a reach clears `RIVER_ORDER_MIN`
    // every reach downstream of it to the sea does too — which means the
    // *qualifying* reaches already form one long unbroken run each,
    // identifiable by `NEXT_DOWN`. Stitching them into one polyline per run
    // before `partToShape` turns "thousands of small paths" into "one path
    // per named river", at the same detail, for a fraction of the bytes.
    console.log("  pass 1/3: which reaches qualify…");
    const qualifying = new Map<number, number>(); // HYRIV_ID -> NEXT_DOWN
    for (const row of readDbf(riverDbf)) {
      const order = Number(row.ORD_STRA ?? 0);
      if (order >= RIVER_ORDER_MIN) qualifying.set(Number(row.HYRIV_ID), Number(row.NEXT_DOWN));
    }
    console.log(`    ${qualifying.size} reaches qualify`);

    // A reach with another qualifying reach's NEXT_DOWN pointing at it is
    // mid-run, not a source — only a run's own upstream end starts a walk.
    const hasIncoming = new Set<number>();
    for (const nextDown of qualifying.values()) {
      if (qualifying.has(nextDown)) hasIncoming.add(nextDown);
    }

    console.log("  pass 2/3: reading geometry for qualifying reaches…");
    const geomById = new Map<number, [number, number][]>();
    {
      const geomIter = readShp(riverShp);
      const attrIter = readDbf(riverDbf);
      let g = geomIter.next();
      let a = attrIter.next();
      let total = 0;
      while (!g.done && !a.done) {
        total++;
        const id = Number(a.value.HYRIV_ID);
        if (qualifying.has(id)) {
          const points: [number, number][] = [];
          for (const part of g.value.parts) points.push(...part);
          geomById.set(id, points);
        }
        if (total % 2_000_000 === 0) process.stdout.write(`    … ${total} reaches scanned\n`);
        g = geomIter.next();
        a = attrIter.next();
      }
    }

    console.log("  pass 3/3: stitching runs and simplifying…");
    for (const id of qualifying.keys()) {
      if (hasIncoming.has(id)) continue; // mid-run, reached from its own upstream start
      const chain: [number, number][] = [];
      let cur: number | undefined = id;
      const visited = new Set<number>(); // defensive — HydroRIVERS should have no cycles
      while (cur !== undefined && qualifying.has(cur) && !visited.has(cur)) {
        visited.add(cur);
        const pts = geomById.get(cur);
        if (pts) chain.push(...pts);
        cur = qualifying.get(cur);
      }
      const shape = partToShape(chain, RIVER_EPSILON, false);
      if (shape) riverShapes.push(shape);
    }
    console.log(`  ${qualifying.size} qualifying reaches → ${riverShapes.length} stitched rivers`);
  }

  console.log("Reading HydroLAKES (streamed, row by row)…");
  const lakeShp = findFile(lakesDir, ".shp");
  const lakeDbf = findFile(lakesDir, ".dbf");
  const lakeShapes: [number, number, number, number, string][] = [];
  {
    const geomIter = readShp(lakeShp);
    const attrIter = readDbf(lakeDbf);
    let total = 0;
    let g = geomIter.next();
    let a = attrIter.next();
    while (!g.done && !a.done) {
      total++;
      const areaSkm = Number(a.value.Lake_area ?? 0);
      if (areaSkm >= LAKE_AREA_MIN_SKM) {
        for (const part of g.value.parts) {
          const shape = partToShape(part, LAKE_EPSILON, true, LAKE_ISLAND_MIN_SPAN_DEG);
          if (shape) lakeShapes.push(shape);
        }
      }
      g = geomIter.next();
      a = attrIter.next();
    }
    console.log(`  ${total} lakes read → ${lakeShapes.length} kept`);
  }

  const out = { version: 1, attribution: ATTRIBUTION, rivers: riverShapes, lakes: lakeShapes };
  const json = JSON.stringify(out);
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, zlib.gzipSync(json, { level: 9 }));

  const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;
  const gzSize = fs.statSync(OUT_FILE).size;
  console.log(
    `\n${riverShapes.length} river + ${lakeShapes.length} lake shapes → ` +
      `${path.relative(process.cwd(), OUT_FILE)} (${kb(json.length)} raw → ${kb(gzSize)} gzipped)`,
  );
  if (gzSize > 3 * 1024 * 1024) {
    console.warn(`\n⚠ ${kb(gzSize)} is over the 3 MB budget — raise RIVER_ORDER_MIN or LAKE_AREA_MIN_SKM.`);
  }
}

await main();

/**
 * Builds the worldwide national-park layer `mapPlaces` paints — B2212.
 *
 *   npm run build:parks
 *   npm run build:parks -- --continents europe,asia-west,asia-east
 *
 * The output — lib/mapdata/parks-world.json.gz — is committed for the same
 * reason every other baked layer here is: a page render must not depend on a
 * live query, and this script exists to refresh the file, not to run at
 * request time.
 *
 * `lib/mapdata/basemap.json.gz`'s own `parks` layer is Natural Earth's US
 * National Park Service extract — real, but only the US. This bakes the
 * worldwide equivalent from OpenStreetMap via the Overpass API:
 * `boundary=national_park`, `boundary=protected_area` with `protect_class=2`
 * (IUCN category II, the "national park" class of protected area), and —
 * `NATIONAL_PARK_NAME` below — `boundary=protected_area` whose own `name`
 * says "national park" in one of several languages, because not every real
 * national park's OSM relation carries `protect_class` at all (found by a
 * real miss: Balaton-felvidéki Nemzeti Park). One continent's bounding box
 * per request. ODbL, so commercial print use is fine with attribution — the
 * string this script writes into the output is the one the print colophon
 * shows (`paid/photobook/lib/photobook/plan.ts`'s colophon lines).
 *
 * **Simplified hard, on purpose, in one specific way**: `stitchRings` below
 * joins a relation's `outer` ways into closed rings by their shared
 * endpoints — the greedy assembly a park's boundary actually needs, since a
 * large park is rarely one way — but every `inner` (hole) member is ignored.
 * A park with a lake, an enclave or a road corridor cut out of it paints as
 * one solid fill instead of a shape with a hole in it.
 * ponytail: no inner rings. Revisit with even-odd fill or a proper
 * polygon-with-holes path if a park's cut-out is ever reported as wrong.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { project } from "../lib/mapProjection.mjs";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const OUT_FILE = path.join(import.meta.dirname, "..", "lib", "mapdata", "parks-world.json.gz");

/** Overpass wants a client that identifies itself — an anonymous `curl`
 * User-Agent answers 406 with no other explanation. */
const USER_AGENT = "fernscout-mapdata-bake/1.0 (+https://fernscout.ch; one-off build script)";

const ATTRIBUTION =
  "Contains information from OpenStreetMap, which is made available at " +
  "openstreetmap.org under the Open Database License (ODbL).";

/** south, west, north, east. Asia is split in two — a single Overpass
 * request across the whole continent timed out in testing. */
const CONTINENTS: Record<string, [number, number, number, number]> = {
  europe: [34, -25, 72, 45],
  "asia-west": [0, 25, 55, 100],
  "asia-east": [-10, 95, 55, 180],
  africa: [-35, -20, 38, 52],
  "north-america": [5, -170, 72, -50],
  "south-america": [-56, -82, 13, -33],
  oceania: [-50, 110, -5, 180],
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

type OverpassGeom = { lat: number; lon: number }[];
type OverpassElement = {
  type: "way" | "relation";
  geometry?: OverpassGeom;
  members?: { type: string; role: string; geometry?: OverpassGeom }[];
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Overpass's public instance is shared and fair-use, not a dedicated
 * endpoint — a run of several continent-sized queries back to back drew a
 * 504 here that a single query never did. Three tries with a growing pause
 * is cheap insurance against that, not a retry-until-it-works loop: a
 * persistent failure still throws, same as before. */
/**
 * Matches a `name` an actual national park carries in the languages this
 * query has been checked against — the supplementary clause below, not the
 * primary one. Found by a real miss: Balaton-felvidéki Nemzeti Park is
 * `boundary=protected_area` with no `protect_class` at all (its strictly-
 * protected core zones carry `protect_class=1` as separate ways, the park's
 * own umbrella relation carries neither tag), so `protect_class=2` alone
 * silently dropped a national park a reader would recognise by name.
 * ponytail: a name regex, not a semantic tag — it will miss a national park
 * named in a language not listed here, and it cannot be told apart from a
 * street or a hotel that happens to share the words. Widen the list (or find
 * a better tag) if another named miss turns up.
 */
const NATIONAL_PARK_NAME =
  "[Nn]ational ?[Pp]ark|[Nn]emzeti [Pp]ark|[Pp]arc [Nn]ational|[Pp]arco [Nn]azionale|" +
  "[Nn]ationalpark|[Pp]arque [Nn]acional|[Nn]árodní park|[Nn]árodný park|[Nn]arodowy [Pp]ark";

async function queryOverpass(box: [number, number, number, number]): Promise<OverpassElement[]> {
  const [s, w, n, e] = box;
  const bbox = `${s},${w},${n},${e}`;
  const query =
    `[out:json][timeout:180];` +
    `(` +
    `way["boundary"="national_park"](${bbox});` +
    `relation["boundary"="national_park"](${bbox});` +
    `way["boundary"="protected_area"]["protect_class"="2"](${bbox});` +
    `relation["boundary"="protected_area"]["protect_class"="2"](${bbox});` +
    `way["boundary"="protected_area"]["name"~"${NATIONAL_PARK_NAME}"](${bbox});` +
    `relation["boundary"="protected_area"]["name"~"${NATIONAL_PARK_NAME}"](${bbox});` +
    `);` +
    `out geom;`;

  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(OVERPASS_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": USER_AGENT },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!res.ok) throw new Error(`Overpass → HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const json = (await res.json()) as { elements?: OverpassElement[] };
      return json.elements ?? [];
    } catch (err) {
      lastError = err as Error;
      if (attempt < 3) await sleep(attempt * 20_000);
    }
  }
  throw lastError;
}

type Pt = [number, number];

/** Perpendicular distance from `p` to the line through `a`–`b`. */
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

/**
 * Ramer–Douglas–Peucker, in the projected space these shapes are already
 * drawn in — B2212's "simplified hard": OSM boundary ways carry every node a
 * surveyor placed, which is far more vertices than a route map's own frame
 * (a few hundred millimetres, printed) can show. `build-mapdata.mjs`'s
 * Natural Earth layers arrive pre-simplified for a print scale; this is that
 * same step, done here, for a source that does not do it for us.
 */
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

/** Coordinate precision — a 400 m grid, the same `build-mapdata.mjs` bakes
 * every other layer to. */
const DECIMALS = 2;

/** How far a vertex may be from the simplified line before it is kept, in
 * projected units. `lib/mapdata/basemap.json.gz`'s finest layer keeps detail
 * down to about 2 km; parks are a coarser fill under everything else on the
 * page, and a national park is typically tens of kilometres across, so 3 km
 * costs the outline nothing a route map's own scale could show. */
const SIMPLIFY_EPSILON = unitsForKm(1);

/** One closed ring's own `[minX, minY, maxX, maxY, d]`, in the equirectangular
 * space `lib/mapProjection.mjs` defines — the same shape `build-mapdata.mjs`
 * writes for every other layer. `null` when the ring is too small to close
 * (fewer than 4 points after simplification) — the same floor `ringToShape`
 * there uses. */
function geomToShape(geom: OverpassGeom): [number, number, number, number, string] | null {
  if (geom.length < 4) return null;
  // `project` is plain JS (`lib/mapProjection.mjs`) and its return type
  // infers as `number[]`, not the two-element tuple it actually always is.
  const projected: Pt[] = geom.map((pt) => project(pt.lat, pt.lon) as Pt);
  const simplified = simplify(projected, SIMPLIFY_EPSILON);
  if (simplified.length < 4) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const parts: string[] = [];
  simplified.forEach(([x, y], i) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    parts.push(`${i === 0 ? "M" : "L"}${x.toFixed(DECIMALS)},${y.toFixed(DECIMALS)}`);
  });
  return [
    Number(minX.toFixed(DECIMALS)),
    Number(minY.toFixed(DECIMALS)),
    Number(maxX.toFixed(DECIMALS)),
    Number(maxY.toFixed(DECIMALS)),
    `${parts.join(" ")} Z`,
  ];
}

/** A ground distance as a length in projected units — mirrors
 * `build-mapdata.mjs`'s own helper, which cannot be imported here for the
 * same reason that file gives: this runs as plain ESM under node. */
function unitsForKm(km: number): number {
  return km / ((360 / 1000) * 111.32);
}

function isClosed(geom: OverpassGeom): boolean {
  if (geom.length < 4) return false;
  const a = geom[0];
  const b = geom[geom.length - 1];
  return Math.abs(a.lat - b.lat) < 1e-7 && Math.abs(a.lon - b.lon) < 1e-7;
}

/** A point, rounded to ~1 cm — fine enough that two ways sharing a real OSM
 * node always key the same, coarse enough that float noise from JSON
 * round-tripping never splits one. */
const endKey = (p: { lat: number; lon: number }) => `${p.lat.toFixed(7)},${p.lon.toFixed(7)}`;

/**
 * Joins a relation's `outer` ways into closed rings by their shared
 * endpoints — a large park's boundary is almost never one way, it is a
 * dozen, each ending where the next begins, and a park a reader has actually
 * heard of (Hohe Tauern, Sagarmatha) is disproportionately the multi-way
 * kind: `isClosed`-only assembly drew every small, single-way protected area
 * and silently skipped every famous one.
 *
 * Greedy, not exhaustive: each unused way starts a chain, and the chain
 * grows from either end for as long as some unused way's endpoint matches.
 * OSM boundary relations do not naturally branch (each node belongs to at
 * most two ways of one outer ring), so greedy joining finds the same rings a
 * fuller algorithm would; the case it cannot fix is missing or malformed
 * source data, which no assembly strategy can.
 */
function stitchRings(ways: OverpassGeom[]): OverpassGeom[] {
  const remaining = ways.filter((w) => w.length >= 2);
  const rings: OverpassGeom[] = [];

  while (remaining.length > 0) {
    let chain = remaining.shift()!;
    if (isClosed(chain)) {
      rings.push(chain);
      continue;
    }
    let grew = true;
    while (!isClosed(chain) && grew) {
      grew = false;
      const chainStart = endKey(chain[0]);
      const chainEnd = endKey(chain[chain.length - 1]);
      for (let i = 0; i < remaining.length; i++) {
        const w = remaining[i];
        const wStart = endKey(w[0]);
        const wEnd = endKey(w[w.length - 1]);
        if (wStart === chainEnd) {
          chain = [...chain, ...w.slice(1)];
        } else if (wEnd === chainEnd) {
          chain = [...chain, ...[...w].reverse().slice(1)];
        } else if (wEnd === chainStart) {
          chain = [...w, ...chain.slice(1)];
        } else if (wStart === chainStart) {
          chain = [...[...w].reverse(), ...chain.slice(1)];
        } else {
          continue;
        }
        remaining.splice(i, 1);
        grew = true;
        break;
      }
    }
    // A chain that never closes is an outline this dump's ways cannot
    // complete (missing a way, or one relation stitched into two rings by a
    // gap) — drawing it unclosed would leak fill across the page, so it is
    // dropped rather than force-closed across whatever the gap actually was.
    if (isClosed(chain)) rings.push(chain);
  }
  return rings;
}

function elementsToShapes(elements: OverpassElement[]): [number, number, number, number, string][] {
  const shapes: [number, number, number, number, string][] = [];
  for (const el of elements) {
    if (el.type === "way" && el.geometry) {
      for (const ring of stitchRings([el.geometry])) {
        const shape = geomToShape(ring);
        if (shape) shapes.push(shape);
      }
      continue;
    }
    if (el.type === "relation" && el.members) {
      const outerWays = el.members
        .filter((m) => m.role === "outer" && m.geometry)
        .map((m) => m.geometry!);
      for (const ring of stitchRings(outerWays)) {
        const shape = geomToShape(ring);
        if (shape) shapes.push(shape);
      }
    }
  }
  return shapes;
}

async function main() {
  const only = arg("continents")?.split(",");
  const names = only ?? Object.keys(CONTINENTS);

  const allShapes: [number, number, number, number, string][] = [];
  for (const name of names) {
    const box = CONTINENTS[name];
    if (!box) throw new Error(`Unknown continent "${name}" — one of ${Object.keys(CONTINENTS).join(", ")}`);
    process.stdout.write(`  ${name} … `);
    const elements = await queryOverpass(box);
    const shapes = elementsToShapes(elements);
    allShapes.push(...shapes);
    console.log(`${elements.length} elements → ${shapes.length} closed rings`);
  }

  const out = { version: 1, attribution: ATTRIBUTION, parks: allShapes };
  const json = JSON.stringify(out);
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, zlib.gzipSync(json, { level: 9 }));

  const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;
  console.log(
    `\n${allShapes.length} park shapes → ${path.relative(process.cwd(), OUT_FILE)} ` +
      `(${kb(json.length)} raw → ${kb(fs.statSync(OUT_FILE).size)} gzipped)`,
  );
}

await main();

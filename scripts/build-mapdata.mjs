/**
 * Builds the basemap the trip maps are drawn on.
 *
 *   npm run build:mapdata
 *
 * The output — lib/mapdata/basemap.json.gz — is committed, for the same reason
 * `lib/ingest/data/places.bin.gz` is (see scripts/build-geodata.ts): a server
 * rendering a page must not depend on somebody else's CDN being up, and a
 * production install has no devDependencies, so `world-atlas` is not there to
 * read from at runtime. This script exists to refresh the file, not to run at
 * install time or on request.
 *
 * ## Why this data and not the old data
 *
 * `lib/worldLand.json` is Natural Earth 1:110m *coastline* — land against sea,
 * and nothing else. Measured for B46: its points are 63 km apart on average, it
 * has no lakes, no borders and no towns, and Switzerland is empty at every
 * resolution because Switzerland has no coast. A trip round the Alps was drawn
 * on a blank green field.
 *
 * At 1:10m the same coastline resolves to 1.6 km, which is roughly the size of
 * a village — and country borders, lakes and named peaks exist as separate
 * layers. Towns are not here at all: they are already on disk in the GeoNames
 * index that ingest reverse-geocodes against, so `lib/basemap.ts` reads them
 * from there rather than shipping a second copy.
 *
 * ## The format
 *
 * Everything is pre-projected into the 1000x500 equirectangular space of
 * `lib/mapProjection.mjs`, so nothing has to be transformed per request, and
 * quantised to three decimals — a 40 m grid, where the old bake used one
 * decimal and threw away everything finer than 4 km.
 *
 * Each shape carries its own bounding box, because the only question ever asked
 * of this file is "what is inside this trip's frame". Arrays rather than
 * objects throughout: the field names would otherwise be most of the bytes.
 *
 *   shape: [minX, minY, maxX, maxY, "M… L… Z"]
 *   peak:  [x, y, metres, "Name"]
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { feature } from "topojson-client";
import { project } from "../lib/mapProjection.mjs";

const ROOT = path.join(import.meta.dirname, "..");
const OUT_FILE = path.join(ROOT, "lib", "mapdata", "basemap.json.gz");

const NE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson";

/**
 * Coordinate precision, in decimals of a viewBox unit.
 *
 * Two decimals is a 400 m grid. That looks coarse next to the three decimals
 * this script was first written with, and it is still four times finer than
 * anything the source can express: 10m Natural Earth resolves to a 1.6 km
 * median between points (measured for B46). Three decimals was storing
 * precision the data does not have, and it cost a third of the file.
 */
const DECIMALS = 2;

/**
 * Rivers thinner than this are dropped.
 *
 * Natural Earth ranks every watercourse from 1 (the Amazon) to 10 (a stream
 * nobody has heard of). Keeping all of them doubles this file to draw hairlines
 * that read as noise at any scale a journal is looked at.
 */
const RIVER_SCALERANK_MAX = 5;

/**
 * Lakes smaller than this across are dropped, in kilometres.
 *
 * At 1.6 km resolution a pond is three points and a wobble. The lakes that
 * matter to a reader — the ones a town sits on — are all far bigger than this.
 */
const MIN_LAKE_KM = 3;

/**
 * How prominent a state or province boundary must be to be kept.
 *
 * Natural Earth tags each with the zoom level at which it starts being worth
 * drawing. The whole layer is 21 MB of source and doubles this file; at 6 it is
 * the subdivisions a reader has heard of — cantons, prefectures, states — and
 * not every district boundary on earth.
 */
const ADMIN1_MIN_ZOOM_MAX = 6;

/** Main railway lines only — the layer is 40 MB and goes down to sidings. */
const RAIL_SCALERANK_MAX = 4;

/**
 * Motorways and trunk roads only.
 *
 * The full roads layer is 50 MB. Drawing all of it would bury the route the
 * trip actually took under a net of lines nobody asked about — the road on
 * this map is context for the drive, not a navigation aid.
 */
const ROAD_SCALERANK_MAX = 3;

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** A ground distance as a length in projected units. Mirrors lib/mapFrame.ts,
 * which cannot be imported here: this script runs as plain ESM under node. */
function unitsForKm(km) {
  return km / ((360 / 1000) * 111.32);
}

/**
 * Where downloads are kept between runs.
 *
 * The source layers are ninety megabytes and this script is mostly re-run to
 * change a *filter*, not to pick up new data from Natural Earth. Re-fetching
 * all of it to answer "is scalerank 5 too many rivers" makes the answer take
 * four minutes instead of ten seconds. Gitignored; delete it to force a
 * genuine refresh, or pass --no-cache.
 */
const CACHE_DIR = path.join(ROOT, ".mapdata-cache");

async function fetchJson(url) {
  const name = url.split("/").pop();
  const cached = path.join(CACHE_DIR, name);
  process.stdout.write(`  ${name} … `);

  if (!process.argv.includes("--no-cache") && fs.existsSync(cached)) {
    process.stdout.write("cached\n");
    return JSON.parse(fs.readFileSync(cached, "utf8"));
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  const text = await res.text();
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(cached, text);
  process.stdout.write("downloaded\n");
  return JSON.parse(text);
}

/**
 * One ring of lng/lat pairs → an SVG path, and the box it occupies.
 *
 * **Split at the antimeridian.** Russia, Fiji and Antarctica have rings whose
 * longitude steps from +179 to -179, which this projection turns into a jump
 * from x=997 to x=3 — a straight line drawn across the entire world. It showed
 * on the lifetime map as a stray horizontal rule through the Pacific. Any step
 * of more than half the world is therefore treated as a lift of the pen: the
 * ring becomes several subpaths in one `d`, which is also why an unclosed
 * `Z` is only appended per subpath rather than once at the end.
 */
function ringToShape(ring, close) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const runs = [];
  let run = [];
  let prevLng = null;
  for (const [lng, lat] of ring) {
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

/** Every ring of every feature in a GeoJSON collection, as shapes. */
function collectionToShapes(collection, { close, keep, minSpanUnits = 0 }) {
  const shapes = [];
  for (const feat of collection.features ?? []) {
    if (keep && !keep(feat.properties ?? {})) continue;
    const geom = feat.geometry;
    if (!geom) continue;
    const parts =
      geom.type === "Polygon" || geom.type === "MultiLineString"
        ? geom.coordinates
        : geom.type === "MultiPolygon"
          ? geom.coordinates.flat()
          : geom.type === "LineString"
            ? [geom.coordinates]
            : [];
    for (const ring of parts) {
      const shape = ringToShape(ring, close);
      if (!shape) continue;
      const [minX, minY, maxX, maxY] = shape;
      if (Math.max(maxX - minX, maxY - minY) < minSpanUnits) continue;
      shapes.push(shape);
    }
  }
  return shapes;
}

async function main() {
  console.log("Fetching Natural Earth 10m layers:");

  // Countries rather than land: a landlocked trip gets nothing from a
  // coastline, and the country file contains the coastline anyway — its
  // outer rings *are* the coast wherever a country meets the sea.
  const countriesFile = arg("countries");
  const countries = countriesFile
    ? JSON.parse(fs.readFileSync(countriesFile, "utf8"))
    : (await import("world-atlas/countries-10m.json", { with: { type: "json" } })).default;
  const borders = feature(countries, countries.objects.countries);
  console.log(`  countries-10m … ok (${borders.features.length} countries)`);

  // The same countries at 1:110m, for frames too wide to benefit from 10m.
  //
  // Resolution has to match scale or the page pays for detail nobody can see:
  // clipping 10m data to a frame spanning Europe to Vietnam returned 7,400
  // shapes and thirteen megabytes of path text, and even the Asia trip alone
  // was shipping 754 KB gzipped. At that width a 1.6 km coastline is a rounding
  // error on a single pixel. This layer is a twentieth of the size and
  // indistinguishable above a couple of thousand kilometres.
  const coarse = (await import("world-atlas/countries-110m.json", { with: { type: "json" } }))
    .default;
  const bordersCoarse = feature(coarse, coarse.objects.countries);
  console.log(`  countries-110m … ok (${bordersCoarse.features.length} countries)`);

  // And 1:50m in between. Two levels turned out not to be enough: `asia-2023`
  // frames at 2,400 km, where 110m is visibly blocky along the Vietnamese coast
  // but 10m was still shipping 1.2 MB of path text, because at that resolution
  // a single country polygon — Indonesia, China — is tens of kilobytes on its
  // own. 50m is the level that looks right and weighs a tenth.
  const mid = (await import("world-atlas/countries-50m.json", { with: { type: "json" } })).default;
  const bordersMid = feature(mid, mid.objects.countries);
  console.log(`  countries-50m … ok (${bordersMid.features.length} countries)`);

  const lakes = await fetchJson(`${NE}/ne_10m_lakes.geojson`);
  const rivers = await fetchJson(`${NE}/ne_10m_rivers_lake_centerlines.geojson`);
  const peaks = await fetchJson(`${NE}/ne_10m_geography_regions_elevation_points.geojson`);
  const regions = await fetchJson(`${NE}/ne_10m_geography_regions_polys.geojson`);
  const admin1 = await fetchJson(`${NE}/ne_10m_admin_1_states_provinces_lines.geojson`);
  const glaciers = await fetchJson(`${NE}/ne_10m_glaciated_areas.geojson`);
  const parks = await fetchJson(`${NE}/ne_10m_parks_and_protected_lands_area.geojson`);
  const railroads = await fetchJson(`${NE}/ne_10m_railroads.geojson`);
  const roads = await fetchJson(`${NE}/ne_10m_roads.geojson`);

  const out = {
    version: 1,
    // What a reader is entitled to know about where the map came from. Both
    // datasets are public domain / CC-BY and the attribution belongs on disk
    // rather than only in this script's comments.
    attribution: "Natural Earth (public domain)",
    // Islets below the source's own resolution are dropped: at a 1.6 km median
    // between points a two-kilometre rock is three vertices, and there are
    // thousands of them. The old bake made the same call by a cruder rule —
    // "fewer than eight points" (scripts/build-world-map.mjs).
    borders: collectionToShapes(borders, { close: true, minSpanUnits: unitsForKm(2) }),
    bordersMid: collectionToShapes(bordersMid, { close: true, minSpanUnits: unitsForKm(8) }),
    bordersCoarse: collectionToShapes(bordersCoarse, { close: true }),
    lakes: collectionToShapes(lakes, {
      close: true,
      minSpanUnits: MIN_LAKE_KM / 111.32 / (360 / 1000),
    }),
    rivers: collectionToShapes(rivers, {
      close: false,
      keep: (p) => (p.scalerank ?? 99) <= RIVER_SCALERANK_MAX,
    }),
    // High ground, as far as a vector basemap can express it.
    //
    // Natural Earth has no contours and no elevation raster in this pipeline,
    // so "a bit of elevation" is the named terrain regions: mountain ranges,
    // plateaus and foothills as polygons, drawn as a soft tint under
    // everything else. It says "the ground rises here" without pretending to
    // be a topographic map, which is the honest limit of the data — anything
    // finer is the OSM/PMTiles rewrite this task deliberately does not take.
    //
    // Note the property names in *this* layer are upper case where every other
    // Natural Earth file used here is lower case. Reading `featurecla` rather
    // than `FEATURECLA` is what silently produced 1,047 features all classed
    // `undefined` on the first attempt.
    relief: collectionToShapes(regions, {
      close: true,
      keep: (p) => ["Range/mtn", "Plateau", "Foothills"].includes(p.FEATURECLA ?? p.featurecla),
    }),
    // Cantons, prefectures, states — the border a reader actually crosses on a
    // trip inside one country, which the country layer cannot show. Lines
    // rather than polygons: only the boundary is wanted, and the polygon file
    // is four times the size to draw the same thing.
    //
    // `min_zoom` is Natural Earth's own judgement of when a subdivision is
    // worth drawing. Keeping the whole layer roughly doubles this file for
    // boundaries between administrative districts nobody on a holiday is
    // thinking about.
    admin1: collectionToShapes(admin1, {
      close: false,
      keep: (p) => (p.min_zoom ?? p.MIN_ZOOM ?? 99) <= ADMIN1_MIN_ZOOM_MAX,
    }),
    // Ice. In the Alps this is the Aletsch, two valleys from where the demo
    // trip crosses the Grimsel, and it is the single feature that most makes a
    // mountain map look like mountains.
    glaciers: collectionToShapes(glaciers, {
      close: true,
      minSpanUnits: unitsForKm(4),
    }),
    // National parks and protected land. Natural Earth's layer is the US
    // National Park Service only, which is a limitation worth knowing rather
    // than hiding — it happens to be exactly the demo `parks-2025` trip, and it
    // is 187 KB, the cheapest layer here by a wide margin.
    parks: collectionToShapes(parks, { close: true }),
    // Main lines only. The whole layer is 40 MB and includes sidings; what a
    // reader wants on a rail trip is the line they were actually on.
    railroads: collectionToShapes(railroads, {
      close: false,
      keep: (p) => (p.scalerank ?? 99) <= RAIL_SCALERANK_MAX,
    }),
    // Big roads. The full layer is 50 MB — every road Natural Earth knows —
    // and drawing all of it would bury the route the trip actually took under
    // a net of lines nobody asked about. Motorways and trunk roads only.
    roads: collectionToShapes(roads, {
      close: false,
      keep: (p) => (p.scalerank ?? 99) <= ROAD_SCALERANK_MAX,
    }),
    peaks: [],
  };

  for (const feat of peaks.features ?? []) {
    const p = feat.properties ?? {};
    // `mountain` and `pass` only. The layer also carries depressions, plateaus,
    // capes and "spot elevation" markers, none of which is what a reader means
    // by a mountain. Natural Earth's class for a summit is `mountain`, not
    // `peak` — the first version of this filter looked for `peak`, matched
    // nothing at all, and shipped a mountains layer with no mountains in it.
    if (p.featurecla !== "mountain" && p.featurecla !== "pass") continue;
    const [lng, lat] = feat.geometry?.coordinates ?? [];
    if (typeof lng !== "number" || typeof lat !== "number") continue;
    const [x, y] = project(lat, lng);
    out.peaks.push([
      Number(x.toFixed(DECIMALS)),
      Number(y.toFixed(DECIMALS)),
      Math.round(p.elevation ?? 0),
      String(p.name ?? "").slice(0, 40),
    ]);
  }

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  const json = JSON.stringify(out);
  fs.writeFileSync(OUT_FILE, zlib.gzipSync(json, { level: 9 }));

  const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
  console.log(`\nWrote ${path.relative(ROOT, OUT_FILE)}`);
  for (const [name, layer] of Object.entries(out)) {
    if (Array.isArray(layer)) {
      console.log(`  ${name.padEnd(10)} ${String(layer.length).padStart(6)}`);
    }
  }
  console.log(`  ${kb(json.length)} raw → ${kb(fs.statSync(OUT_FILE).size)} gzipped`);
}

await main();

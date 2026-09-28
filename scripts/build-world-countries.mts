// Bakes the world's countries into lib/worldCountries.json as plain SVG path
// data, each carrying the ISO 3166-1 alpha-2 code that identifies it.
//
// The sibling of build-world-map.mjs, and deliberately separate from it and
// from lib/mapdata/basemap.json.gz. Those two answer "draw the ground": the
// basemap is 6.7 MB, clipped per frame and built from network fetches, and
// worldLand.json is a coastline with no countries in it at all. Neither can
// say *this shape is Thailand*, which is the whole question the lifetime map
// asks — so this file exists to answer it and nothing else. B361.
//
// 1:110m rather than 10m: this is only ever drawn at world scale, where the
// coarse outline is indistinguishable and a twentieth of the weight.
//
// A one-off preprocessing step — `world-atlas` and `topojson-client` are
// devDependencies and never ship to the browser. One network fetch, for
// Natural Earth's own CONTINENT/SUBREGION fields (B2491): `world-atlas`'s
// topology strips every property but `name`, so the continent switch's data
// comes from the same admin-0 source `scripts/build-mapdata.mjs` already
// fetches live, joined back onto this file's shapes by ISO 3166-1 code.
// Run with: npm run build:worldcountries
import fs from "node:fs";
import path from "node:path";
import { feature } from "topojson-client";
import topology from "world-atlas/countries-110m.json" with { type: "json" };
import { project, MAP_VIEWBOX } from "../lib/mapProjection.mjs";
import { COUNTRY_CODES } from "../lib/countryCodes";

const NE_ADMIN0 =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson";

/** ISO 3166-1 alpha-2 → Natural Earth's own CONTINENT/SUBREGION strings. */
async function fetchContinents(): Promise<Record<string, { continent: string; subregion: string }>> {
  const res = await fetch(NE_ADMIN0);
  if (!res.ok) throw new Error(`Natural Earth admin-0 fetch failed: ${res.status}`);
  const geo = (await res.json()) as {
    features: {
      properties: { ISO_A2?: string; ISO_A2_EH?: string; CONTINENT?: string; SUBREGION?: string };
    }[];
  };
  const out: Record<string, { continent: string; subregion: string }> = {};
  for (const f of geo.features) {
    // Natural Earth's own `ISO_A2` is "-99" for France, Norway and Kosovo (a
    // sovereignty placeholder) and a disputed-territory compound like
    // "CN-TW" for Taiwan — neither is the plain alpha-2 this file keys on, so
    // `ISO_A2_EH` ("de facto") is read instead whenever `ISO_A2` isn't one.
    const iso2 = /^[A-Z]{2}$/;
    const code = iso2.test(f.properties.ISO_A2 ?? "") ? f.properties.ISO_A2 : f.properties.ISO_A2_EH;
    if (!code || !iso2.test(code)) continue;
    out[code] = { continent: f.properties.CONTINENT ?? "", subregion: f.properties.SUBREGION ?? "" };
  }
  return out;
}

/**
 * Manual continent/subregion for the handful of codes this file names that
 * Natural Earth's `ISO_A2` join misses — the same split/alias cases
 * `SPLITS`/`ALIASES` above already carry by hand, so they need the same
 * treatment here rather than silently drawing with an empty continent.
 */
const CONTINENT_OVERRIDES: Record<string, { continent: string; subregion: string }> = {
  // French Guiana: split off metropolitan France above; South America, not
  // Western Europe.
  GF: { continent: "South America", subregion: "South America" },
};

const ROOT = path.join(import.meta.dirname, "..");
const OUT_FILE = path.join(ROOT, "lib", "worldCountries.json");

/**
 * Natural Earth's own spellings, which `lib/countryCodes.ts` does not carry
 * because nobody types them — that table is built from the names people write
 * in frontmatter. 161 of the 177 features match without help; these are the
 * rest.
 *
 * Antarctica, N. Cyprus and Somaliland are deliberately absent rather than
 * guessed: two are disputed and the third is nobody's holiday. They render as
 * ordinary unvisited land, which is what they are.
 */
const ALIASES: Record<string, string> = {
  "w. sahara": "EH",
  "dem. rep. congo": "CD",
  "dominican rep.": "DO",
  "falkland is.": "FK",
  "fr. s. antarctic lands": "TF",
  "côte d'ivoire": "CI",
  "central african rep.": "CF",
  congo: "CG",
  "eq. guinea": "GQ",
  palestine: "PS",
  "solomon is.": "SB",
  "bosnia and herz.": "BA",
  "s. sudan": "SS",
};

/**
 * Natural Earth's admin-0 features are *sovereign states*, not countries as a
 * traveller means them — France (id 250) is one MultiPolygon spanning
 * metropolitan France and French Guiana, three thousand miles and a
 * continent apart. Filling the whole shape for a trip that only ever visited
 * Paris colours in South America too (B1594). This table pulls a feature's
 * far-flung part off under its own ISO 3166-1 code before the fill and the
 * label are built, so the two consumers (`components/LifetimeMap.tsx`'s fill,
 * and `app/[user]/trips/page.tsx`'s bounding-box frame) need no special case.
 *
 * At 110m this has exactly one certain row. Norway's MultiPolygon spans
 * Svalbard too, but Svalbard is genuinely Norwegian territory rather than a
 * different country by any traveller's reckoning — visited-Norway is not a
 * false claim there — so it is left joined, a judgement rather than a bug.
 */
const SPLITS: Record<string, { code: string; name: string; maxLng: number }> = {
  // The South American part of France sits west of -20°; metropolitan
  // France, Corsica and Réunion (below 110m resolution and absent from this
  // topology anyway) do not.
  france: { code: "GF", name: "French Guiana", maxLng: -20 },
};

/** What this script needs of a country feature, and nothing more. */
type CountryFeature = {
  properties?: { name?: string };
  geometry?:
    | { type: "Polygon"; coordinates: Ring[] }
    | { type: "MultiPolygon"; coordinates: Ring[][] };
};
type Ring = [number, number][];

/**
 * Splits a ring wherever consecutive points cross the antimeridian, rather
 * than drawing one path that wraps all the way round the world.
 *
 * `project()` puts ±180° at x = 0 and x = 1000 (`MAP_VIEWBOX.width`) alike —
 * a fine seam for a route (`lib/mapFrame.ts`'s `unwrap` walks it the other
 * way, keeping a route's own points continuous), but a *ring* that steps from
 * 179.9° to −179.9° projects as a jump from x≈1000 straight to x≈0, and the
 * closed path draws that jump as a solid horizontal line across the whole
 * map. Fiji, Russia (two subpaths) and Antarctica all have rings like this at
 * 1:110m. Splitting the ring at each such jump into separate closed subpaths
 * keeps each one local; the straight edge this leaves at the split (rather
 * than the ring's true wrap around the pole or across the date line) is
 * invisible at world zoom, which is the only zoom this file is ever drawn at.
 */
function splitAntimeridian(ring: [number, number][]): [number, number][][] {
  const JUMP = MAP_VIEWBOX.width / 2; // half the world — a smaller step is ordinary geometry, not a wrap.
  const runs: [number, number][][] = [];
  let current: [number, number][] = [];
  for (const p of ring) {
    if (current.length > 0 && Math.abs(p[0] - current[current.length - 1][0]) > JUMP) {
      if (current.length >= 2) runs.push(current);
      current = [];
    }
    current.push(p);
  }
  if (current.length >= 2) runs.push(current);
  return runs.length > 0 ? runs : [ring];
}

function ringToPath(ring: Ring): string {
  const projected = ring.map(([lng, lat]) => project(lat, lng)) as [number, number][];
  return splitAntimeridian(projected)
    .map((run) => `M${run.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" L")} Z`)
    .join(" ");
}

const geo = feature(topology, topology.objects.countries) as { features: CountryFeature[] };

const out: {
  code: string | null;
  name: string;
  path: string;
  /** Where a label for this country goes, in the same projected space as
   * `path`. */
  x: number;
  y: number;
  /** How wide the country is on the map, for ordering labels largest-first —
   * the big ones win a crowded frame, the way town labels already do. */
  w: number;
  /**
   * The bounding box, in projected units, of this country's **main
   * landmass only** — its largest single ring, the same one the label sits
   * on. B2491's per-country framing reads this rather than `path`'s full
   * multi-polygon extent, so a country with a far-flung island (Ecuador and
   * the Galápagos, Chile and Rapa Nui) is framed on the mainland a trip
   * actually reached, not stretched to include land nobody visited.
   */
  mainBBox: [number, number, number, number];
  continent: string;
  subregion: string;
}[] = [];
const unmatched: string[] = [];

/** A polygon's rough centre longitude, from its outer ring — for deciding
 * which side of a `SPLITS` threshold it falls on. */
function centroidLng(polygon: Ring[]): number {
  const lngs = polygon[0].map(([lng]) => lng);
  return (Math.min(...lngs) + Math.max(...lngs)) / 2;
}

/** Builds one country's path and label position from its usable polygons,
 * and pushes it — shared between a feature's main body and a part `SPLITS`
 * has pulled off under its own code. */
function emit(
  code: string | null,
  name: string,
  usable: Ring[][],
  continents: Record<string, { continent: string; subregion: string }>,
): void {
  const d = usable.map((rings) => rings.map(ringToPath).join(" ")).join(" ");
  if (!d) return;

  /**
   * The label — and the framing bounding box below — sit on the country's
   * *largest* landmass, not the mean of all of them. Averaging puts the
   * United States' name in the Pacific between Alaska and Florida.
   */
  let best: { x: number; y: number; w: number; minX: number; maxX: number; minY: number; maxY: number } | null =
    null;
  for (const rings of usable) {
    const projected = rings[0].map(([lng, lat]) => project(lat, lng)) as [number, number][];
    // Same antimeridian split as `ringToPath` — otherwise Fiji or Russia's
    // "largest landmass" bbox is the whole 1000-unit-wide world, not the
    // island or peninsula that ring actually draws.
    for (const pts of splitAntimeridian(projected)) {
      const xs = pts.map(([x]) => x);
      const ys = pts.map(([, y]) => y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const w = maxX - minX;
      if (!best || w > best.w) {
        best = { x: (minX + maxX) / 2, y: (minY + maxY) / 2, w, minX, maxX, minY, maxY };
      }
    }
  }
  if (!best) return;

  const region = (code && (CONTINENT_OVERRIDES[code] ?? continents[code])) || { continent: "", subregion: "" };

  out.push({
    code,
    name,
    path: d,
    x: +best.x.toFixed(1),
    y: +best.y.toFixed(1),
    w: +best.w.toFixed(1),
    mainBBox: [+best.minX.toFixed(1), +best.minY.toFixed(1), +best.maxX.toFixed(1), +best.maxY.toFixed(1)],
    continent: region.continent,
    subregion: region.subregion,
  });
}

async function main() {
  const continents = await fetchContinents();

  for (const f of geo.features) {
    const name = f.properties?.name ?? "";
    const code = COUNTRY_CODES[name.toLowerCase()] ?? ALIASES[name.toLowerCase()] ?? null;
    // An unidentifiable country is still drawn — it is ground, not a hole in
    // the map. It simply can never be filled as visited.
    if (!code) unmatched.push(name);

    const geom = f.geometry;
    if (!geom) continue;
    const polygons = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;

    // Every polygon of one country joins into a single path, so a country is one
    // shape to fill, hover and click. Indonesia is not thirteen thousand
    // countries, and a path per island would make it behave like them.
    const usable = polygons.filter((rings) => rings[0] && rings[0].length >= 4);

    const split = SPLITS[name.toLowerCase()];
    if (split) {
      const apart = usable.filter((rings) => centroidLng(rings) < split.maxLng);
      const kept = usable.filter((rings) => centroidLng(rings) >= split.maxLng);
      emit(split.code, split.name, apart, continents);
      emit(code, name, kept, continents);
      continue;
    }

    emit(code, name, usable, continents);
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify(out));

  const named = out.filter((c) => c.code).length;
  const noRegion = out.filter((c) => c.code && !c.continent).map((c) => c.code);
  console.log(
    `Wrote ${out.length} countries (${named} identified, ${out.length - named} unidentified) ` +
      `at ${MAP_VIEWBOX.width}x${MAP_VIEWBOX.height} to ${path.relative(ROOT, OUT_FILE)}`,
  );
  if (unmatched.length > 0) {
    console.log(`  no ISO code, drawn as plain ground: ${unmatched.join(", ")}`);
  }
  if (noRegion.length > 0) {
    console.log(`  no continent/subregion match: ${noRegion.join(", ")}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

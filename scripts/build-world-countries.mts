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
import { filterCountryList } from "../lib/countries";

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

/**
 * Small countries — B2930. 1:110m drops every state too small to draw at
 * world scale (Liechtenstein, Singapore, Åland, most islands), yet the
 * country picker offers them all and the visited form, the API and the trips
 * page only accept a code this file carries. Each code the picker offers with
 * no 110m shape becomes a dot instead: a small octagon at Natural Earth's own
 * 1:50m label point, so every consumer treats it as an ordinary shape. Not
 * 50m outlines — ten times the file, and still sub-pixel at world zoom.
 */
const NE_ADMIN0_50M =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson";
const DOT_RADIUS = 1.5;

/** Codes Natural Earth's 50m admin-0 has no feature of its own for (they sit
 * inside France, the Netherlands, Norway, Australia, New Zealand or the UK
 * there), and the open-ocean ones whose "Seven seas" continent has no button:
 * position and region by hand, regions as the UN geoscheme has them. */
const DOT_OVERRIDES: Record<string, { lat?: number; lng?: number; continent: string; subregion: string }> = {
  BQ: { lat: 12.15, lng: -68.27, continent: "North America", subregion: "Caribbean" },
  CX: { lat: -10.49, lng: 105.62, continent: "Oceania", subregion: "Australia and New Zealand" },
  CC: { lat: -12.16, lng: 96.87, continent: "Oceania", subregion: "Australia and New Zealand" },
  GI: { lat: 36.14, lng: -5.35, continent: "Europe", subregion: "Southern Europe" },
  GP: { lat: 16.25, lng: -61.58, continent: "North America", subregion: "Caribbean" },
  MQ: { lat: 14.64, lng: -61.02, continent: "North America", subregion: "Caribbean" },
  YT: { lat: -12.83, lng: 45.17, continent: "Africa", subregion: "Eastern Africa" },
  RE: { lat: -21.12, lng: 55.54, continent: "Africa", subregion: "Eastern Africa" },
  SJ: { lat: 78.22, lng: 15.65, continent: "Europe", subregion: "Northern Europe" },
  TK: { lat: -9.2, lng: -171.85, continent: "Oceania", subregion: "Polynesia" },
  MV: { continent: "Asia", subregion: "Southern Asia" },
  IO: { continent: "Africa", subregion: "Eastern Africa" },
  MU: { continent: "Africa", subregion: "Eastern Africa" },
  SC: { continent: "Africa", subregion: "Eastern Africa" },
  SH: { continent: "Africa", subregion: "Western Africa" },
};

/** ISO 3166-1 alpha-2 → 50m label point and region, for the dots. */
async function fetchLabelPoints(): Promise<
  Record<string, { lat: number; lng: number; continent: string; subregion: string }>
> {
  const res = await fetch(NE_ADMIN0_50M);
  if (!res.ok) throw new Error(`Natural Earth 50m admin-0 fetch failed: ${res.status}`);
  const geo = (await res.json()) as {
    features: {
      properties: {
        ISO_A2?: string;
        ISO_A2_EH?: string;
        LABEL_X: number;
        LABEL_Y: number;
        CONTINENT: string;
        SUBREGION: string;
      };
    }[];
  };
  const iso2 = /^[A-Z]{2}$/;
  const out: Record<string, { lat: number; lng: number; continent: string; subregion: string }> = {};
  for (const { properties: p } of geo.features) {
    const code = iso2.test(p.ISO_A2 ?? "") ? p.ISO_A2 : p.ISO_A2_EH;
    if (!code || !iso2.test(code)) continue;
    out[code] = { lat: p.LABEL_Y, lng: p.LABEL_X, continent: p.CONTINENT, subregion: p.SUBREGION };
  }
  return out;
}

const ROOT = path.join(import.meta.dirname, "..");
const OUT_FILE = path.join(ROOT, "lib", "worldCountries.json");

/**
 * Natural Earth's own spellings, which `lib/countryCodes.ts` does not carry
 * because nobody types them — that table is built from the names people write
 * in frontmatter. 161 of the 177 features match without help; these are the
 * rest.
 *
 * N. Cyprus and Somaliland are deliberately absent rather than guessed: both
 * are disputed, and the country picker does not offer either. They render as
 * ordinary unvisited land. Antarctica is named (B2930): the picker offers it
 * and people do go.
 */
const ALIASES: Record<string, string> = {
  antarctica: "AQ",
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
 * and `app/at/[user]/trips/page.tsx`'s bounding-box frame) need no special case.
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

  const labels = await fetchLabelPoints();
  const drawn = new Set(out.map((c) => c.code));
  const dotless: string[] = [];
  for (const { iso2, name } of filterCountryList("", "en")) {
    if (drawn.has(iso2)) continue;
    const at = { ...labels[iso2], ...DOT_OVERRIDES[iso2] };
    if (at.lat === undefined || at.lng === undefined || !at.continent) {
      dotless.push(iso2);
      continue;
    }
    const [x, y] = project(at.lat, at.lng);
    const ring = Array.from({ length: 8 }, (_, i) => {
      const a = (i * Math.PI) / 4;
      return `${(x + DOT_RADIUS * Math.cos(a)).toFixed(1)},${(y + DOT_RADIUS * Math.sin(a)).toFixed(1)}`;
    });
    const r = (n: number) => +n.toFixed(1);
    out.push({
      code: iso2,
      name,
      path: `M${ring.join(" L")} Z`,
      x: r(x),
      y: r(y),
      w: DOT_RADIUS * 2,
      mainBBox: [r(x - DOT_RADIUS), r(y - DOT_RADIUS), r(x + DOT_RADIUS), r(y + DOT_RADIUS)],
      continent: at.continent,
      subregion: at.subregion,
    });
  }
  // Every code the picker offers must be accepted; a missing one is a build
  // failure, not a country the form will refuse.
  if (dotless.length > 0) throw new Error(`no position for picker codes: ${dotless.join(", ")}`);

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

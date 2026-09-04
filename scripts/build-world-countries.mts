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
// devDependencies and never ship to the browser. No network.
// Run with: npm run build:worldcountries
import fs from "node:fs";
import path from "node:path";
import { feature } from "topojson-client";
import topology from "world-atlas/countries-110m.json" with { type: "json" };
import { project, MAP_VIEWBOX } from "../lib/mapProjection.mjs";
import { COUNTRY_CODES } from "../lib/countryCodes";

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

/** What this script needs of a country feature, and nothing more. */
type CountryFeature = {
  properties?: { name?: string };
  geometry?:
    | { type: "Polygon"; coordinates: Ring[] }
    | { type: "MultiPolygon"; coordinates: Ring[][] };
};
type Ring = [number, number][];

function ringToPath(ring: Ring): string {
  const pts = ring.map(([lng, lat]) => {
    const [x, y] = project(lat, lng);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return `M${pts.join(" L")} Z`;
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
}[] = [];
const unmatched: string[] = [];

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
  const d = usable.map((rings) => rings.map(ringToPath).join(" ")).join(" ");
  if (!d) continue;

  /**
   * The label sits on the country's *largest* landmass, not on the mean of
   * all of them. Averaging puts the United States' name in the Pacific
   * between Alaska and Florida, and France's off the coast of South America
   * by way of French Guiana — the label ends up in the sea for exactly the
   * countries most likely to be visited.
   */
  let best: { x: number; y: number; w: number } | null = null;
  for (const rings of usable) {
    const pts = rings[0].map(([lng, lat]) => project(lat, lng));
    const xs = pts.map(([x]) => x);
    const ys = pts.map(([, y]) => y);
    const w = Math.max(...xs) - Math.min(...xs);
    if (!best || w > best.w) {
      best = {
        x: (Math.min(...xs) + Math.max(...xs)) / 2,
        y: (Math.min(...ys) + Math.max(...ys)) / 2,
        w,
      };
    }
  }
  if (!best) continue;

  out.push({ code, name, path: d, x: +best.x.toFixed(1), y: +best.y.toFixed(1), w: +best.w.toFixed(1) });
}

fs.writeFileSync(OUT_FILE, JSON.stringify(out));

const named = out.filter((c) => c.code).length;
console.log(
  `Wrote ${out.length} countries (${named} identified, ${out.length - named} unidentified) ` +
    `at ${MAP_VIEWBOX.width}x${MAP_VIEWBOX.height} to ${path.relative(ROOT, OUT_FILE)}`,
);
if (unmatched.length > 0) {
  console.log(`  no ISO code, drawn as plain ground: ${unmatched.join(", ")}`);
}

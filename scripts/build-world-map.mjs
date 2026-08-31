// Bakes a simplified world land outline into lib/worldLand.json as plain SVG
// path data. A one-off preprocessing step — `world-atlas` and
// `topojson-client` are devDependencies and never ship to the browser.
// Run with: npm run build:worldmap
import fs from "node:fs";
import path from "node:path";
import { feature } from "topojson-client";
import topology from "world-atlas/land-110m.json" with { type: "json" };
import { project, MAP_VIEWBOX } from "../lib/mapProjection.mjs";

const ROOT = path.join(import.meta.dirname, "..");
const OUT_FILE = path.join(ROOT, "lib", "worldLand.json");

function ringToPath(ring) {
  const pts = ring.map(([lng, lat]) => {
    const [x, y] = project(lat, lng);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return `M${pts.join(" L")} Z`;
}

const geo = feature(topology, topology.objects.land);
const geometries =
  geo.type === "FeatureCollection" ? geo.features.map((f) => f.geometry) : [geo.geometry];

const paths = [];
for (const geom of geometries) {
  const polygons = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  for (const rings of polygons) {
    // Skip tiny islands — they add bulk without reading at this scale.
    if (!rings[0] || rings[0].length < 8) continue;
    paths.push(rings.map(ringToPath).join(" "));
  }
}

fs.writeFileSync(OUT_FILE, JSON.stringify(paths));
console.log(
  `Wrote ${paths.length} land shapes (${MAP_VIEWBOX.width}x${MAP_VIEWBOX.height}) to ${path.relative(ROOT, OUT_FILE)}`,
);

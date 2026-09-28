/**
 * Shared by `npm run maps:world` and `npm run maps:trip` — B2535. Not
 * imported by the app itself: extraction is an operator-run, best-effort
 * step, and a missing `pmtiles` CLI must never be something a page or a
 * request depends on (AGENTS.md — no feature needs a tool the app itself
 * requires).
 */
import { execFileSync } from "node:child_process";

/** Earth's mean radius, km — near enough for a padding/clustering distance
 * that only ever decides which tiles to fetch, never anything drawn. */
const EARTH_RADIUS_KM = 6371;
const KM_PER_DEGREE_LAT = 111.32;

export type LatLng = { lat: number; lng: number };

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance between two points, km. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Groups points into regions: any two points within `thresholdKm` of each
 * other land in the same region, transitively (union-find). Trips have at
 * most a few dozen day places, so the O(n²) pairwise comparison below is
 * never worth a spatial index. — the plan's "merged per region > 300 km
 * apart" rule (docs/plans/2026-09-28-trip-maps/README.md).
 */
export function clusterRegions(points: readonly LatLng[], thresholdKm: number): LatLng[][] {
  const parent = points.map((_, i) => i);
  function find(i: number): number {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  }
  function union(a: number, b: number) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      if (haversineKm(points[i], points[j]) <= thresholdKm) union(i, j);
    }
  }
  const groups = new Map<number, LatLng[]>();
  points.forEach((p, i) => {
    const root = find(i);
    const group = groups.get(root);
    if (group) group.push(p);
    else groups.set(root, [p]);
  });
  return [...groups.values()];
}

/** A region's bounding box, padded by `padKm` on every side, as
 * `[minLon, minLat, maxLon, maxLat]` — the shape `pmtiles extract --bbox`
 * and lib/maps/dir.ts's index both want. */
export function paddedBbox(points: readonly LatLng[], padKm: number): [number, number, number, number] {
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const midLat = (minLat + maxLat) / 2;
  const latPad = padKm / KM_PER_DEGREE_LAT;
  const lngPad = padKm / (KM_PER_DEGREE_LAT * Math.max(0.1, Math.cos(toRad(midLat))));
  return [minLng - lngPad, minLat - latPad, maxLng + lngPad, maxLat + latPad];
}

/**
 * Widens whichever side of a bbox is short, so the extracted region is at
 * least `targetAspect` (width/height, in km) — B2538. A trip that runs one
 * road north–south (`alps-2024`'s own four stops are a narrow vertical
 * strip) extracted a region only as wide as `paddedBbox` above made it, so
 * the card's own 16:10 frame showed street tiles only in a stripe down the
 * middle and Natural Earth either side of it. Only ever grows a side,
 * symmetrically around the box's own centre — never shrinks the other one,
 * so a trip that was already wide enough is untouched.
 */
export function expandToAspect(
  bbox: [number, number, number, number],
  targetAspect: number,
): [number, number, number, number] {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const midLat = (minLat + maxLat) / 2;
  const kmPerDegLng = KM_PER_DEGREE_LAT * Math.max(0.1, Math.cos(toRad(midLat)));
  const widthKm = (maxLng - minLng) * kmPerDegLng;
  const heightKm = (maxLat - minLat) * KM_PER_DEGREE_LAT;
  if (widthKm <= 0 || heightKm <= 0) return bbox;

  const aspect = widthKm / heightKm;
  // Already at least as wide (relative to its height) as the target — a
  // route that runs mostly east–west needs no help, and this never narrows
  // one to force it down to exactly the target.
  if (aspect >= targetAspect) return bbox;

  const wantWidthKm = heightKm * targetAspect;
  const extraDeg = (wantWidthKm - widthKm) / kmPerDegLng / 2;
  return [minLng - extraDeg, minLat, maxLng + extraDeg, maxLat];
}

/**
 * Protomaps publishes a rolling few days of daily builds and today's is
 * routinely not up yet (checked 2026-09-28: yesterday's build was live,
 * today's was still 404) — so the default points at yesterday's date in UTC
 * rather than today's. `MAPS_SOURCE` overrides it outright.
 */
export function defaultMapsSource(): string {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const y = yesterday.getUTCFullYear();
  const m = String(yesterday.getUTCMonth() + 1).padStart(2, "0");
  const d = String(yesterday.getUTCDate()).padStart(2, "0");
  return `https://build.protomaps.com/${y}${m}${d}.pmtiles`;
}

export function mapsSource(): string {
  return process.env.MAPS_SOURCE?.trim() || defaultMapsSource();
}

const INSTALL_HELP = `The 'pmtiles' CLI is not on PATH.

Install it (macOS/Linux, arm64/amd64 — pick the matching one from
https://github.com/protomaps/go-pmtiles/releases) with, for example:

  curl -sSL <release .zip or .tar.gz URL for your platform> -o pmtiles.zip
  unzip pmtiles.zip && chmod +x pmtiles && sudo mv pmtiles /usr/local/bin/

Then re-run this command.`;

/** Exits the process with install instructions when `pmtiles` isn't
 * reachable — the app itself never needs this binary (AGENTS.md), only
 * these two operator scripts do. */
export function requirePmtilesBinary(): void {
  try {
    execFileSync("pmtiles", ["version"], { stdio: "ignore" });
  } catch {
    console.error(INSTALL_HELP);
    process.exit(1);
  }
}

export function runPmtilesExtract(args: readonly string[]): void {
  execFileSync("pmtiles", ["extract", ...args], { stdio: "inherit" });
}

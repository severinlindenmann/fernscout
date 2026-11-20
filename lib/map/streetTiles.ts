import "server-only";
import fs from "node:fs/promises";
import zlib from "node:zlib";
import { promisify } from "node:util";
import Pbf from "pbf";
import { VectorTile } from "@mapbox/vector-tile";
import { PMTiles, type Source, type RangeResponse, Compression } from "pmtiles";
import { place, type Frame } from "../mapFrame";
import { isOpenFreeMap, OPENFREEMAP_MAX_ZOOM, OPENFREEMAP_ORIGIN, OPENFREEMAP_TILEJSON } from "./openFreeMap";

const gunzip = promisify(zlib.gunzip);

/**
 * Reads a local PMTiles file with Node's own `fs`, the server-side
 * equivalent of the `pmtiles` package's own `FileSource` (which is written
 * against the browser's File API — see its own d.ts — and so cannot open a
 * path on disk). Only `getBytes`/`getKey` are ever called on a `Source`, so
 * this is the whole contract.
 */
export class NodeFileSource implements Source {
  constructor(private readonly file: string) {}
  getKey(): string {
    return this.file;
  }
  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    const handle = await fs.open(this.file, "r");
    try {
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, offset);
      return { data: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) };
    } finally {
      await handle.close();
    }
  }
}

/** `pmtiles`'s own default decompressor reaches for the browser's
 * `DecompressionStream`; Node 24 (this repo's `.nvmrc`) has that global too,
 * but `zlib.gunzip` is the same work with no stream plumbing. */
export async function nodeDecompress(buf: ArrayBuffer, compression: Compression): Promise<ArrayBuffer> {
  if (compression === Compression.None || compression === Compression.Unknown) return buf;
  if (compression !== Compression.Gzip) {
    throw new Error(`Unsupported PMTiles compression: ${compression}`);
  }
  const out = await gunzip(Buffer.from(buf));
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
}

/** One decoded layer, already projected into frame-local output pixels — ready
 * to join straight into a `<path d="…">`. */
export type StreetLayers = {
  /** Filled polygons: water bodies. */
  water: string[];
  /** Filled polygons: parks and other landuse worth a tint. */
  landuse: string[];
  /** Stroked lines: roads and tracks, undifferentiated by kind — see the
   * module doc for why. */
  roads: string[];
};

/** The vector layers this card draws from a Protomaps-schema tile — see
 * `lib/map/paperFlavor.ts` for the same schema used interactively. "earth"
 * is deliberately absent: it is simply "not water" at world scale, and the
 * card already fills its background with the land colour, so drawing earth
 * polygons on top would be paying to redraw the same pixels.
 *
 * "landuse" is measured and dropped, not merely simplified: at z14/15 it is
 * overwhelmingly individual building footprints and small parcels — 3,608
 * of them for a four-stop Alpine trip, 264 kB of path data on its own even
 * after `ringsToPath`'s own trims — for a 35%-opacity tint the card can
 * lose without losing "the route at a glance". Re-add it, filtered to a
 * real minimum footprint (the projected-area test below also used for water),
 * if a design review wants the tint back and has room in the "< 150 kB" budget
 * for it.
 *
 * ponytail: "places" (town labels) and "buildings" are skipped entirely —
 * the day-number markers and chips already carry every name the card needs,
 * and a name collision-avoidance pass is a feature of its own. Add it if a
 * design review says the card reads as bare without them. */
const LAYER_NAMES = ["water", "roads"] as const;
/** Every `StreetLayers.landuse` is `[]` — kept in the type (rather than
 * dropped from it) so `lib/map/cardSvg.ts`'s "if street.landuse.length > 0"
 * branch needs no change to re-enable it later. */

/** Standard slippy-map tile math — the inverse of what every `/{z}/{x}/{y}`
 * tile server uses to cut the world up. */
function lngToTileX(lng: number, z: number): number {
  return Math.floor(((lng + 180) / 360) * 2 ** z);
}
function latToTileY(lat: number, z: number): number {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z,
  );
}
function tileLocalToLngLat(z: number, x: number, y: number, lx: number, ly: number, extent: number): { lat: number; lng: number } {
  const gx = x + lx / extent;
  const gy = y + ly / extent;
  const n = 2 ** z;
  const lng = (gx / n) * 360 - 180;
  const yFrac = Math.PI - (2 * Math.PI * gy) / n;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(yFrac) - Math.exp(-yFrac)));
  return { lat, lng };
}

/** How many tiles across a card frame may pull before the SVG stops being
 * "small" (README: "aim < 150 kB"). A card is a small, framed area — this is
 * a generous ceiling for the odd frame that lands exactly on a tile seam. */
const MAX_TILES = 16;

/**
 * Chooses the zoom whose tiles are close to the frame's own pixel width —
 * the same "resolution matches scale" reasoning `lib/basemap.ts`'s
 * `WAYS_BELOW_KM`/`DETAIL_BELOW_KM` bands apply to the Natural Earth bundle,
 * done here against a real tile pyramid's own min/max instead of hand-picked
 * bands.
 */
function chooseZoom(dLngDeg: number, widthPx: number, minZoom: number, maxZoom: number): number {
  const tilesWanted = (widthPx / 512) * (360 / Math.max(dLngDeg, 1e-6));
  const z = Math.round(Math.log2(Math.max(tilesWanted, 1)));
  return Math.min(maxZoom, Math.max(minZoom, z));
}

/**
 * Where a card's tiles come from: a local PMTiles file (Protomaps schema) or
 * OpenFreeMap over HTTPS (OpenMapTiles schema, FERN-6). The schema decides
 * the layer names and how a road's class reads; everything after that is
 * shared.
 */
type TileReader = {
  minZoom: number;
  maxZoom: number;
  getZxy(z: number, x: number, y: number): Promise<ArrayBuffer | undefined>;
  layerNames: Record<(typeof LAYER_NAMES)[number], string>;
  /** The Protomaps `kind` a road reads as, or `undefined` for a line that is
   * not a road at all (rail, ferry, aerialway). */
  roadKind(properties: Record<string, unknown>): string | undefined;
};

async function pmtilesReader(file: string): Promise<TileReader | null> {
  try {
    const pmtiles = new PMTiles(new NodeFileSource(file), undefined, nodeDecompress);
    const header = await pmtiles.getHeader();
    return {
      minZoom: header.minZoom,
      maxZoom: header.maxZoom,
      getZxy: async (z, x, y) => (await pmtiles.getZxy(z, x, y))?.data,
      layerNames: { water: "water", roads: "roads" },
      roadKind: (p) => (typeof p.kind === "string" ? p.kind : "other"),
    };
  } catch {
    return null;
  }
}

/** OpenMapTiles `transportation.class` → the Protomaps `kind` the filters
 * below already speak. */
const OPENMAPTILES_ROAD_KIND: Record<string, string> = {
  motorway: "highway",
  trunk: "highway",
  primary: "major_road",
  secondary: "major_road",
  tertiary: "medium_road",
  minor: "minor_road",
  service: "minor_road",
  track: "path",
  path: "path",
};

/** The dated tile template from OpenFreeMap's TileJSON, kept for an hour so a
 * new weekly build is picked up without a TileJSON request per card. */
let openFreeMapTemplate: { template: string; at: number } | undefined;
const TEMPLATE_TTL_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;

async function openFreeMapReader(): Promise<TileReader | null> {
  if (!openFreeMapTemplate || Date.now() - openFreeMapTemplate.at > TEMPLATE_TTL_MS) {
    try {
      const res = await fetch(OPENFREEMAP_TILEJSON, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) return null;
      const json = (await res.json()) as { tiles?: unknown };
      const template = Array.isArray(json.tiles) ? json.tiles[0] : undefined;
      if (typeof template !== "string" || !template.startsWith(`${OPENFREEMAP_ORIGIN}/`)) return null;
      openFreeMapTemplate = { template, at: Date.now() };
    } catch {
      return null;
    }
  }
  const { template } = openFreeMapTemplate;
  return {
    minZoom: 0,
    maxZoom: OPENFREEMAP_MAX_ZOOM,
    getZxy: async (z, x, y) => {
      const url = template.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
      const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) return undefined;
      const buf = Buffer.from(await res.arrayBuffer());
      // A tile body may itself be gzip (magic 1f 8b) if a proxy did not
      // decode it; Node's fetch already undoes a Content-Encoding.
      const raw = buf[0] === 0x1f && buf[1] === 0x8b ? await gunzip(buf) : buf;
      return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
    },
    layerNames: { water: "water", roads: "transportation" },
    roadKind: (p) => (typeof p.class === "string" ? OPENMAPTILES_ROAD_KIND[p.class] : undefined),
  };
}

/**
 * Decodes the vector tiles covering `bbox` out of one PMTiles file (or, for
 * the OpenFreeMap URL, from its hosted tiles), and
 * projects every feature via `place()` into frame-local pixels at `widthPx`
 * — the same projection every marker and line on this card uses, so
 * a road and a day marker never disagree about where the ground is.
 *
 * Returns `null` for a file that cannot be read or has nothing at this
 * bbox — the caller's cue to fall back to `lib/basemap.ts`, same as an
 * absent Natural Earth clip already means "draw the clean background".
 */
export async function streetLayersForBbox(
  file: string,
  bbox: readonly [number, number, number, number],
  frame: Frame,
  widthPx: number,
): Promise<StreetLayers | null> {
  const reader = isOpenFreeMap(file) ? await openFreeMapReader() : await pmtilesReader(file);
  if (!reader) return null;

  const [west, south, east, north] = bbox;
  const z = chooseZoom(Math.max(east - west, 1e-6), widthPx, reader.minZoom, reader.maxZoom);
  const x0 = lngToTileX(west, z);
  const x1 = lngToTileX(east, z);
  // Latitude and tile-y both run the opposite way (north is smaller y).
  const y0 = latToTileY(north, z);
  const y1 = latToTileY(south, z);

  const tiles: [number, number][] = [];
  for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
      tiles.push([x, y]);
      if (tiles.length >= MAX_TILES) break;
    }
    if (tiles.length >= MAX_TILES) break;
  }
  if (tiles.length === 0) return null;

  const out: StreetLayers = { water: [], landuse: [], roads: [] };
  let sawAny = false;

  const fetched = await Promise.all(tiles.map(([x, y]) => reader.getZxy(z, x, y).catch(() => undefined)));
  for (const [index, [x, y]] of tiles.entries()) {
    const data = fetched[index];
    if (!data) continue;
    sawAny = true;
    let tile: VectorTile;
    try {
      tile = new VectorTile(new Pbf(new Uint8Array(data)));
    } catch {
      continue;
    }
    for (const name of LAYER_NAMES) {
      const layer = tile.layers[reader.layerNames[name]];
      if (!layer) continue;
      const bucket = out[name];
      for (let i = 0; i < layer.length; i++) {
        const feature = layer.feature(i);
        // Regional frames need the road network, not every residential street.
        const kind = name === "roads" ? reader.roadKind(feature.properties) : undefined;
        if (name === "roads" && kind === undefined) continue;
        if (
          name === "roads" && z < 12 &&
          kind !== "highway" && kind !== "major_road" &&
          !(z >= 10 && kind === "medium_road")
        ) continue;
        // A card is a picture, not a navigation map: footpaths and service
        // ways were most of a city day card's weight once cards asked for
        // their own frame (B2565 — central Kyoto at z13 came to 1.2 MB).
        if (name === "roads" && (kind === "path" || kind === "other")) continue;
        const rings = feature.loadGeometry();
        const isPolygon = feature.type === 3;
        const isLine = feature.type === 2;
        if (!isPolygon && !isLine) continue;
        // The water bucket is filled: a river drawn as a line there closes
        // into a solid blue wedge (B2565). Water areas only.
        if (name === "water" && !isPolygon) continue;
        // README: "aim < 150 kB". `landuse` at z15 is mostly individual
        // building parcels — a handful of trip stops came to thousands of
        // them (measured: 5,729 for one region), the overwhelming majority
        // of every card's own weight — see `LAYER_NAMES`'s own note on why
        // this layer is not fetched at all today.
        const d = ringsToPath(rings, z, x, y, layer.extent, frame, isPolygon, widthPx);
        if (d) bucket.push(d);
      }
    }
  }

  return sawAny ? out : null;
}

type PixelPoint = [number, number];

/** Iterative Douglas-Peucker: bound screen-space error without a recursion
 * limit on long coastlines. Closed rings include their first point again;
 * the initial zero-length baseline splits at the farthest vertex. */
function simplify(points: PixelPoint[], tolerance: number): PixelPoint[] {
  if (points.length < 3) return points;
  const keep = new Set([0, points.length - 1]);
  const pending: [number, number][] = [[0, points.length - 1]];
  while (pending.length) {
    const [first, last] = pending.pop()!;
    const [ax, ay] = points[first];
    const dx = points[last][0] - ax;
    const dy = points[last][1] - ay;
    const length2 = dx * dx + dy * dy;
    let farthest = -1;
    let maxDistance2 = tolerance * tolerance;
    for (let i = first + 1; i < last; i++) {
      const [x, y] = points[i];
      const t = length2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length2)) : 0;
      const distance2 = (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2;
      if (distance2 > maxDistance2) {
        maxDistance2 = distance2;
        farthest = i;
      }
    }
    if (farthest !== -1) {
      keep.add(farthest);
      pending.push([first, farthest], [farthest, last]);
    }
  }
  return points.filter((_, i) => keep.has(i));
}

/** Paths use output pixels so a decimal place remains subpixel even for a
 * town-sized frame. The card maps them back with one group transform.
 * Polygon holes follow their exterior; dropping an exterior drops its holes. */
/** Whether a shape's own box touches the card (0..w × 0..h), with a small
 * margin so a road ending just outside still reaches the edge. */
function overlapsFrame(points: PixelPoint[], w: number, h: number): boolean {
  const m = 8;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return maxX >= -m && minX <= w + m && maxY >= -m && minY <= h + m;
}

function ringsToPath(
  rings: { x: number; y: number }[][],
  z: number,
  x: number,
  y: number,
  extent: number,
  frame: Frame,
  close: boolean,
  widthPx: number,
): string {
  const parts: string[] = [];
  let exteriorSign = 0;
  let keepExterior = false;
  for (const original of rings) {
    if (original.length < (close ? 3 : 2)) continue;
    let points: PixelPoint[] = original.map((p) => {
      const coord = tileLocalToLngLat(z, x, y, p.x, p.y, extent);
      const [px, py] = place(frame, coord);
      return [(px - frame.x) * widthPx / frame.w, (py - frame.y) * widthPx / frame.w];
    });
    // B2565: a tile covers more ground than the card; a shape wholly outside
    // the card's own frame is bytes nobody sees. Lines only here — a polygon's
    // holes follow its exterior, decided below.
    const inside = overlapsFrame(points, widthPx, (frame.h / frame.w) * widthPx);
    if (!close && !inside) continue;
    let isExterior = false;
    if (close) {
      const area = points.reduce((sum, p, i) => {
        const next = points[(i + 1) % points.length];
        return sum + p[0] * next[1] - next[0] * p[1];
      }, 0) / 2;
      if (!area) continue;
      if (!exteriorSign) exteriorSign = Math.sign(area);
      isExterior = Math.sign(area) === exteriorSign;
      if (isExterior) keepExterior = Math.abs(area) >= 2 && inside;
      if (!keepExterior || Math.abs(area) < 2) continue;
      const first = points[0];
      const last = points[points.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) points.push(first);
    }
    points = simplify(points, 0.6);
    const rounded: PixelPoint[] = [];
    for (const [x, y] of points) {
      const point: PixelPoint = [Number(x.toFixed(1)), Number(y.toFixed(1))];
      const last = rounded.at(-1);
      if (!last || point[0] !== last[0] || point[1] !== last[1]) rounded.push(point);
    }
    if (close) {
      if (rounded.length > 1 && rounded[0][0] === rounded.at(-1)![0] && rounded[0][1] === rounded.at(-1)![1]) rounded.pop();
      if (rounded.length < 3) {
        // A collapsed exterior must not leave its holes as filled islands.
        if (isExterior) keepExterior = false;
        continue;
      }
    } else {
      const length = rounded.reduce((sum, p, i) => i === 0 ? sum : sum + Math.hypot(p[0] - rounded[i - 1][0], p[1] - rounded[i - 1][1]), 0);
      if (length < 2) continue;
    }
    parts.push(`M${rounded.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join("L")}${close ? "Z" : ""}`);
  }
  return parts.join("");
}

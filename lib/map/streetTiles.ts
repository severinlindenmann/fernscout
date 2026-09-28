import "server-only";
import fs from "node:fs/promises";
import zlib from "node:zlib";
import { promisify } from "node:util";
import { PbfReader } from "pbf";
import { VectorTile } from "@mapbox/vector-tile";
import { PMTiles, type Source, type RangeResponse, Compression } from "pmtiles";
import { place, type Frame } from "../mapFrame";

const gunzip = promisify(zlib.gunzip);

/**
 * Reads a local PMTiles file with Node's own `fs`, the server-side
 * equivalent of the `pmtiles` package's own `FileSource` (which is written
 * against the browser's File API — see its own d.ts — and so cannot open a
 * path on disk). Only `getBytes`/`getKey` are ever called on a `Source`, so
 * this is the whole contract.
 */
class NodeFileSource implements Source {
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
async function nodeDecompress(buf: ArrayBuffer, compression: Compression): Promise<ArrayBuffer> {
  if (compression === Compression.None || compression === Compression.Unknown) return buf;
  if (compression !== Compression.Gzip) {
    throw new Error(`Unsupported PMTiles compression: ${compression}`);
  }
  const out = await gunzip(Buffer.from(buf));
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
}

/** One decoded layer, already projected into a `Frame`'s SVG units — ready
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
 * real minimum footprint (a tile-local bounding-box test, the same idea
 * `decimate` below applies to point count instead of shape count), if a
 * design review wants the tint back and has room in the "< 150 kB" budget
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
  const tilesWanted = (widthPx / 256) * (360 / Math.max(dLngDeg, 1e-6));
  const z = Math.round(Math.log2(Math.max(tilesWanted, 1)));
  return Math.min(maxZoom, Math.max(minZoom, z));
}

/**
 * Decodes the vector tiles covering `bbox` out of one PMTiles file, and
 * projects every feature straight into `frame`'s own SVG units via
 * `place()` — the same function every marker and line on this card uses, so
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
  let pmtiles: PMTiles;
  let header: Awaited<ReturnType<PMTiles["getHeader"]>>;
  try {
    pmtiles = new PMTiles(new NodeFileSource(file), undefined, nodeDecompress);
    header = await pmtiles.getHeader();
  } catch {
    return null;
  }

  const [west, south, east, north] = bbox;
  const z = chooseZoom(Math.max(east - west, 1e-6), widthPx, header.minZoom, header.maxZoom);
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

  for (const [x, y] of tiles) {
    let resp: RangeResponse | undefined;
    try {
      resp = await pmtiles.getZxy(z, x, y);
    } catch {
      continue;
    }
    if (!resp) continue;
    sawAny = true;
    let tile: VectorTile;
    try {
      tile = new VectorTile(new PbfReader(new Uint8Array(resp.data)));
    } catch {
      continue;
    }
    for (const name of LAYER_NAMES) {
      const layer = tile.layers[name];
      if (!layer) continue;
      const bucket = out[name];
      for (let i = 0; i < layer.length; i++) {
        const feature = layer.feature(i);
        const rings = feature.loadGeometry();
        const isPolygon = feature.type === 3;
        const isLine = feature.type === 2;
        if (!isPolygon && !isLine) continue;
        // README: "aim < 150 kB". `landuse` at z15 is mostly individual
        // building parcels — a handful of trip stops came to thousands of
        // them (measured: 5,729 for one region), the overwhelming majority
        // of every card's own weight — see `LAYER_NAMES`'s own note on why
        // this layer is not fetched at all today.
        const d = ringsToPath(rings, z, x, y, layer.extent, frame, isPolygon);
        if (d) bucket.push(d);
      }
    }
  }

  return sawAny ? out : null;
}

/** A ring longer than this is decimated to roughly this many points before
 * it is even reduced to a path — some rural highways at z15 carried 2,000+
 * vertices for a shape a 390px-wide card cannot show a tenth of. Uniform
 * striding (every Nth point, always keeping the first and last), not a real
 * simplification (nothing is moved and no shape-preserving algorithm runs),
 * but cheap and enough to hold the "< 150 kB" budget.
 * ponytail: a proper Douglas-Peucker pass would keep the shape's actual
 * corners rather than an arbitrary stride; upgrade if a real trip's road
 * still reads as visibly wrong after this. */
const MAX_RING_POINTS = 50;

function decimate<T>(points: readonly T[], max: number): T[] {
  if (points.length <= max) return [...points];
  const stride = Math.ceil(points.length / max);
  const out: T[] = [];
  for (let i = 0; i < points.length; i += stride) out.push(points[i]);
  const last = points[points.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

/** One feature's rings, each already reduced to an SVG subpath — polygons
 * closed with `Z` (drawn `fillRule="evenodd"` so a hole cancels its outer
 * ring regardless of winding order — B2534's own `photoJoinLines` doc notes
 * the same "never guess the topology" instinct), lines left open.
 *
 * Coordinates round to 1 decimal place (not `place()`'s own 4 — plenty of
 * precision left over a card rendered at a few hundred CSS pixels wide) and
 * a point that rounds to the same spot as the one before it is dropped —
 * both just string-length savings toward the same "< 150 kB" budget, on top
 * of `decimate`'s own stride.
 */
function ringsToPath(
  rings: { x: number; y: number }[][],
  z: number,
  x: number,
  y: number,
  extent: number,
  frame: Frame,
  close: boolean,
): string {
  const parts: string[] = [];
  for (const original of rings) {
    const ring = decimate(original, MAX_RING_POINTS);
    if (ring.length < (close ? 3 : 2)) continue;
    const seen: string[] = [];
    let last: string | null = null;
    for (const p of ring) {
      const { lat, lng } = tileLocalToLngLat(z, x, y, p.x, p.y, extent);
      const [px, py] = place(frame, { lat, lng });
      const rounded = `${px.toFixed(1)} ${py.toFixed(1)}`;
      if (rounded === last) continue;
      seen.push(rounded);
      last = rounded;
    }
    if (seen.length < (close ? 3 : 2)) continue;
    parts.push(`M${seen.join("L")}${close ? "Z" : ""}`);
  }
  return parts.join("");
}

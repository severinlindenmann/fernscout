/**
 * Named peaks, worldwide — B2212.
 *
 * Before this the route map's `mapTerrain` read `lib/mapdata/basemap.json.gz`'s
 * `peaks` array, which is Natural Earth's "geography regions elevation
 * points": a sparse, curated list of famous summits (Mont Blanc, Kilimanjaro,
 * a few hundred worldwide). It draws a real mountain near a route through the
 * Alps or the Rockies and nothing at all near a route through most of the
 * world — not because there is no mountain there, but because Natural Earth
 * never named one.
 *
 * This is the same fix `lib/ingest/geo.ts`'s `places.bin.gz` already made for
 * towns: GeoNames' feature classes `PK` (peak) and `MT` (mountain, ridge or
 * massif), with an elevation, packed the same way — latitude-sorted
 * fixed-size records, so a frame's box is a pair of binary searches rather
 * than a scan of 60,000-odd summits. `scripts/build-peaks.mjs` bakes the
 * file from GeoNames' `allCountries` dump (CC BY 4.0, the same licence
 * `places.bin.gz` is already built from and already credited for).
 *
 * Kept separate from `geo.ts` rather than added to it: a peak has no
 * population, no country and never answers "what would a person call this
 * spot", so it needs none of that file's country block or prominence
 * scoring — a smaller, simpler record for a different question ("what is
 * inside this box, tallest first").
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

/** File magic; the trailing NUL pads it to eight bytes. */
export const PEAK_MAGIC = "RPPEAK1\0";

/** int32 lat, int32 lng, uint16 metres, uint8 nameLen, uint32 nameOffset. */
export const PEAK_RECORD_SIZE = 15;

/** Where the packed index lives — resolved from this module, not the cwd. */
export function peaksDataFile(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "mapdata", "peaks.bin.gz");
}

type Index = {
  count: number;
  records: Buffer;
  names: Buffer;
  /** Latitudes in degrees, ascending — the binary search key. */
  lats: Float64Array;
};

let cached: Index | null | undefined;

/** `null` once, quietly, when the file has never been baked — B2212's data
 * is optional the way every baked layer here is: absent, not broken. */
function load(): Index | null {
  if (cached !== undefined) return cached;
  const file = peaksDataFile();
  if (!fs.existsSync(file)) {
    cached = null;
    return cached;
  }
  const buf = zlib.gunzipSync(fs.readFileSync(file));
  if (buf.subarray(0, PEAK_MAGIC.length).toString("latin1") !== PEAK_MAGIC) {
    throw new Error(`${file} is not a peak index (bad magic).`);
  }
  const count = buf.readUInt32BE(PEAK_MAGIC.length);
  const recordsAt = PEAK_MAGIC.length + 4;
  const records = buf.subarray(recordsAt, recordsAt + count * PEAK_RECORD_SIZE);
  const names = buf.subarray(recordsAt + count * PEAK_RECORD_SIZE);

  const lats = new Float64Array(count);
  for (let i = 0; i < count; i++) lats[i] = records.readInt32BE(i * PEAK_RECORD_SIZE) / 1e5;

  cached = { count, records, names, lats };
  return cached;
}

/** First index whose latitude is >= `lat` — the same binary search
 * `geo.ts`'s `placesInBox` uses, duplicated rather than shared because
 * sharing it would mean importing one packed-index module from the other for
 * four lines. */
function lowerBound(lats: Float64Array, lat: number): number {
  let lo = 0;
  let hi = lats.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (lats[mid] < lat) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** A peak the map may label: enough to draw it, and nothing more. */
export type BoxedPeak = { name: string; lat: number; lng: number; metres: number };

/**
 * The tallest peaks inside a bounding box — the same shape of question
 * `placesInBox` answers about towns, asked of GeoNames' mountains instead.
 *
 * `[]` when the file was never baked (`npm run build:peaks`), never a throw:
 * `mapTerrain` simply draws no peaks, the same "absent, not broken" every
 * optional layer here follows.
 */
export function peaksInBox(
  south: number,
  west: number,
  north: number,
  east: number,
  limit: number,
): BoxedPeak[] {
  const index = load();
  if (!index || index.count === 0) return [];

  const from = lowerBound(index.lats, south);
  const to = lowerBound(index.lats, north);
  const found: { at: number; metres: number }[] = [];

  for (let i = from; i < to; i++) {
    const at = i * PEAK_RECORD_SIZE;
    const lng = index.records.readInt32BE(at + 4) / 1e5;
    if (lng < west || lng > east) continue;
    found.push({ at, metres: index.records.readUInt16BE(at + 8) });
  }

  found.sort((a, b) => b.metres - a.metres);
  return found.slice(0, limit).map(({ at, metres }) => {
    const nameLen = index.records.readUInt8(at + 10);
    const nameOffset = index.records.readUInt32BE(at + 11);
    return {
      name: index.names.subarray(nameOffset, nameOffset + nameLen).toString("utf8"),
      lat: index.records.readInt32BE(at) / 1e5,
      lng: index.records.readInt32BE(at + 4) / 1e5,
      metres,
    };
  });
}

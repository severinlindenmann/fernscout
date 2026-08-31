/**
 * Offline reverse geocoding.
 *
 * A photo's GPS fix is a pair of numbers; an entry needs "Chiang Mai,
 * Thailand". Doing that over the network would mean the one moment you most
 * want to write up the day — evening, hostel, four bars of nothing — is the
 * moment the tool stops working. So the whole index ships with the repo:
 * every populated place over a thousand people, packed into fixed-size
 * records sorted by latitude. See scripts/build-geodata.ts for the format's
 * other half.
 *
 * The lookup is not "nearest place" but "nearest place a person would name".
 * Standing eight kilometres outside a city you say the city, not the hamlet
 * you happen to be closest to, so a place's population buys it a bounded head
 * start in kilometres.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

/** File magic; the trailing NULs pad it to eight bytes. */
export const MAGIC = "RPGEO1\0\0";

/** int32 lat, int32 lng, uint16 country, uint8 popScale, uint8 nameLen, uint32 nameOffset. */
export const RECORD_SIZE = 16;

/** Where the packed index lives — resolved from this module, not the cwd, so
 * it is found whether ingest runs from the repo root or anywhere else. */
export function dataFile(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "data", "places.bin.gz");
}

export type Place = {
  name: string;
  /** ISO 3166-1 alpha-2. */
  countryCode: string;
  country: string;
  lat: number;
  lng: number;
  /** Great-circle distance from the queried point. */
  distanceKm: number;
};

type Index = {
  count: number;
  records: Buffer;
  names: Buffer;
  countryCodes: string[];
  countryNames: string[];
  /** Latitudes in degrees, ascending — the binary search key. */
  lats: Float64Array;
};

let cached: Index | null = null;

export class MissingGeodataError extends Error {
  constructor(file: string) {
    super(
      `The offline place index is missing (${file}).\n` +
        `Build it once with: npm run build:geodata\n` +
        `Until then ingest still works — entries just get no location filled in.`,
    );
    this.name = "MissingGeodataError";
  }
}

export function geodataAvailable(): boolean {
  return fs.existsSync(dataFile());
}

function load(): Index {
  if (cached) return cached;
  const file = dataFile();
  if (!fs.existsSync(file)) throw new MissingGeodataError(file);

  const buf = zlib.gunzipSync(fs.readFileSync(file));
  if (buf.subarray(0, MAGIC.length).toString("latin1") !== MAGIC) {
    throw new Error(`${file} is not a place index (bad magic).`);
  }
  const count = buf.readUInt32BE(MAGIC.length);
  const countryCount = buf.readUInt32BE(MAGIC.length + 4);
  const countryBlockLength = buf.readUInt32BE(MAGIC.length + 8);

  let at = MAGIC.length + 12;
  const countryCodes: string[] = [];
  const countryNames: string[] = [];
  for (let i = 0; i < countryCount; i++) {
    const code = buf.subarray(at, at + 2).toString("latin1");
    const nameLen = buf.readUInt8(at + 2);
    countryCodes.push(code);
    countryNames.push(buf.subarray(at + 3, at + 3 + nameLen).toString("utf8"));
    at += 3 + nameLen;
  }

  const recordsAt = MAGIC.length + 12 + countryBlockLength;
  const records = buf.subarray(recordsAt, recordsAt + count * RECORD_SIZE);
  const names = buf.subarray(recordsAt + count * RECORD_SIZE);

  // Latitudes are pulled into a typed array once: the binary search touches
  // O(log n) of them and the final scan touches thousands, and reading them
  // back out of the record buffer each time is the whole cost of a lookup.
  const lats = new Float64Array(count);
  for (let i = 0; i < count; i++) lats[i] = records.readInt32BE(i * RECORD_SIZE) / 1e5;

  cached = { count, records, names, countryCodes, countryNames, lats };
  return cached;
}

const EARTH_RADIUS_KM = 6371;

/** Great-circle distance, with the antimeridian handled. */
export function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = Math.PI / 180;
  let dLng = bLng - aLng;
  if (dLng > 180) dLng -= 360;
  if (dLng < -180) dLng += 360;
  const dLat = (bLat - aLat) * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * toRad) * Math.cos(bLat * toRad) * Math.sin((dLng * toRad) / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** First index whose latitude is >= `lat`. */
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

/**
 * How many kilometres of head start a place's size is worth.
 *
 * Bounded on purpose: without a cap, Tokyo would claim photographs taken in
 * the next prefecture. Twenty kilometres is roughly "still recognisably the
 * outskirts", which is the judgement a person makes writing the caption.
 */
function prominenceKm(popScale: number): number {
  const population = 2 ** (popScale / 8) - 1;
  if (population < 1) return 0;
  return Math.min(20, 3 * Math.log10(population));
}

function readPlace(index: Index, i: number, lat: number, lng: number): Place {
  const at = i * RECORD_SIZE;
  const pLat = index.records.readInt32BE(at) / 1e5;
  const pLng = index.records.readInt32BE(at + 4) / 1e5;
  const country = index.records.readUInt16BE(at + 8);
  const nameLen = index.records.readUInt8(at + 11);
  const nameOffset = index.records.readUInt32BE(at + 12);
  return {
    name: index.names.subarray(nameOffset, nameOffset + nameLen).toString("utf8"),
    countryCode: index.countryCodes[country] ?? "",
    country: index.countryNames[country] ?? "",
    lat: pLat,
    lng: pLng,
    distanceKm: distanceKm(lat, lng, pLat, pLng),
  };
}

/** One degree of latitude, near enough for sizing a search band. */
const KM_PER_DEGREE = 111;

/**
 * The place a person would name for these coordinates, or null if the index
 * holds nothing within a thousand kilometres (mid-ocean, deep Antarctic).
 */
export function reverseGeocode(lat: number, lng: number): Place | null {
  const index = load();
  if (index.count === 0) return null;

  const scan = (bandDegrees: number, score: (i: number) => number) => {
    const from = lowerBound(index.lats, lat - bandDegrees);
    const to = lowerBound(index.lats, lat + bandDegrees);
    let best = -1;
    let bestScore = Infinity;
    for (let i = from; i < to; i++) {
      const s = score(i);
      if (s < bestScore) {
        bestScore = s;
        best = i;
      }
    }
    return { best, bestScore };
  };

  const plainDistance = (i: number) => {
    const at = i * RECORD_SIZE;
    return distanceKm(lat, lng, index.lats[i], index.records.readInt32BE(at + 4) / 1e5);
  };

  // Widen until something is in range. Most fixes resolve on the first band.
  let nearestKm = Infinity;
  for (const band of [0.5, 2, 9, 40]) {
    const { bestScore } = scan(band, plainDistance);
    if (Number.isFinite(bestScore)) {
      nearestKm = bestScore;
      break;
    }
  }
  if (!Number.isFinite(nearestKm) || nearestKm > 1000) return null;

  // Now re-scan wide enough to include every place that its size could carry
  // ahead of the nearest one, and let prominence decide.
  const band = Math.min(90, (nearestKm + 25) / KM_PER_DEGREE + 0.05);
  const { best } = scan(
    band,
    (i) => plainDistance(i) - prominenceKm(index.records.readUInt8(i * RECORD_SIZE + 10)),
  );
  return best < 0 ? null : readPlace(index, best, lat, lng);
}

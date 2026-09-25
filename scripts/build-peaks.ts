/**
 * Builds the worldwide peak index `mapTerrain` reads — B2212.
 *
 *   npm run build:peaks
 *   npm run build:peaks -- --from ./allCountries.txt
 *
 * The output — lib/mapdata/peaks.bin.gz — is committed for the same reason
 * `lib/ingest/data/places.bin.gz` is (see scripts/build-geodata.ts): a page
 * render must not depend on a network call, and this script exists to refresh
 * the file, not to run at request time.
 *
 * Source: GeoNames' `allCountries` dump (CC BY 4.0 — the same licence and the
 * same attribution `places.bin.gz` already carries), filtered to feature
 * class `T` ("mountain,hill,rock,...") codes `PK` (peak) and `MT` (mountains,
 * range). GeoNames ships no pre-filtered "peaks only" export the way it does
 * `cities1000.zip` for towns, so this downloads the full dump — 420-odd MB —
 * once, and keeps only the few tens of thousands of rows that are peaks.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import readline from "node:readline";
import { PEAK_MAGIC, PEAK_RECORD_SIZE, peaksDataFile } from "../lib/ingest/peaks.ts";

const ALL_COUNTRIES_URL = "https://download.geonames.org/export/dump/allCountries.zip";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/**
 * Same one-entry-zip inflate `build-geodata.ts` uses for `cities1000.zip` —
 * duplicated rather than imported, since that file is `.ts` under `lib/`
 * doc'd as ingest's own module and this is a one-off bake script the way it
 * is. Writes straight to a file rather than returning text: `allCountries`
 * inflates to 1.8 GB, well past the ~0x1fffffe8-character ceiling on a single
 * JS string (`ERR_STRING_TOO_LONG`), so nothing downstream may ever hold the
 * whole dump as one string — `parsePeaksFile` below reads it back a line at a
 * time instead.
 */
async function fetchZippedToFile(url: string, outPath: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  const zip = Buffer.from(await res.arrayBuffer());

  const sigAt = zip.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  if (sigAt !== 0) throw new Error("Unexpected zip layout: no local file header at offset 0.");
  const method = zip.readUInt16LE(8);
  const nameLength = zip.readUInt16LE(26);
  const extraLength = zip.readUInt16LE(28);
  const start = 30 + nameLength + extraLength;

  const eocdAt = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocdAt < 0) throw new Error("Unexpected zip layout: no end-of-central-directory record.");
  const centralAt = zip.readUInt32LE(eocdAt + 16);
  const compressedSize = zip.readUInt32LE(centralAt + 20);

  const body = zip.subarray(start, start + compressedSize);
  fs.writeFileSync(outPath, method === 0 ? body : zlib.inflateRawSync(body));
}

type Peak = { name: string; lat: number; lng: number; metres: number };

/** Streamed a line at a time — see `fetchZippedToFile`'s note on why the
 * file can never be read whole into one string. */
async function parsePeaksFile(filePath: string): Promise<Peak[]> {
  const out: Peak[] = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line) continue;
    const c = line.split("\t");
    if (c.length < 17) continue;
    // featureClass=T, featureCode PK ("peak, summit") or MT ("mountain,
    // hill, rock"). Some famous, named summits — Zugspitze among them — are
    // classed MT rather than PK in GeoNames, so PK alone silently drops
    // peaks a reader has heard of; but MT alone is 423,000 rows worldwide,
    // almost all unnamed-in-practice hills, and both together at every
    // elevation blew the packed file to 13 MB before gzip, well past the
    // ticket's 5 MB budget. The elevation floor below is what actually keeps
    // this small — see there.
    if (c[6] !== "T" || (c[7] !== "PK" && c[7] !== "MT")) continue;
    const lat = Number(c[4]);
    const lng = Number(c[5]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    // Column 15 is surveyed elevation, 16 is the SRTM-derived DEM — a peak
    // worth drawing has to be worth a name *and* a height, so a row with
    // neither is dropped rather than drawn as a nameless triangle at 0 m.
    // 1500 m and up: GeoNames carries no notion of "famous", so height is
    // the only available proxy, and this is the line that keeps Zugspitze
    // (2962 m) while cutting the flood of named-but-minor hills down to a
    // file this ticket's budget can hold.
    const metres = Number(c[15]) || Number(c[16]) || 0;
    if (metres < 1500) continue;
    const name = c[1].trim();
    if (!name || Buffer.byteLength(name, "utf8") > 255) continue;
    out.push({ name, lat, lng, metres: Math.min(65535, Math.round(metres)) });
  }
  return out;
}

function pack(peaks: Peak[]): Buffer {
  peaks.sort((a, b) => a.lat - b.lat);

  const nameChunks: Buffer[] = [];
  const records = Buffer.alloc(peaks.length * PEAK_RECORD_SIZE);
  let nameOffset = 0;

  peaks.forEach((peak, i) => {
    const name = Buffer.from(peak.name, "utf8");
    nameChunks.push(name);
    const at = i * PEAK_RECORD_SIZE;
    records.writeInt32BE(Math.round(peak.lat * 1e5), at);
    records.writeInt32BE(Math.round(peak.lng * 1e5), at + 4);
    records.writeUInt16BE(peak.metres, at + 8);
    records.writeUInt8(name.length, at + 10);
    records.writeUInt32BE(nameOffset, at + 11);
    nameOffset += name.length;
  });

  const nameBlob = Buffer.concat(nameChunks);
  const header = Buffer.alloc(PEAK_MAGIC.length + 4);
  header.write(PEAK_MAGIC, 0, "latin1");
  header.writeUInt32BE(peaks.length, PEAK_MAGIC.length);

  return Buffer.concat([header, records, nameBlob]);
}

const CACHE_DIR = path.join(import.meta.dirname, "..", ".mapdata-cache");
const from = arg("from");
let sourceFile = from;
if (!sourceFile) {
  console.log(`Downloading ${ALL_COUNTRIES_URL} (~420 MB)`);
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  sourceFile = path.join(CACHE_DIR, "allCountries.txt");
  await fetchZippedToFile(ALL_COUNTRIES_URL, sourceFile);
} else {
  console.log(`Reading ${sourceFile}`);
}

const peaks = await parsePeaksFile(sourceFile);
if (peaks.length < 1000) throw new Error(`Only ${peaks.length} peaks parsed — bad input?`);

// One name kept per coordinate pair — GeoNames carries both a `PK` point and
// an `MT` range for the same massif often enough (Mont Blanc has both) that
// the naive pack drew two triangles on top of each other.
const seen = new Set<string>();
const deduped = peaks.filter((p) => {
  const key = `${Math.round(p.lat * 200)},${Math.round(p.lng * 200)}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});

const packed = pack(deduped);
const gz = zlib.gzipSync(packed, { level: 9 });

const out = peaksDataFile();
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, gz);

console.log(
  `${deduped.length.toLocaleString("en")} peaks → ${path.relative(process.cwd(), out)} ` +
    `(${(packed.length / 1e6).toFixed(1)} MB packed, ${(gz.length / 1e6).toFixed(1)} MB gzipped)`,
);

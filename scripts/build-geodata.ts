/**
 * Builds the offline place index that ingest reverse-geocodes against.
 *
 *   npm run build:geodata            # download and rebuild
 *   npm run build:geodata -- --from ./cities1000.txt --countries ./countryInfo.txt
 *
 * The output — lib/ingest/data/places.bin.gz — is committed, because the whole
 * point of it is that `npm run ingest` never touches the network. You are on
 * hostel wifi; the geocoder has to already be on the disk. This script exists
 * to refresh it, not to run at install time.
 *
 * Source: GeoNames `cities1000` (every populated place over 1000 people) and
 * `countryInfo`, both CC BY 4.0. The raw dump is a 30 MB tab-separated file
 * with nineteen columns, of which five matter; packing it into fixed-size
 * records sorted by latitude gets that to roughly 2 MB compressed and makes
 * the lookup a binary search instead of a scan.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { MAGIC, RECORD_SIZE, dataFile } from "../lib/ingest/geo.ts";

const CITIES_URL = "https://download.geonames.org/export/dump/cities1000.zip";
const COUNTRIES_URL = "https://download.geonames.org/export/dump/countryInfo.txt";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.text();
}

/**
 * cities1000 ships as a zip holding exactly one deflated file. Rather than
 * take a zip dependency for that, find the single local file header and let
 * zlib inflate the raw stream — the sizes are in the central directory, which
 * for a one-entry archive is trivially located from the end.
 */
async function fetchCities(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  const zip = Buffer.from(await res.arrayBuffer());

  const sigAt = zip.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  if (sigAt !== 0) throw new Error("Unexpected zip layout: no local file header at offset 0.");
  const method = zip.readUInt16LE(8);
  const nameLength = zip.readUInt16LE(26);
  const extraLength = zip.readUInt16LE(28);
  const start = 30 + nameLength + extraLength;

  // The end-of-central-directory record carries the compressed size for
  // streamed entries, where the local header holds zeros.
  const eocdAt = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocdAt < 0) throw new Error("Unexpected zip layout: no end-of-central-directory record.");
  const centralAt = zip.readUInt32LE(eocdAt + 16);
  const compressedSize = zip.readUInt32LE(centralAt + 20);

  const body = zip.subarray(start, start + compressedSize);
  return (method === 0 ? body : zlib.inflateRawSync(body)).toString("utf8");
}

function parseCountries(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const cols = line.split("\t");
    if (cols.length < 5) continue;
    out.set(cols[0], cols[4]);
  }
  return out;
}

type City = { name: string; lat: number; lng: number; country: string; population: number };

function parseCities(text: string): City[] {
  const out: City[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    const c = line.split("\t");
    if (c.length < 15) continue;
    const lat = Number(c[4]);
    const lng = Number(c[5]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const name = c[1].trim();
    // The format stores name lengths in one byte; nothing real comes close,
    // but a corrupt row must not silently truncate into the next record.
    if (!name || Buffer.byteLength(name, "utf8") > 255) continue;
    out.push({
      name,
      lat,
      lng,
      country: c[8],
      population: Number(c[14]) || 0,
    });
  }
  return out;
}

function pack(cities: City[], countryNames: Map<string, string>): Buffer {
  // Latitude-sorted, so a lookup can binary-search into a band and scan only
  // the places that could possibly be nearest.
  cities.sort((a, b) => a.lat - b.lat);

  const codes = [...new Set(cities.map((c) => c.country))].sort();
  const codeIndex = new Map(codes.map((code, i) => [code, i]));

  const countryChunks: Buffer[] = [];
  for (const code of codes) {
    const name = Buffer.from(countryNames.get(code) ?? code, "utf8").subarray(0, 255);
    const head = Buffer.alloc(3);
    head.write(code.padEnd(2).slice(0, 2), 0, "latin1");
    head.writeUInt8(name.length, 2);
    countryChunks.push(head, name);
  }
  const countryBlock = Buffer.concat(countryChunks);

  const nameChunks: Buffer[] = [];
  const records = Buffer.alloc(cities.length * RECORD_SIZE);
  let nameOffset = 0;

  cities.forEach((city, i) => {
    const name = Buffer.from(city.name, "utf8");
    nameChunks.push(name);
    const at = i * RECORD_SIZE;
    records.writeInt32BE(Math.round(city.lat * 1e5), at);
    records.writeInt32BE(Math.round(city.lng * 1e5), at + 4);
    records.writeUInt16BE(codeIndex.get(city.country) ?? 0, at + 8);
    // Population on a log scale in one byte. Ranking is all it is used for —
    // "is this a city or a hamlet" — and that survives the loss of precision.
    records.writeUInt8(Math.min(255, Math.round(Math.log2(city.population + 1) * 8)), at + 10);
    records.writeUInt8(name.length, at + 11);
    records.writeUInt32BE(nameOffset, at + 12);
    nameOffset += name.length;
  });

  const nameBlob = Buffer.concat(nameChunks);
  const header = Buffer.alloc(MAGIC.length + 12);
  header.write(MAGIC, 0, "latin1");
  header.writeUInt32BE(cities.length, MAGIC.length);
  header.writeUInt32BE(codes.length, MAGIC.length + 4);
  header.writeUInt32BE(countryBlock.length, MAGIC.length + 8);

  return Buffer.concat([header, countryBlock, records, nameBlob]);
}

const citiesFrom = arg("from");
const countriesFrom = arg("countries");

console.log(citiesFrom ? `Reading ${citiesFrom}` : `Downloading ${CITIES_URL}`);
const citiesText = citiesFrom
  ? fs.readFileSync(citiesFrom, "utf8")
  : await fetchCities(CITIES_URL);

console.log(countriesFrom ? `Reading ${countriesFrom}` : `Downloading ${COUNTRIES_URL}`);
const countriesText = countriesFrom
  ? fs.readFileSync(countriesFrom, "utf8")
  : await fetchText(COUNTRIES_URL);

const cities = parseCities(citiesText);
const countries = parseCountries(countriesText);
if (cities.length < 10_000) throw new Error(`Only ${cities.length} places parsed — bad input?`);

const packed = pack(cities, countries);
const gz = zlib.gzipSync(packed, { level: 9 });

const out = dataFile();
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, gz);

console.log(
  `${cities.length.toLocaleString("en")} places, ${countries.size} countries → ` +
    `${path.relative(process.cwd(), out)} ` +
    `(${(packed.length / 1e6).toFixed(1)} MB packed, ${(gz.length / 1e6).toFixed(1)} MB gzipped)`,
);

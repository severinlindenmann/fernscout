/**
 * A different photograph every time you ask — B604.
 *
 * Three test files each had their own `jpeg()` painting one flat colour, which
 * made every fixture in them the same photograph at different sizes. That was
 * invisible until the upload path learned to notice a duplicate, at which
 * point a good deal of the suite was asserting that the same picture sent
 * twice is stored twice.
 *
 * Flat blocks on a coarse grid, because that is what a difference hash reads
 * (9×8) and what a JPEG re-encode leaves alone — a fine pattern would be
 * detail the encoder is free to throw away, and these fixtures have to survive
 * being re-encoded. The seed is mixed into every block rather than added to
 * all of them: a difference hash compares each block to its neighbour, so a
 * uniformly brighter picture is the *same* picture to it, by design.
 *
 * Measured over 45 seeds: the closest pair differs in 20 of 64 bits, well
 * clear of `DUPLICATE_THRESHOLD`, and a re-encode at quality 55 differs in
 * none.
 */
import sharp from "sharp";
import piexif from "piexifjs";
import zlib from "node:zlib";

let painted = 0;

/** Deterministic per (seed, block), and unrelated to its neighbours. */
function blockValue(seed: number, row: number, column: number): number {
  let mixed = (seed * 374761393 + row * 668265263 + column * 2246822519) >>> 0;
  mixed = ((mixed ^ (mixed >>> 13)) * 1274126177) >>> 0;
  return ((mixed ^ (mixed >>> 16)) % 200) + 20;
}

/**
 * One JPEG, unlike every other one this process has painted.
 *
 * Pass `seed` to paint the *same* picture twice on purpose — which is what a
 * duplicate test needs, and the reason it is not simply "call it again".
 */
export async function paintJpeg(width: number, height: number, seed?: number): Promise<Buffer> {
  const used = seed ?? (painted += 1);
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    const row = Math.floor((y * 8) / height);
    for (let x = 0; x < width; x++) {
      const column = Math.floor((x * 9) / width);
      const value = blockValue(used, row, column);
      const at = (y * width + x) * 3;
      pixels[at] = value;
      pixels[at + 1] = (value + 40) % 256;
      pixels[at + 2] = (value + 90) % 256;
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } }).jpeg().toBuffer();
}

/**
 * The same painted JPEG, with GPS and a capture time embedded as real EXIF —
 * for testing `photoMetaFromExif` (`lib/ingest/exif.ts`) against bytes that
 * actually carry the metadata, rather than a mock.
 */
export async function paintJpegWithExif(
  width: number,
  height: number,
  gps: { lat: number; lon: number; takenAt: string },
): Promise<Buffer> {
  const plain = await paintJpeg(width, height, 1);
  const dataUrl = `data:image/jpeg;base64,${plain.toString("base64")}`;
  const toDMS = (deg: number): [number, number][] => {
    const abs = Math.abs(deg);
    const d = Math.floor(abs);
    const m = Math.floor((abs - d) * 60);
    const s = ((abs - d) * 60 - m) * 60 * 100;
    return [[d, 1], [m, 1], [Math.round(s), 100]];
  };
  const exifObj = {
    GPS: {
      [piexif.GPSIFD.GPSLatitude]: toDMS(gps.lat),
      [piexif.GPSIFD.GPSLatitudeRef]: gps.lat >= 0 ? "N" : "S",
      [piexif.GPSIFD.GPSLongitude]: toDMS(gps.lon),
      [piexif.GPSIFD.GPSLongitudeRef]: gps.lon >= 0 ? "E" : "W",
    },
    Exif: {
      [piexif.ExifIFD.DateTimeOriginal]: gps.takenAt.slice(0, 19).replace("T", " ").replace(/-/g, ":"),
    },
  };
  const inserted = piexif.insert(piexif.dump(exifObj), dataUrl);
  return Buffer.from(inserted.split(",")[1], "base64");
}

/**
 * A PNG with a real IHDR chunk claiming `width`×`height`, and one nearly
 * empty IDAT behind it — not remotely enough compressed data for an image
 * this large, but well-formed enough that sharp reads the header rather than
 * bailing out on a corrupt one before it gets the chance to enforce a pixel
 * limit. This is exactly the asymmetry a pixel-bomb upload exploits: bytes in
 * the tens, gigabytes to decode if nothing stops it first — B1554, reused by
 * B2179 to prove the same refusal at the inbox door.
 */
export function craftedPng(width: number, height: number): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // colour type: truecolour
  const ihdr = chunk("IHDR", ihdrData);
  const idat = chunk("IDAT", zlib.deflateSync(Buffer.alloc(1)));
  const iend = chunk("IEND", Buffer.alloc(0));
  return Buffer.concat([signature, ihdr, idat, iend]);
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

// A minimal CRC-32, so the PNG's own chunk checksums are valid and sharp
// reads the header rather than bailing on a corrupt file before it gets the
// chance to enforce the pixel limit.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

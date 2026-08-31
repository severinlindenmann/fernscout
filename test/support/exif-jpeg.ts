/**
 * Builds JPEGs carrying exactly the EXIF a test wants.
 *
 * The alternative is committing a folder of camera files, which makes the
 * interesting values invisible: a test that says "these two were taken four
 * hours apart" should say so in the test, not in a binary. Two real files
 * (test/fixtures/ingest/) still pin the reader against what a real camera and
 * a real phone write; this writer covers the combinations.
 *
 * Big-endian ("MM") on purpose — most phones write little-endian, so the
 * generated fixtures exercise the other branch.
 */
import fs from "node:fs";
import sharp from "sharp";

type TiffEntry = { tag: number; type: number; count: number; value: Buffer };

const SHORT = 3;
const LONG = 4;
const RATIONAL = 5;
const ASCII = 2;

function ascii(text: string): TiffEntry["value"] {
  return Buffer.from(`${text}\0`, "latin1");
}

function rational(...pairs: [number, number][]): Buffer {
  const buf = Buffer.alloc(pairs.length * 8);
  pairs.forEach(([n, d], i) => {
    buf.writeUInt32BE(n, i * 8);
    buf.writeUInt32BE(d, i * 8 + 4);
  });
  return buf;
}

function short(value: number): Buffer {
  const buf = Buffer.alloc(2);
  buf.writeUInt16BE(value);
  return buf;
}

function long(value: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(value);
  return buf;
}

/** Degrees → the three rationals EXIF stores, at 1/10000 second precision. */
function dms(degrees: number): Buffer {
  const abs = Math.abs(degrees);
  const d = Math.floor(abs);
  const m = Math.floor((abs - d) * 60);
  const s = Math.round((abs - d - m / 60) * 3600 * 10000);
  return rational([d, 1], [m, 1], [s, 10000]);
}

function ifdSize(entries: TiffEntry[]): number {
  return 2 + entries.length * 12 + 4;
}

/** Serialises one IFD, spilling values longer than four bytes into `data`. */
function writeIfd(entries: TiffEntry[], dataOffset: number): { ifd: Buffer; data: Buffer } {
  const ifd = Buffer.alloc(ifdSize(entries));
  const spill: Buffer[] = [];
  let at = dataOffset;
  ifd.writeUInt16BE(entries.length, 0);
  entries.forEach((entry, i) => {
    const off = 2 + i * 12;
    ifd.writeUInt16BE(entry.tag, off);
    ifd.writeUInt16BE(entry.type, off + 2);
    ifd.writeUInt32BE(entry.count, off + 4);
    if (entry.value.length <= 4) {
      entry.value.copy(ifd, off + 8);
    } else {
      ifd.writeUInt32BE(at, off + 8);
      spill.push(entry.value);
      at += entry.value.length;
    }
  });
  return { ifd, data: Buffer.concat(spill) };
}

export type ExifFixture = {
  /** `2026:08:14 07:20:31` */
  takenAt?: string;
  lat?: number;
  lng?: number;
  orientation?: number;
};

/** The TIFF block that goes inside an APP1 segment. */
export function buildExifBlock(fixture: ExifFixture): Buffer {
  const hasGps = fixture.lat !== undefined && fixture.lng !== undefined;

  const exifEntries: TiffEntry[] = fixture.takenAt
    ? [{ tag: 0x9003, type: ASCII, count: fixture.takenAt.length + 1, value: ascii(fixture.takenAt) }]
    : [];

  const gpsEntries: TiffEntry[] = hasGps
    ? [
        { tag: 0x0001, type: ASCII, count: 2, value: ascii(fixture.lat! >= 0 ? "N" : "S") },
        { tag: 0x0002, type: RATIONAL, count: 3, value: dms(fixture.lat!) },
        { tag: 0x0003, type: ASCII, count: 2, value: ascii(fixture.lng! >= 0 ? "E" : "W") },
        { tag: 0x0004, type: RATIONAL, count: 3, value: dms(fixture.lng!) },
      ]
    : [];

  const ifd0Entries: TiffEntry[] = [
    { tag: 0x010f, type: ASCII, count: 5, value: ascii("Test") },
    { tag: 0x0112, type: SHORT, count: 1, value: short(fixture.orientation ?? 1) },
  ];

  // Offsets are relative to the TIFF header, and IFD0 has to point at the two
  // sub-IFDs, so the layout is sized before anything is serialised.
  const ifd0At = 8;
  const ifd0Count = ifd0Entries.length + (exifEntries.length ? 1 : 0) + (hasGps ? 1 : 0);
  const exifAt = ifd0At + 2 + ifd0Count * 12 + 4;
  const gpsAt = exifAt + (exifEntries.length ? ifdSize(exifEntries) : 0);
  const dataAt = gpsAt + (hasGps ? ifdSize(gpsEntries) : 0);

  if (exifEntries.length) {
    ifd0Entries.push({ tag: 0x8769, type: LONG, count: 1, value: long(exifAt) });
  }
  if (hasGps) {
    ifd0Entries.push({ tag: 0x8825, type: LONG, count: 1, value: long(gpsAt) });
  }

  const exif = writeIfd(exifEntries, dataAt);
  const gps = writeIfd(gpsEntries, dataAt + exif.data.length);
  const ifd0 = writeIfd(ifd0Entries, dataAt + exif.data.length + gps.data.length);

  const header = Buffer.alloc(8);
  header.write("MM", 0, "latin1");
  header.writeUInt16BE(0x002a, 2);
  header.writeUInt32BE(ifd0At, 4);

  return Buffer.concat([
    header,
    ifd0.ifd,
    exifEntries.length ? exif.ifd : Buffer.alloc(0),
    hasGps ? gps.ifd : Buffer.alloc(0),
    exif.data,
    gps.data,
    ifd0.data,
  ]);
}

/** Splices an APP1 EXIF segment into a JPEG, right after the SOI marker. */
export function withExif(jpeg: Buffer, fixture: ExifFixture): Buffer {
  const tiff = buildExifBlock(fixture);
  const payload = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const segment = Buffer.alloc(4);
  segment.writeUInt16BE(0xffe1, 0);
  segment.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([jpeg.subarray(0, 2), segment, payload, jpeg.subarray(2)]);
}

/**
 * A JPEG whose pixels depend on `seed`.
 *
 * Drawn as a coarse grid of blocks rather than a few small shapes, because the
 * difference hash only ever sees a 9×8 thumbnail: detail finer than that
 * averages away, and two "different" photos would come out as duplicates. The
 * grid is the same at any size, which is what makes a resized copy hash the
 * same as its original — exactly the property the dedupe tests are checking.
 */
export async function makeJpeg(seed: number, width = 160, height = 120): Promise<Buffer> {
  const columns = 5;
  const rows = 4;
  // A tiny linear congruential generator: same seed, same picture, every run.
  let state = (seed * 2654435761) % 4294967296;
  const random = () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };

  const cells: string[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      const level = Math.floor(random() * 256);
      cells.push(
        `<rect x="${(x * width) / columns}" y="${(y * height) / rows}" ` +
          `width="${width / columns}" height="${height / rows}" ` +
          `fill="rgb(${level},${(level * 3) % 256},${(level * 7) % 256})"/>`,
      );
    }
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    cells.join("") +
    `</svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer();
}

/** A photo file, EXIF and all, written to `file`. */
export async function writePhoto(
  file: string,
  seed: number,
  fixture: ExifFixture,
  size?: { width: number; height: number },
): Promise<Buffer> {
  const bytes = withExif(await makeJpeg(seed, size?.width, size?.height), fixture);
  fs.writeFileSync(file, bytes);
  return bytes;
}

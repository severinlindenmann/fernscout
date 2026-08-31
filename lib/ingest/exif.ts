/**
 * A small, dependency-free EXIF reader.
 *
 * Ingest needs four things out of a photo — when it was taken, where, which
 * way is up, and what took it. That is a narrow enough slice of EXIF that a
 * parser for it fits in one file, and the alternative (exifr, exif-parser,
 * exiftool-vendored) is either a large dependency or a 25 MB Perl binary for
 * four tags. JPEG APP1/TIFF is well-trodden and does not move.
 *
 * Three containers are understood, because those are the three a phone or a
 * camera actually hands you:
 *
 *   - JPEG — EXIF lives in an APP1 segment
 *   - HEIC/HEIF — EXIF lives in an `Exif` item inside the ISO-BMFF `meta` box
 *   - WebP — EXIF lives in an `EXIF` RIFF chunk
 *
 * All three end at the same place: a TIFF header followed by IFDs, which is
 * what `readTiff` walks.
 *
 * Everything here returns partial data rather than throwing. A photo with no
 * EXIF at all is normal (screenshots, WhatsApp forwards, scans) and must not
 * stop an import — the caller falls back to file mtime and to the location of
 * its neighbours.
 */

/** Wall-clock time as the camera recorded it — no zone, and that is correct.
 * A photo taken at 08:14 in Hanoi was taken at 08:14, whatever the phone
 * thought its offset was; the blog wants the local reading. */
export type ExifDateTime = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

export type ExifData = {
  /** DateTimeOriginal, falling back to DateTimeDigitized, then DateTime. */
  takenAt?: ExifDateTime;
  /** `+07:00` style offset, when the camera bothered to record one. */
  offset?: string;
  lat?: number;
  lng?: number;
  /** Metres above sea level, signed. */
  altitude?: number;
  /** TIFF orientation, 1–8. Absent means "assume 1". */
  orientation?: number;
  make?: string;
  model?: string;
  /** Milliseconds of exposure, only used to tell burst frames apart. */
  exposureTime?: number;
};

// ---------------------------------------------------------------------------
// TIFF / IFD walking
// ---------------------------------------------------------------------------

const TAG_MAKE = 0x010f;
const TAG_MODEL = 0x0110;
const TAG_ORIENTATION = 0x0112;
const TAG_DATETIME = 0x0132;
const TAG_EXIF_IFD = 0x8769;
const TAG_GPS_IFD = 0x8825;
const TAG_EXPOSURE_TIME = 0x829a;
const TAG_DATETIME_ORIGINAL = 0x9003;
const TAG_DATETIME_DIGITIZED = 0x9004;
const TAG_OFFSET_TIME_ORIGINAL = 0x9011;

const GPS_LAT_REF = 0x0001;
const GPS_LAT = 0x0002;
const GPS_LNG_REF = 0x0003;
const GPS_LNG = 0x0004;
const GPS_ALT_REF = 0x0005;
const GPS_ALT = 0x0006;

/** Bytes per TIFF component, indexed by type. 0 marks a type we skip. */
const TYPE_SIZE = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8];

type Reader = {
  view: DataView;
  /** Where the TIFF header starts; every IFD offset is relative to it. */
  base: number;
  little: boolean;
};

function u16(r: Reader, at: number): number {
  return r.view.getUint16(at, r.little);
}

function u32(r: Reader, at: number): number {
  return r.view.getUint32(at, r.little);
}

type IfdEntry = { tag: number; type: number; count: number; valueAt: number };

/** Reads one IFD's entries, or an empty list if it points outside the buffer. */
function readIfd(r: Reader, offset: number): IfdEntry[] {
  const at = r.base + offset;
  if (at < 0 || at + 2 > r.view.byteLength) return [];
  const count = u16(r, at);
  const out: IfdEntry[] = [];
  for (let i = 0; i < count; i++) {
    const entry = at + 2 + i * 12;
    if (entry + 12 > r.view.byteLength) break;
    const type = u16(r, entry + 2);
    const n = u32(r, entry + 4);
    const size = (TYPE_SIZE[type] ?? 0) * n;
    if (size === 0) continue;
    // Values of four bytes or fewer are stored inline in the entry itself.
    const valueAt = size <= 4 ? entry + 8 : r.base + u32(r, entry + 8);
    if (valueAt < 0 || valueAt + size > r.view.byteLength) continue;
    out.push({ tag: u16(r, entry), type, count: n, valueAt });
  }
  return out;
}

function readNumbers(r: Reader, e: IfdEntry): number[] {
  const out: number[] = [];
  for (let i = 0; i < e.count; i++) {
    switch (e.type) {
      case 1:
        out.push(r.view.getUint8(e.valueAt + i));
        break;
      case 3:
        out.push(u16(r, e.valueAt + i * 2));
        break;
      case 4:
        out.push(u32(r, e.valueAt + i * 4));
        break;
      case 5: {
        const num = u32(r, e.valueAt + i * 8);
        const den = u32(r, e.valueAt + i * 8 + 4);
        out.push(den === 0 ? 0 : num / den);
        break;
      }
      case 9:
        out.push(r.view.getInt32(e.valueAt + i * 4, r.little));
        break;
      case 10: {
        const num = r.view.getInt32(e.valueAt + i * 8, r.little);
        const den = r.view.getInt32(e.valueAt + i * 8 + 4, r.little);
        out.push(den === 0 ? 0 : num / den);
        break;
      }
      default:
        return out;
    }
  }
  return out;
}

function readAscii(r: Reader, e: IfdEntry): string {
  const bytes = new Uint8Array(r.view.buffer, r.view.byteOffset + e.valueAt, e.count);
  let text = "";
  for (const b of bytes) {
    if (b === 0) break;
    text += String.fromCharCode(b);
  }
  return text.trim();
}

/** `2026:08:14 07:20:31` — EXIF's own format, colons and all. */
function parseExifDate(text: string): ExifDateTime | undefined {
  const m = /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(text);
  if (!m) return undefined;
  const [, y, mo, d, h, mi, s] = m;
  const date = {
    year: Number(y),
    month: Number(mo),
    day: Number(d),
    hour: Number(h),
    minute: Number(mi),
    second: Number(s),
  };
  // Cameras with a dead clock battery write 0000:00:00, which is worse than
  // nothing: it would sort every such photo to the start of the trip.
  if (date.year < 1900 || date.month < 1 || date.month > 12 || date.day < 1) return undefined;
  return date;
}

/** Degrees/minutes/seconds triple + N/S/E/W reference → signed degrees. */
function dmsToDegrees(dms: number[], ref: string): number | undefined {
  if (dms.length < 2) return undefined;
  const [deg, min = 0, sec = 0] = dms;
  const value = deg + min / 60 + sec / 3600;
  if (!Number.isFinite(value)) return undefined;
  const negative = ref === "S" || ref === "W";
  return negative ? -value : value;
}

/** Walks a TIFF header at `base` and pulls out the tags ingest cares about. */
function readTiff(bytes: Uint8Array, base: number): ExifData {
  const out: ExifData = {};
  if (base + 8 > bytes.length) return out;

  const byteOrder = (bytes[base] << 8) | bytes[base + 1];
  if (byteOrder !== 0x4949 && byteOrder !== 0x4d4d) return out;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const r: Reader = { view, base, little: byteOrder === 0x4949 };
  if (u16(r, base + 2) !== 0x002a) return out;

  let dateTime: ExifDateTime | undefined;
  let dateTimeDigitized: ExifDateTime | undefined;

  const ifd0 = readIfd(r, u32(r, base + 4));
  let exifOffset = 0;
  let gpsOffset = 0;

  for (const e of ifd0) {
    switch (e.tag) {
      case TAG_MAKE:
        out.make = readAscii(r, e) || undefined;
        break;
      case TAG_MODEL:
        out.model = readAscii(r, e) || undefined;
        break;
      case TAG_ORIENTATION: {
        const [v] = readNumbers(r, e);
        if (v >= 1 && v <= 8) out.orientation = v;
        break;
      }
      case TAG_DATETIME:
        dateTime = parseExifDate(readAscii(r, e));
        break;
      case TAG_EXIF_IFD:
        exifOffset = readNumbers(r, e)[0] ?? 0;
        break;
      case TAG_GPS_IFD:
        gpsOffset = readNumbers(r, e)[0] ?? 0;
        break;
    }
  }

  if (exifOffset > 0) {
    for (const e of readIfd(r, exifOffset)) {
      switch (e.tag) {
        case TAG_DATETIME_ORIGINAL:
          out.takenAt = parseExifDate(readAscii(r, e));
          break;
        case TAG_DATETIME_DIGITIZED:
          dateTimeDigitized = parseExifDate(readAscii(r, e));
          break;
        case TAG_OFFSET_TIME_ORIGINAL: {
          const text = readAscii(r, e);
          if (/^[+-]\d{2}:\d{2}$/.test(text)) out.offset = text;
          break;
        }
        case TAG_EXPOSURE_TIME: {
          const [v] = readNumbers(r, e);
          if (Number.isFinite(v)) out.exposureTime = v * 1000;
          break;
        }
      }
    }
  }

  out.takenAt ??= dateTimeDigitized ?? dateTime;

  if (gpsOffset > 0) {
    let latRef = "";
    let lngRef = "";
    let lat: number[] = [];
    let lng: number[] = [];
    let altRef = 0;
    let alt: number | undefined;
    for (const e of readIfd(r, gpsOffset)) {
      switch (e.tag) {
        case GPS_LAT_REF:
          latRef = readAscii(r, e).toUpperCase();
          break;
        case GPS_LAT:
          lat = readNumbers(r, e);
          break;
        case GPS_LNG_REF:
          lngRef = readAscii(r, e).toUpperCase();
          break;
        case GPS_LNG:
          lng = readNumbers(r, e);
          break;
        case GPS_ALT_REF:
          altRef = readNumbers(r, e)[0] ?? 0;
          break;
        case GPS_ALT:
          alt = readNumbers(r, e)[0];
          break;
      }
    }
    const latDeg = dmsToDegrees(lat, latRef);
    const lngDeg = dmsToDegrees(lng, lngRef);
    // 0,0 is in the Gulf of Guinea. A camera that writes it means "no fix",
    // and importing it would drop a pin in the ocean on the trip map.
    if (
      latDeg !== undefined &&
      lngDeg !== undefined &&
      Math.abs(latDeg) <= 90 &&
      Math.abs(lngDeg) <= 180 &&
      !(latDeg === 0 && lngDeg === 0)
    ) {
      out.lat = latDeg;
      out.lng = lngDeg;
    }
    // GPSAltitudeRef 1 means "below sea level" — the value itself is unsigned.
    if (alt !== undefined && Number.isFinite(alt)) out.altitude = altRef === 1 ? -alt : alt;
  }

  return out;
}

// ---------------------------------------------------------------------------
// Containers
// ---------------------------------------------------------------------------

const EXIF_MARKER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"

function startsWith(bytes: Uint8Array, at: number, pattern: number[]): boolean {
  for (let i = 0; i < pattern.length; i++) if (bytes[at + i] !== pattern[i]) return false;
  return true;
}

/** Finds the APP1 segment holding EXIF and returns its TIFF header offset. */
function jpegTiffOffset(bytes: Uint8Array): number {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return -1;
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = bytes[i + 1];
    // Start of scan: image data from here on, no more metadata segments.
    if (marker === 0xda || marker === 0xd9) return -1;
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2;
      continue;
    }
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (length < 2) return -1;
    if (marker === 0xe1 && startsWith(bytes, i + 4, EXIF_MARKER)) return i + 4 + 6;
    i += 2 + length;
  }
  return -1;
}

/** RIFF/WebP: chunks of `fourcc + uint32 size + payload`, padded to even. */
function webpTiffOffset(bytes: Uint8Array): number {
  const fourcc = (at: number) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
  if (bytes.length < 16 || fourcc(0) !== "RIFF" || fourcc(8) !== "WEBP") return -1;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let i = 12;
  while (i + 8 <= bytes.length) {
    const size = view.getUint32(i + 4, true);
    if (fourcc(i) === "EXIF") {
      // Some encoders prefix the payload with the "Exif\0\0" marker, some
      // start straight at the TIFF header.
      return startsWith(bytes, i + 8, EXIF_MARKER) ? i + 14 : i + 8;
    }
    i += 8 + size + (size % 2);
  }
  return -1;
}

/**
 * HEIC/HEIF: an ISO base media file. EXIF is an item in the `meta` box,
 * declared by `iinf` and located by `iloc`.
 *
 * Only the small subset needed to find one item is implemented, and every
 * malformed length bails out rather than looping — these files arrive
 * straight off a phone and occasionally truncated.
 */
function heifTiffOffset(bytes: Uint8Array): number {
  if (bytes.length < 12) return -1;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fourcc = (at: number) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
  if (fourcc(4) !== "ftyp") return -1;

  // Top-level scan for `meta`.
  let metaAt = -1;
  let metaEnd = -1;
  let i = 0;
  while (i + 8 <= bytes.length) {
    const size = view.getUint32(i);
    if (size < 8) break;
    if (fourcc(i + 4) === "meta") {
      metaAt = i + 12; // 8 byte header + 4 byte version/flags (meta is a FullBox)
      metaEnd = Math.min(bytes.length, i + size);
      break;
    }
    i += size;
  }
  if (metaAt < 0) return -1;

  let exifItemId = -1;
  let ilocAt = -1;
  let ilocEnd = -1;

  let j = metaAt;
  while (j + 8 <= metaEnd) {
    const size = view.getUint32(j);
    if (size < 8) break;
    const type = fourcc(j + 4);
    const end = Math.min(metaEnd, j + size);
    if (type === "iinf") {
      const version = bytes[j + 8];
      let k = version === 0 ? j + 14 : j + 16; // entry count is 16-bit in v0, 32-bit later
      while (k + 8 <= end) {
        const infeSize = view.getUint32(k);
        if (infeSize < 8) break;
        if (fourcc(k + 4) === "infe") {
          const infeVersion = bytes[k + 8];
          // v2 puts item_ID (16-bit) then protection then item_type; v3 uses
          // a 32-bit item_ID. Earlier versions predate item types entirely.
          if (infeVersion >= 2) {
            const idSize = infeVersion === 2 ? 2 : 4;
            const idAt = k + 12;
            const typeAt = idAt + idSize + 2;
            if (typeAt + 4 <= end && fourcc(typeAt) === "Exif") {
              exifItemId = infeVersion === 2 ? view.getUint16(idAt) : view.getUint32(idAt);
            }
          }
        }
        k += infeSize;
      }
    } else if (type === "iloc") {
      ilocAt = j;
      ilocEnd = end;
    }
    j += size;
  }
  if (exifItemId < 0 || ilocAt < 0) return -1;

  // iloc: packed nibble sizes, then one entry per item.
  const version = bytes[ilocAt + 8];
  let p = ilocAt + 12;
  const offsetSize = bytes[p] >> 4;
  const lengthSize = bytes[p] & 0x0f;
  const baseOffsetSize = bytes[p + 1] >> 4;
  const indexSize = version >= 1 ? bytes[p + 1] & 0x0f : 0;
  p += 2;
  const itemCount = version < 2 ? view.getUint16(p) : view.getUint32(p);
  p += version < 2 ? 2 : 4;

  const readSized = (at: number, size: number): number => {
    if (size === 4) return view.getUint32(at);
    if (size === 8) return Number(view.getBigUint64(at));
    if (size === 2) return view.getUint16(at);
    if (size === 1) return bytes[at];
    return 0;
  };

  for (let n = 0; n < itemCount && p < ilocEnd; n++) {
    const itemId = version < 2 ? view.getUint16(p) : view.getUint32(p);
    p += version < 2 ? 2 : 4;
    if (version >= 1) p += 2; // construction_method
    p += 2; // data_reference_index
    const baseOffset = readSized(p, baseOffsetSize);
    p += baseOffsetSize;
    const extentCount = view.getUint16(p);
    p += 2;
    let found = -1;
    for (let e = 0; e < extentCount; e++) {
      p += indexSize;
      const extentOffset = readSized(p, offsetSize);
      p += offsetSize;
      p += lengthSize;
      if (itemId === exifItemId && e === 0) found = baseOffset + extentOffset;
    }
    if (found >= 0) {
      // The Exif item payload starts with a 4-byte offset to the TIFF header
      // (almost always 6, skipping "Exif\0\0").
      if (found + 4 > bytes.length) return -1;
      return found + 4 + view.getUint32(found);
    }
  }
  return -1;
}

/** Reads whatever EXIF the bytes carry. Never throws. */
export function readExif(bytes: Uint8Array): ExifData {
  try {
    for (const offsetOf of [jpegTiffOffset, heifTiffOffset, webpTiffOffset]) {
      const at = offsetOf(bytes);
      if (at >= 0) return readTiff(bytes, at);
    }
  } catch {
    // A truncated or hostile file is a photo we import without metadata, not
    // an import that fails.
  }
  return {};
}

/** `2026-08-14` — the date frontmatter wants. */
export function isoDate(d: ExifDateTime): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.year}-${pad(d.month)}-${pad(d.day)}`;
}

/** `07:20` — the time frontmatter wants. */
export function isoTime(d: ExifDateTime): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.hour)}:${pad(d.minute)}`;
}

/**
 * A sortable number for a wall-clock time.
 *
 * Deliberately built as if the reading were UTC: two photos taken an hour
 * apart in the same place are an hour apart here, which is all clustering
 * needs, and it avoids pretending we know the traveller's zone.
 */
export function wallClockMs(d: ExifDateTime): number {
  return Date.UTC(d.year, d.month - 1, d.day, d.hour, d.minute, d.second);
}

/** The inverse, for turning a file's mtime into the same kind of reading. */
export function fromDate(date: Date): ExifDateTime {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
    second: date.getSeconds(),
  };
}

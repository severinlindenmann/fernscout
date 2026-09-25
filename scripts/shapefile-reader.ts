/**
 * A minimal, read-only ESRI Shapefile (.shp) + attribute table (.dbf) reader
 * — B2222. No dependency exists in this repository for the binary shapefile
 * format (the Natural Earth pipeline in `build-mapdata.mjs` reads GitHub's
 * own GeoJSON mirror instead), and `AGENTS.md` asks for no new one for what
 * a few hundred lines can do — the format itself is a fixed 100-byte header
 * followed by fixed-format records, documented by Esri's own "ESRI
 * Shapefile Technical Description" (whitepaper.pdf, 1998), unchanged since.
 *
 * Only what `build-hydro.ts` needs: shape type 3 (PolyLine) and 5 (Polygon),
 * no Z or M values — which is what HydroRIVERS_v10 and HydroLAKES_v10 ship,
 * confirmed by reading each file's own header before the scan begins. Any
 * other shape type throws rather than silently mis-reading.
 *
 * Both readers are generators reading straight off a file descriptor rather
 * than `fs.readFileSync` into one buffer and an array of parsed records —
 * HydroRIVERS alone is a 1.2 GB `.shp` and an 870 MB `.dbf` for 8.5 million
 * reaches. `build-hydro.ts` keeps almost none of them (a Strahler-order
 * filter), so paying to materialise every one first, as JS objects with
 * their own per-point arrays, risked exhausting the heap for rows the very
 * next line would throw away. A generator lets the caller filter row by row
 * and keep only what it decided to.
 *
 * ponytail: two shape types, no Z/M, one record at a time, synchronous reads
 * — not a general shapefile library. Extend if a future bake needs points or
 * measured geometry.
 */
import fs from "node:fs";

export type ShpRecord = { parts: [number, number][][] };

/** Reads a `length`-byte chunk at `offset` from an open file descriptor. */
function readAt(fd: number, offset: number, length: number): Buffer {
  const buf = Buffer.allocUnsafe(length);
  fs.readSync(fd, buf, 0, length, offset);
  return buf;
}

/**
 * Yields every record's geometry from a `.shp` file, in file order — the
 * order shapefile bundles guarantee matches the sibling `.dbf`'s rows.
 */
export function* readShp(file: string): Generator<ShpRecord> {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const header = readAt(fd, 0, 100);
    const shapeType = header.readInt32LE(32);
    if (shapeType !== 3 && shapeType !== 5) {
      throw new Error(`${file}: unsupported shape type ${shapeType} (expected 3 PolyLine or 5 Polygon)`);
    }
    let offset = 100;
    while (offset < size) {
      // Record header: record number (unused), content length in 16-bit words.
      const recHeader = readAt(fd, offset, 8);
      const contentLenWords = recHeader.readInt32BE(4);
      const contentStart = offset + 8;
      const contentLen = contentLenWords * 2;
      const content = readAt(fd, contentStart, contentLen);
      const recShapeType = content.readInt32LE(0);
      offset = contentStart + contentLen;
      if (recShapeType === 0) {
        // Null shape — no geometry, still one slot, so .dbf row alignment holds.
        yield { parts: [] };
        continue;
      }
      if (recShapeType !== shapeType) {
        throw new Error(`${file}: record shape type ${recShapeType} does not match file type ${shapeType}`);
      }
      // Skip the record's own bounding box (4 doubles = 32 bytes).
      let p = 4 + 32;
      const numParts = content.readInt32LE(p);
      p += 4;
      const numPoints = content.readInt32LE(p);
      p += 4;
      const partStarts: number[] = [];
      for (let i = 0; i < numParts; i++) {
        partStarts.push(content.readInt32LE(p));
        p += 4;
      }
      const points: [number, number][] = [];
      for (let i = 0; i < numPoints; i++) {
        const x = content.readDoubleLE(p);
        const y = content.readDoubleLE(p + 8);
        points.push([x, y]);
        p += 16;
      }
      const parts: [number, number][][] = partStarts.map((start, i) => {
        const end = i + 1 < partStarts.length ? partStarts[i + 1] : numPoints;
        return points.slice(start, end);
      });
      yield { parts };
    }
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Yields a `.dbf` attribute table one row at a time, field names exactly as
 * the file declares them (HydroRIVERS/HydroLAKES use upper/mixed-case
 * column names like `ORD_STRA`, `Lake_area`).
 *
 * Only the field types these two files actually use: `N`/`F` (numeric,
 * parsed as a JS number) and everything else read as a trimmed string —
 * unused by this bake, kept simple rather than kept exhaustive.
 */
export function* readDbf(file: string): Generator<Record<string, string | number>> {
  const fd = fs.openSync(file, "r");
  try {
    const header = readAt(fd, 0, 32);
    const numRecords = header.readInt32LE(4);
    const headerSize = header.readInt16LE(8);
    const recordSize = header.readInt16LE(10);

    const descriptors = readAt(fd, 32, headerSize - 32);
    type Field = { name: string; type: string; length: number };
    const fields: Field[] = [];
    let dp = 0;
    while (descriptors[dp] !== 0x0d) {
      const name = descriptors.toString("ascii", dp, dp + 11).replace(/\0.*$/, "");
      const type = String.fromCharCode(descriptors[dp + 11]);
      const length = descriptors[dp + 16];
      fields.push({ name, type, length });
      dp += 32;
    }

    for (let r = 0; r < numRecords; r++) {
      const record = readAt(fd, headerSize + r * recordSize, recordSize);
      // First byte of each record is the deletion flag (' ' valid, '*' deleted).
      let fp = 1;
      const row: Record<string, string | number> = {};
      for (const field of fields) {
        const raw = record.toString("ascii", fp, fp + field.length).trim();
        row[field.name] = field.type === "N" || field.type === "F" ? Number(raw) : raw;
        fp += field.length;
      }
      yield row;
    }
  } finally {
    fs.closeSync(fd);
  }
}

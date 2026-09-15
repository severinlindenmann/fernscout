import path from "node:path";
import { isoDate, isoTime, readExif } from "@/lib/ingest/exif";
import { VIDEO_EXTENSIONS } from "@/lib/ingest/video";
import type { PhotoRow } from "@/lib/staging/manifest";

/**
 * What one staged file knows about itself.
 *
 * **Nothing is filled in.** A file with no EXIF gets no date, and in
 * particular does *not* fall back to its own mtime the way `lib/ingest`'s
 * folder import does (`lib/ingest/index.ts:230`). That fallback is correct for
 * a camera card and wrong here: B1750 measured that a phone stamps every
 * uploaded file with the moment of the upload, so mtime would silently date a
 * 2019 trip to the day it was imported. Which day an undated photograph
 * belongs to is a question for the person, asked once, in the flow.
 *
 * A video is staged and counted but read for nothing. `readExif` handles JPEG,
 * HEIC and WebP; a clip's own coordinates live in QuickTime atoms nothing
 * reads yet (B1755). Marked as a video so the flow can say so, rather than
 * showing it as a photograph that mysteriously knows nothing.
 */
export function analyseStaged(
  row: Pick<PhotoRow, "id" | "filename" | "bytes">,
  bytes: Buffer,
): PhotoRow {
  const ext = path.extname(row.filename).toLowerCase();
  if (VIDEO_EXTENSIONS.has(ext)) return { ...row, kind: "video" };

  const exif = readExif(new Uint8Array(bytes));
  return {
    ...row,
    kind: "image",
    takenAt: exif.takenAt ? `${isoDate(exif.takenAt)}T${isoTime(exif.takenAt)}` : undefined,
    date: exif.takenAt ? isoDate(exif.takenAt) : undefined,
    offset: exif.offset,
    lat: exif.lat,
    lng: exif.lng,
    make: exif.make,
    model: exif.model,
  };
}

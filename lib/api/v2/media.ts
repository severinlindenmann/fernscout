// The v2 media door's own domain function — B1613, phase 2 step 3, parcel C.
//
// One upload for every kind of bytes: what v1 split across
// /trips/{trip}/media, /inbox and (for a bank statement) /import. This file
// never touches a request or a response — that is app/api/v2/[user]/media/
// route.ts's job — and it never imports anything under lib/api/ outside its
// own v2 folder (test/api-v2-imports.test.ts enforces the boundary).
//
// Storage, in one sentence: a photograph with a trip lives inside that
// trip's own media/ (and, alongside it, originals/) directory, addressed by
// a hash of its bytes rather than a position in a batch (decision 7); a
// photograph with no trip, and every bank_export/gps_history/document, lands
// in the flat, journal-wide inbox lib/inbox.ts already owns — the same
// bucket v1's own inbox door filled, reached here through the media door's
// own decline path instead of a second upload verb (docs/plans/
// 2026-09-12-api-v2/content.md, s11).
import "server-only";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { decodeSource, makeDerivative, MAX_DECODE_PIXELS } from "../../ingest/image";
import { frontmatterSrc } from "../../ingest/paths";
import { contentHash } from "../../ingest/hash";
import {
  FFMPEG_MISSING_MESSAGE,
  VIDEO_EXTENSIONS,
  transcodeVideo,
  videoToolsAvailable,
} from "../../ingest/video";
import { loadUserConfig } from "../../config";
import { getTrip, tripRef } from "../../trips";
import { mediaUrl, resolveMediaFile, tripMediaDir, tripOriginalsDir } from "../../media";
import { withStorageQuota } from "../../storageQuota";
import { findInboxFile, removeInboxFile, storeInboxFile } from "../../inbox";
import { validateMediaBatch, type Problem } from "../../validate/media";
import { mediaKey } from "../../photos";
import type { MediaIntent } from "./schemas/media";

type MediaKind = MediaIntent["kind"];

/** What a stored item answers with — `mediaItem` in ./schemas/media.ts, minus
 * the zod wrapper. `trip`/`day`/`caption`/`url`/`duplicateOf` are each
 * present only when they apply, matching that schema's own optionality. */
type MediaItemOut = {
  src: string;
  kind: MediaKind;
  trip?: string;
  day?: string;
  caption?: string;
  bytes: number;
  url?: string;
  duplicateOf?: string;
};

export type MediaWriteResult =
  | { ok: true; item: MediaItemOut }
  | { ok: false; error: "invalid_media"; problems: Problem[] }
  | { ok: false; error: "unknown_trip" }
  | { ok: false; error: "storage_full"; problem: string };

export type MediaUpload = { filename: string; bytes: Buffer };

function isVideoFilename(filename: string): boolean {
  return VIDEO_EXTENSIONS.has(path.extname(filename).toLowerCase());
}

/** A day slug good enough to be a directory name — the same shape a trip id
 * or a username already has to be, and for the same reason (AGENTS.md: a
 * name that becomes a path is a security boundary). Unlike v1's
 * `storeUploads`, this never checks that a day of this slug actually exists:
 * v2 days are their own JSON documents, written through a different door
 * (B1613's sibling ticket), and this one only ever decides *where on disk*
 * the bytes go — a day references a photograph by `src` afterwards, and that
 * reference is the day route's business, not this one's. */
const DAY_SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

function safeDaySlug(day: string): string | null {
  return DAY_SLUG_RE.test(day) ? day : null;
}

type MediaSidecar = {
  kind: "photo";
  trip: string;
  day?: string;
  caption?: string;
  filename: string;
  uploadedAt: string;
};

function readSidecar(file: string): MediaSidecar | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as MediaSidecar;
  } catch {
    return null;
  }
}

/**
 * One photograph or clip, stored inside a trip and addressed by its own
 * bytes — the genuinely new part of this ticket (decision 7).
 *
 * `day` absent is T2's day-less trip-scoped write: the file lands directly
 * under the trip's `media/` root rather than a day subfolder, and nothing
 * here refuses that or invents a third storage tree for it.
 *
 * The address is deterministic — `<sha256 of the uploaded bytes>.<ext>`, in
 * whichever directory the intent named — so a second upload of the same
 * bytes to the same place resolves to the same path before any decoding is
 * even attempted: the existence check below is the whole duplicate story,
 * and it costs nothing beyond one `hash` and one `fs.existsSync`.
 *
 * v1's `storeUploads` (lib/api/media.ts) additionally kept a perceptual hash
 * per day to flag photographs that merely *look* alike — a different,
 * useful question this content-addressing scheme has nothing to say about
 * (two genuinely different photographs of the same view still get two
 * different addresses). That machinery is untouched and keeps earning its
 * place for exact-duplicate-free "these resemble each other" reporting; it
 * is simply not needed here for what "the same upload, twice" now means.
 */
async function storeTripPhoto(
  username: string,
  tripId: string,
  ref: string,
  day: string | undefined,
  caption: string | undefined,
  upload: MediaUpload,
): Promise<MediaWriteResult> {
  const limits = loadUserConfig(username).media;
  const isVideo = isVideoFilename(upload.filename);
  const originalExt = path.extname(upload.filename).toLowerCase();

  const sizeProblems = validateMediaBatch(
    [
      {
        name: upload.filename,
        kind: isVideo ? "video" : "image",
        format: originalExt.replace(".", "").replace("jpg", "jpeg"),
        bytes: upload.bytes.byteLength,
      },
    ],
    limits,
  );
  if (sizeProblems.length > 0) return { ok: false, error: "invalid_media", problems: sizeProblems };

  if (isVideo && !videoToolsAvailable()) {
    return {
      ok: false,
      error: "invalid_media",
      problems: [{ field: "file", got: "a video, on a server with no ffmpeg", expected: FFMPEG_MISSING_MESSAGE }],
    };
  }

  const hash = contentHash(upload.bytes);
  const subdir = day ?? "";
  const derivExt = isVideo ? ".mp4" : ".jpg";
  const derivName = `${hash}${derivExt}`;
  const relPath = path.join(subdir, derivName);
  const mediaDir = path.join(tripMediaDir(ref), subdir);
  const derivativePath = path.join(mediaDir, derivName);
  const sidecarPath = `${derivativePath}.meta.json`;
  const posterName = isVideo ? `${hash}-poster.jpg` : undefined;
  const originalsDir = path.join(tripOriginalsDir(ref), subdir);
  const originalPath = path.join(originalsDir, `${hash}${originalExt}`);

  const src = frontmatterSrc(tripId, relPath);
  const url = mediaUrl(ref, relPath);

  // Already here — the same bytes, in the same place, arrived before.
  // Nothing is decoded, nothing touches the storage quota: a blind retry of
  // an upload that already succeeded is free.
  if (fs.existsSync(derivativePath)) {
    const sidecar = readSidecar(sidecarPath);
    return {
      ok: true,
      item: {
        src,
        kind: "photo",
        trip: tripId,
        day,
        caption: sidecar?.caption ?? caption,
        bytes: fs.statSync(derivativePath).size,
        url,
        duplicateOf: src,
      },
    };
  }

  // Decode/transcode into a scratch area first, entirely outside the storage
  // lock: a file that will not decode costs nothing and leaves nothing on
  // disk, the same guarantee v1's own `storeUploads` gives its batch.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-v2-media-"));
  try {
    const stagedInput = path.join(scratch, `in${originalExt}`);
    fs.writeFileSync(stagedInput, upload.bytes);

    let derivativeBytes: Buffer;
    let posterBytes: Buffer | undefined;

    if (isVideo) {
      const outPath = path.join(scratch, "out.mp4");
      try {
        const result = transcodeVideo(stagedInput, outPath, { maxSeconds: limits.videoSeconds });
        posterBytes = result.poster;
      } catch (err) {
        return {
          ok: false,
          error: "invalid_media",
          problems: [
            {
              field: "file",
              got: "something that could not be transcoded as video",
              expected: `a readable mp4, mov or webm of at most ${limits.videoSeconds}s`,
              hint: String((err as Error).message ?? err),
            },
          ],
        };
      }
      derivativeBytes = fs.readFileSync(outPath);
    } else {
      let source;
      try {
        source = await decodeSource(stagedInput);
      } catch (err) {
        return {
          ok: false,
          error: "invalid_media",
          problems: [
            {
              field: "file.format",
              got: "something that could not be decoded as an image",
              expected: "a readable jpeg, png, heic, heif or webp file",
              hint: String((err as Error).message ?? err),
            },
          ],
        };
      }
      try {
        const meta = await sharp(source.file, { limitInputPixels: MAX_DECODE_PIXELS }).metadata();
        const longestEdge = meta.width && meta.height ? Math.max(meta.width, meta.height) : undefined;
        const edgeProblems = validateMediaBatch([{ name: upload.filename, kind: "image", longestEdge }], limits);
        if (edgeProblems.length > 0) return { ok: false, error: "invalid_media", problems: edgeProblems };
        const derivative = await makeDerivative(source);
        derivativeBytes = derivative.bytes;
      } finally {
        source.dispose();
      }
    }

    const sidecar: MediaSidecar = {
      kind: "photo",
      trip: tripId,
      day,
      caption,
      filename: upload.filename,
      uploadedAt: new Date().toISOString(),
    };

    const guard = await withStorageQuota(username, upload.bytes.byteLength, () => {
      fs.mkdirSync(mediaDir, { recursive: true });
      fs.mkdirSync(originalsDir, { recursive: true });
      // Another request for the identical bytes could have landed while this
      // one was decoding — the address is the same either way, so whichever
      // writer gets here second simply leaves the first one's files alone.
      if (!fs.existsSync(derivativePath)) {
        fs.writeFileSync(derivativePath, derivativeBytes);
        if (posterName && posterBytes) fs.writeFileSync(path.join(mediaDir, posterName), posterBytes);
        if (!fs.existsSync(originalPath)) fs.writeFileSync(originalPath, upload.bytes);
        fs.writeFileSync(sidecarPath, `${JSON.stringify(sidecar, null, 2)}\n`);
      }
    });
    if (!guard.ok) return { ok: false, error: "storage_full", problem: guard.problem };

    return {
      ok: true,
      item: { src, kind: "photo", trip: tripId, day, caption, bytes: fs.statSync(derivativePath).size, url },
    };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * The one entry point the route calls. `intent` is already
 * `mediaIntent.parse()`d — every per-kind question answered or declined —
 * so this function only ever has to decide *where the bytes go*.
 */
export async function storeMediaV2(
  username: string,
  intent: MediaIntent,
  upload: MediaUpload,
): Promise<MediaWriteResult> {
  if (intent.kind === "photo" && intent.trip) {
    const ref = tripRef(username, intent.trip);
    if (!getTrip(ref)) return { ok: false, error: "unknown_trip" };

    let day: string | undefined;
    if (intent.day) {
      const safe = safeDaySlug(intent.day);
      if (!safe) {
        return {
          ok: false,
          error: "invalid_media",
          problems: [{ field: "day", got: intent.day, expected: "lowercase letters, digits and dashes" }],
        };
      }
      day = safe;
    }

    return storeTripPhoto(username, intent.trip, ref, day, intent.caption, upload);
  }

  // Every other case lands in the flat, journal-wide inbox — a photo whose
  // trip was declined (v1's "camera roll dump, sorting later"), and every
  // bank_export/gps_history/document regardless of trip: step 3 stores and
  // routes only, and the inbox's `files/` shelf is where step 4's importer
  // will look, per the intent's own `trip`/`importKind`/`format` recorded
  // beside the bytes. Parsing and applying a bank export or a GPS history is
  // step 4's job, not this door's — see MEDIA_KINDS's own doc comment.
  const shelf = intent.kind === "photo" ? "media" : "files";
  // B661's ceiling applies here too — this is the same flat inbox `files/`
  // that `receiveInboxUpload` and the helper's own door already gate.
  const guard = await withStorageQuota(username, upload.bytes.byteLength, () =>
    storeInboxFile(username, shelf, upload.filename, upload.bytes, {
      caption: intent.caption,
      ...(intent.trip ? { trip: intent.trip } : {}),
      ...(intent.kind !== "photo" ? { importKind: intent.kind } : {}),
      ...(intent.format ? { importFormat: intent.format } : {}),
    }),
  );
  if (!guard.ok) return { ok: false, error: "storage_full", problem: guard.problem };
  const stored = guard.value;
  const src = `inbox:${stored.entry.id}`;
  return {
    ok: true,
    item: {
      src,
      kind: intent.kind,
      ...(intent.trip ? { trip: intent.trip } : {}),
      caption: stored.entry.caption,
      bytes: stored.entry.bytes,
      ...(stored.existed ? { duplicateOf: src } : {}),
    },
  };
}

/** Take an id straight out of the flat inbox and store it the ordinary way —
 * the `inbox` branch of `POST`. Resolving happens here, once, rather than in
 * the route: an id that answers to nothing is `unknown_inbox_file` before
 * anything about the intent is even asked. */
export function resolveInboxUpload(username: string, id: string): MediaUpload | null {
  const found = findInboxFile(username, id);
  if (!found) return null;
  return { filename: found.entry.filename, bytes: fs.readFileSync(found.file) };
}

/** Only called once `storeMediaV2` has actually placed the bytes somewhere
 * that is not the same inbox entry it started as — see the route's own
 * comment on why that check has to happen before this is. */
export function forgetInboxUpload(username: string, id: string): void {
  removeInboxFile(username, id);
}

export type MediaListResult = { items: MediaItemOut[]; nextCursor?: string };

/**
 * One trip's stored media, in the address order `frontmatterSrc` gives them
 * — day-less items (directly under the trip's `media/` root) sort before
 * any day's own subfolder, which is incidental rather than promised: cursor
 * paging only ever needs *a* stable order, not this one specifically.
 *
 * Sidecars, posters and the fingerprint/decode caches v1 leaves beside its
 * own derivatives are all skipped — this walks what a v2 upload itself
 * wrote, and nothing here reads v1's `.fingerprints/` at all.
 */
export function listTripMediaV2(
  username: string,
  tripId: string,
  opts: { limit: number; cursor?: string },
): MediaListResult {
  const ref = tripRef(username, tripId);
  const root = tripMediaDir(ref);

  const rows: { relPath: string; day?: string }[] = [];
  const walk = (dir: string, day?: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, entry.name);
        continue;
      }
      if (entry.name.endsWith(".meta.json")) continue;
      if (/-poster\.jpe?g$/i.test(entry.name)) continue;
      rows.push({ relPath: path.relative(root, full), day });
    }
  };
  walk(root);
  rows.sort((a, b) => a.relPath.localeCompare(b.relPath));

  const start = opts.cursor ? rows.findIndex((r) => r.relPath === opts.cursor) + 1 : 0;
  const page = rows.slice(start, start + opts.limit);

  const items = page.map((row) => {
    const full = path.join(root, row.relPath);
    const sidecar = readSidecar(`${full}.meta.json`);
    return {
      src: frontmatterSrc(tripId, row.relPath),
      kind: "photo" as const,
      trip: tripId,
      day: row.day,
      caption: sidecar?.caption,
      bytes: fs.statSync(full).size,
      url: mediaUrl(ref, row.relPath),
    };
  });

  const nextCursor = start + opts.limit < rows.length ? page[page.length - 1]?.relPath : undefined;
  return { items, nextCursor };
}

export type MediaDeleteResult = { ok: true } | { ok: false; error: "unknown_media" };

/**
 * Best-effort: a v2 day document (`entries/<date>-<slug>.json`, B1606) that
 * already names this `src` in its own `media` array has that entry dropped,
 * so a deleted photograph does not go on quietly answering for a day. This
 * is filesystem cleanup, not the day route's own write path — no ETag check,
 * no schema re-validation, nothing this ticket's sibling (the day/trip
 * routes) owns. It only ever removes an array entry that already matches;
 * anything it cannot parse it leaves alone rather than risk corrupting a
 * day it does not understand.
 */
function detachFromDays(ref: string, src: string): void {
  const dir = path.join(tripDirFor(ref), "entries");
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return;
  }
  for (const file of files) {
    const full = path.join(dir, file);
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(fs.readFileSync(full, "utf8"));
    } catch {
      continue;
    }
    const media = data.media;
    if (!Array.isArray(media)) continue;
    const next = media.filter((item) => !(item && typeof item === "object" && (item as { src?: unknown }).src === src));
    if (next.length === media.length) continue;
    data.media = next;
    try {
      fs.writeFileSync(full, `${JSON.stringify(data, null, 2)}\n`);
    } catch {
      // Best effort — the bytes are already gone either way.
    }
  }
}

function tripDirFor(ref: string): string {
  // `tripMediaDir(ref)` is `<tripDir>/media`; walking one level up avoids a
  // second import purely to name the same directory twice.
  return path.dirname(tripMediaDir(ref));
}

/**
 * Remove one stored item by the `src`/`inbox:` id the upload answered with.
 *
 * A trip-scoped `src` is resolved through `resolveMediaFile` — the same
 * guarded resolve the read route uses, refusing anything that would escape
 * the trip's own media directory — so a `src` carrying `../` answers
 * `unknown_media` rather than deleting something outside the trip.
 */
export function deleteMediaV2(username: string, src: string): MediaDeleteResult {
  if (src.startsWith("inbox:")) {
    const id = src.slice("inbox:".length);
    return removeInboxFile(username, id) ? { ok: true } : { ok: false, error: "unknown_media" };
  }

  const segments = mediaKey(src).split("/");
  const file = resolveMediaFile(username, segments);
  if (!file || segments.length < 2) return { ok: false, error: "unknown_media" };

  const [tripId] = segments;
  const ref = tripRef(username, tripId);
  const stem = path.basename(file, path.extname(file));
  const dir = path.dirname(file);

  fs.rmSync(file, { force: true });
  fs.rmSync(`${file}.meta.json`, { force: true });
  fs.rmSync(path.join(dir, `${stem}-poster.jpg`), { force: true });

  // The untouched original, wherever it sits under the trip's own
  // originals/ — matched by stem, the same rule v1's `deleteMediaFiles`
  // uses, since the two extensions can differ (a HEIC original behind a
  // JPEG derivative).
  const relDir = path.relative(tripMediaDir(ref), dir);
  const originalsDir = path.join(tripOriginalsDir(ref), relDir === "." ? "" : relDir);
  let siblings: string[] = [];
  try {
    siblings = fs.readdirSync(originalsDir);
  } catch {
    // No original was kept, or it is already gone.
  }
  for (const sibling of siblings) {
    if (path.basename(sibling, path.extname(sibling)) !== stem) continue;
    try {
      fs.unlinkSync(path.join(originalsDir, sibling));
    } catch {
      // Already gone.
    }
  }

  detachFromDays(ref, src);
  return { ok: true };
}

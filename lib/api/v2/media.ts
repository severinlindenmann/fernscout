// The v2 media door's own domain function — B1613, phase 2 step 3, parcel C.
//
// One upload for every kind of bytes: what v1 split across
// /trips/{trip}/media, /inbox and (for a bank statement) /import. This file
// never touches a request or a response — that is app/api/v2/[user]/media/
// route.ts's job — and it never imports anything under lib/api/ outside its
// own v2 folder (test/api-v2-imports.test.ts enforces the boundary).
//
// A photograph's metadata file is `lib/sidecar.ts`'s business — one shape,
// one writer, one file per photograph for life (B1864). Nothing here builds
// or writes a sidecar of its own.
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
import crypto from "node:crypto";
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
import { mediaUrl, resolveMediaFile, tripMediaDir, tripOriginalsDir, tripSidecarPath } from "../../media";
import { moveSidecar, readTripSidecar, removeTripSidecar, writeTripSidecar, type Sidecar } from "../../sidecar";
import { listDaySlugs, readDayFile } from "./store";
import { measureImage, type ImageFacts } from "../../ingest/imageFacts";
import { withStorageQuota } from "../../storageQuota";
import { findInboxFile, removeInboxFile, storeInboxFile } from "../../inbox";
import { validateMediaBatch, type Problem } from "../../validate/media";
import { mediaKey } from "../../photos";
import { altTextFor } from "../../entries";
import type { MediaIntent } from "./schemas/media";
import { attachDayMedia } from "./days";

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
  /** Recorded by the server at upload, never accepted from a caller. */
  uploadedBy?: string;
  source?: Sidecar["source"];
  /** The served derivative's pixels, when they have been measured. */
  width?: number;
  height?: number;
  /** Off the sidecar — measured (EXIF/probe) or said by a person. B1842. */
  takenAt?: string;
  lat?: number;
  lon?: number;
  measuredFrom?: Sidecar["measuredFrom"];
};

export type MediaWriteResult =
  | { ok: true; item: MediaItemOut }
  | { ok: false; error: "invalid_media"; problems: Problem[] }
  | { ok: false; error: "unknown_trip" }
  | { ok: false; error: "unknown_day" }
  | { ok: false; error: "storage_full"; problem: string };

export type MediaUpload = {
  filename: string;
  bytes: Buffer;
  /**
   * The inbox sidecar these bytes already carry, when they came out of the
   * inbox — absolute path. Filing MOVES that file onto the trip rather than
   * writing a second one beside it: one metadata file per photograph, for
   * life (B1864). Absent for bytes arriving from anywhere else.
   */
  sidecar?: string;
};

/** What the door knows about who is uploading, which is the one pair of facts
 * that cannot be recovered later — everything else on a sidecar can be read
 * back off the original. Absent rather than invented when a door has none. */
export type UploadedBy = { uploadedBy?: string; source?: Sidecar["source"] };

function isVideoFilename(filename: string): boolean {
  return VIDEO_EXTENSIONS.has(path.extname(filename).toLowerCase());
}

/** `{takenAt?, lat?, lon?, measuredFrom?}` off a sidecar — B1842. Read back
 * exactly what is on disk, never re-derived: `measuredFrom` is what tells a
 * caller these were the camera's own claim rather than a person's. */
function captureOf(sidecar: Sidecar | null): Pick<MediaItemOut, "takenAt" | "lat" | "lon" | "measuredFrom"> {
  if (!sidecar) return {};
  return {
    ...(sidecar.takenAt !== undefined ? { takenAt: sidecar.takenAt } : {}),
    ...(sidecar.lat !== undefined ? { lat: sidecar.lat } : {}),
    ...(sidecar.lon !== undefined ? { lon: sidecar.lon } : {}),
    ...(sidecar.measuredFrom !== undefined ? { measuredFrom: sidecar.measuredFrom } : {}),
  };
}

/**
 * Format and size, for anything claiming `kind: "photo"` — B1627. This used
 * to run only inside `storeTripPhoto`, so a photo whose `trip` was declined
 * skipped it entirely on the way to `storeInboxFile`: same door, two paths,
 * one of them unguarded. Called once here, before `storeMediaV2` branches on
 * `intent.trip`, so both paths get the same answer from the same check
 * rather than a second copy of it living in the inbox branch too.
 */
function photoUploadProblems(username: string, upload: MediaUpload): Problem[] {
  const limits = loadUserConfig(username).media;
  const isVideo = isVideoFilename(upload.filename);
  const originalExt = path.extname(upload.filename).toLowerCase();
  return validateMediaBatch(
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

/**
 * The photograph already stored here whose served bytes are exactly these,
 * or null — B1790.
 *
 * **Size first, and that is the whole cost in the ordinary case**: only a
 * file of exactly this length can be these bytes, so an upload of something
 * genuinely new reads one directory and hashes nothing. A day holds tens of
 * photographs, not thousands, and the walk is the same directory the write
 * below is about to touch.
 *
 * A video's `-poster.jpg` is skipped: it is a frame this server drew, not a
 * photograph anybody may name, and answering an upload with its src would
 * hand back an address that belongs to no `media` item.
 */
function derivativeHolding(dir: string, bytes: Buffer): string | null {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return null;   // nothing stored here yet
  }
  for (const name of names) {
    // `.meta.json` is a legacy sidecar left in here before B1863 moved them
    // to `meta/`; new ones never land in this directory at all.
    if (name.endsWith(".meta.json") || name.endsWith("-poster.jpg")) continue;
    const file = path.join(dir, name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(file);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.size !== bytes.byteLength) continue;
    try {
      if (fs.readFileSync(file).equals(bytes)) return name;
    } catch {
      continue;   // gone between the stat and the read
    }
  }
  return null;
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
  by: UploadedBy = {},
): Promise<MediaWriteResult> {
  const limits = loadUserConfig(username).media;
  const isVideo = isVideoFilename(upload.filename);
  const originalExt = path.extname(upload.filename).toLowerCase();

  if (isVideo && !(await videoToolsAvailable())) {
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
  const posterName = isVideo ? `${hash}-poster.jpg` : undefined;
  const originalsDir = path.join(tripOriginalsDir(ref), subdir);
  const originalPath = path.join(originalsDir, `${hash}${originalExt}`);

  const src = frontmatterSrc(tripId, relPath);
  const url = mediaUrl(ref, relPath);

  // Already here — the same bytes, in the same place, arrived before.
  // Nothing is decoded, nothing touches the storage quota: a blind retry of
  // an upload that already succeeded is free.
  if (fs.existsSync(derivativePath)) {
    const sidecar = readTripSidecar(ref, relPath);
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
        ...captureOf(sidecar),
      },
    };
  }

  // The same photograph, sent back as this server's own copy of it — B1790.
  //
  // The address above is the hash of what arrives, and a derivative does not
  // hash to what it was derived from. So a folder holding the served copy —
  // which is what a folder synced down holds — publishes it again, the bytes
  // are new to this check, and the same photograph is stored a second time
  // under a second name. The day is then re-pointed at the new one and the
  // first is left with nothing naming it. 18 photographs on one real journal,
  // and the copy left behind was the one carrying the untouched original, so
  // tidying the orphans away cost the print masters.
  //
  // Identity by bytes is what this door already trades in, so the missing
  // question is the same one, asked of the derivatives already written here.
  // It is answered where every caller meets it rather than in one client: a
  // second caller sending back what the first was answered with would
  // otherwise make the same duplicate.
  const echoed = derivativeHolding(mediaDir, upload.bytes);
  if (echoed) {
    const echoedRel = path.join(subdir, echoed);
    const echoedSrc = frontmatterSrc(tripId, echoedRel);
    const sidecar = readTripSidecar(ref, echoedRel);
    return {
      ok: true,
      item: {
        src: echoedSrc,
        kind: "photo",
        trip: tripId,
        day,
        caption: sidecar?.caption ?? caption,
        bytes: upload.bytes.byteLength,
        url: mediaUrl(ref, echoedRel),
        duplicateOf: echoedSrc,
        ...captureOf(sidecar),
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
        const result = await transcodeVideo(stagedInput, outPath, { maxSeconds: limits.videoSeconds });
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

    // Measured here, in the scratch phase, outside the storage lock — the
    // decode is already in hand and nobody else should have to pay for a
    // second one (B1865). A measurement that fails is omitted: it is a
    // convenience, never a reason to refuse a photograph.
    let image: ImageFacts | undefined;
    try {
      image = await measureImage(derivativeBytes);
    } catch (err) {
      console.warn(`could not measure ${relPath}: ${String((err as Error).message ?? err)}`);
    }

    const sidecar: Sidecar = {
      trip: tripId,
      day,
      caption,
      // A carried sidecar already answers these, and its `uploadedAt` is when
      // the file actually arrived rather than when it was filed. Only a
      // photograph arriving for the first time gets them written. The hash is
      // of what arrived, not of the derivative: it is what ties this file to
      // the original kept beside it, and the derivative's own name is already
      // this value's first 32 characters.
      ...(upload.sidecar
        ? {}
        : {
            filename: upload.filename,
            sha256: crypto.createHash("sha256").update(upload.bytes).digest("hex"),
            bytes: upload.bytes.byteLength,
            uploadedAt: new Date().toISOString(),
          }),
      ...by,
      ...(image ? { image } : {}),
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
        // The sidecar the bytes already have, carried whole — every key the
        // inbox collected (a description, coordinates measured off EXIF, the
        // door it came through) survives the filing, and the inbox copy is
        // unlinked in the same step. Nothing here ever ends with two.
        if (upload.sidecar) moveSidecar(upload.sidecar, tripSidecarPath(ref, relPath), sidecar);
        else writeTripSidecar(ref, relPath, sidecar);
      }
    });
    if (!guard.ok) return { ok: false, error: "storage_full", problem: guard.problem };

    // Read back what actually landed — a carried inbox sidecar (EXIF read at
    // that earlier door) was merged over `sidecar` above rather than held in
    // this in-memory object, so this is the one place that has the final
    // answer (B1842).
    const written = readTripSidecar(ref, relPath);

    return {
      ok: true,
      item: {
        src,
        kind: "photo",
        trip: tripId,
        day,
        caption,
        bytes: fs.statSync(derivativePath).size,
        url,
        ...by,
        ...(image ? { width: image.width, height: image.height } : {}),
        ...captureOf(written),
      },
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
  by: UploadedBy = {},
): Promise<MediaWriteResult> {
  if (intent.kind === "photo") {
    // Format and size, whichever path the bytes are about to take — a photo
    // declined to the inbox is still claiming to be a photo (B1627).
    const problems = photoUploadProblems(username, upload);
    if (problems.length > 0) return { ok: false, error: "invalid_media", problems };
  }

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

    const stored = await storeTripPhoto(username, intent.trip, ref, day, intent.caption, upload, by);
    if (!stored.ok || !day) return stored;

    // B1685: a photo uploaded naming a day used to sit on disk while the day
    // itself never learned about it — accepted, answered 201, and invisible
    // on the one resource that owns it. `attachDayMedia` (./days.ts) is the
    // same write `POST .../days/{slug}/media` uses (B1656/D20): appends the
    // src to the day's own `media` and retracts a stale `declined.media`
    // (T6). Never a second implementation of that write.
    const attach = attachDayMedia(username, intent.trip, day, [
      { src: stored.item.src, ...(intent.caption ? { caption: intent.caption } : {}) },
    ]);
    if (!attach.ok) {
      if (attach.error === "unknown_day") return { ok: false, error: "unknown_day" };
      // Cannot happen in practice — attachDayMedia's own "not this trip"
      // check is exactly the resolve this function just used to place the
      // bytes — but the type has to be exhaustive, and answering honestly
      // beats a silent success that did not actually attach anything.
      return {
        ok: false,
        error: "invalid_media",
        problems: attach.problems.map((p) => ({ field: p.field, got: stored.item.src, expected: p.problem })),
      };
    }

    return stored;
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
      ...by,
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
      ...captureOf(stored.entry),
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
  // The sidecar travels with the bytes: if these are filed onto a trip, that
  // file MOVES there rather than a second one being written (B1864).
  return {
    filename: found.entry.filename,
    bytes: fs.readFileSync(found.file),
    sidecar: `${found.file}.meta.json`,
  };
}

/** Only called once `storeMediaV2` has actually placed the bytes somewhere
 * that is not the same inbox entry it started as — see the route's own
 * comment on why that check has to happen before this is.
 *
 * What is left by then is usually only the bytes: filing MOVED the sidecar
 * onto the trip. `removeInboxFile` tolerates that (`rmSync` with `force`),
 * and still removes both for the paths that never filed one — a duplicate
 * upload, an echoed derivative. */
export function forgetInboxUpload(username: string, id: string): void {
  removeInboxFile(username, id);
}

export type MediaListResult = { items: MediaItemOut[]; nextCursor?: string };

/**
 * The `src`s a trip's own day-less media already holds — B1503. A cover is
 * checked against what a day's `media` array names (`checkCover` in
 * `lib/api/v2/write.ts`), which a photograph stored with no `day` never
 * joins: T2 lets that upload happen, but nothing it lands in ever made the
 * photograph eligible to be the trip's own cover. Unioned into the same
 * check rather than replacing it, so a cover still has to name something
 * this trip actually stored.
 */
export function daylessTripMediaSrcs(username: string, tripId: string): Set<string> {
  const { items } = listTripMediaV2(username, tripId, { limit: Number.MAX_SAFE_INTEGER });
  return new Set(items.filter((item) => item.day === undefined).map((item) => item.src));
}

/**
 * One trip's stored media, in the address order `frontmatterSrc` gives them
 * — day-less items (directly under the trip's `media/` root) sort before
 * any day's own subfolder, which is incidental rather than promised: cursor
 * paging only ever needs *a* stable order, not this one specifically.
 *
 * Legacy sidecars (B1863 writes them to `meta/` now, but older ones are
 * still in here), posters and the fingerprint/decode caches v1 leaves beside
 * its own derivatives are all skipped — this walks what a v2 upload itself
 * wrote, and nothing here reads v1's `.fingerprints/` at all.
 */
/** `{ alt }` or `{}` — `mediaItem` is a `strictObject`, so an explicit
 * `alt: undefined` would be a key the schema then has to carry; absent is
 * what "nothing described it" means on the wire. */
function altOf(ref: string, src: string): { alt?: string } {
  const alt = altTextFor(ref, src);
  return alt === undefined ? {} : { alt };
}

/**
 * B1868 — a photograph's caption has two doors that can answer differently.
 *
 * The sidecar's `caption` is what the uploader said at the door and never
 * changes after. The day document's `media[].caption` is what the journal
 * actually publishes, edited later through the day `PATCH`/`EditDay`. Once a
 * photograph is on a day, that document is the one place a caption is
 * edited, so it is the one place this reads a caption FROM — the sidecar's
 * copy is the upload's own answer, not "the" caption, and is used only for a
 * photograph no day has ever named (day-less, or attached before the day
 * document existed to say otherwise).
 */
function dayMediaCaption(username: string, tripId: string, day: string, src: string, cache: Map<string, ReturnType<typeof readDayFile>>): string | undefined {
  let file = cache.get(day);
  if (file === undefined) {
    file = readDayFile(username, tripId, day);
    cache.set(day, file);
  }
  return file?.media?.find((m) => mediaKey(m.src) === mediaKey(src))?.caption;
}

/**
 * B1976 — `attachDayMedia` (./days.ts) only ever writes a `src` into a day's
 * own `media` array; it never moves the bytes it names. A day-less upload
 * later attached to a day therefore keeps sitting at the trip's `media/`
 * root, and the disk walk below would answer `day: undefined` for it
 * forever, disagreeing with the day document that now owns it.
 *
 * Re-pointing the record (this map) rather than moving the bytes is the
 * chosen fix, not the only possible one: moving the derivative, its poster,
 * *and* its print-master original into the day's own subfolder would also
 * change the `src` every caller already holds (it is derived from the
 * file's own path), so every existing reference — the day document just
 * written, a cover, a caller's own copy — would need rewriting too, and the
 * print master would be the thing actually moved to get there. Every day
 * document already says which `src` it owns; reading that back costs one
 * file per day and touches no bytes at all, so it is the smaller and safer
 * change, and it leaves the print master exactly where the upload put it.
 *
 * A photograph attached before this fix shipped is repaired the moment this
 * runs, not just the next attach — the map is built fresh off the day
 * documents on every call, so an old mismatch and a new one read alike.
 */
function daySrcMap(username: string, tripId: string, cache: Map<string, ReturnType<typeof readDayFile>>): Map<string, string> {
  const map = new Map<string, string>();
  for (const slug of listDaySlugs(username, tripId)) {
    let file = cache.get(slug);
    if (file === undefined) {
      file = readDayFile(username, tripId, slug);
      cache.set(slug, file);
    }
    for (const m of file?.media ?? []) {
      map.set(mediaKey(m.src), slug);
    }
  }
  return map;
}

export function listTripMediaV2(
  username: string,
  tripId: string,
  opts: { limit: number; cursor?: string },
): MediaListResult {
  const ref = tripRef(username, tripId);
  const root = tripMediaDir(ref);
  const dayCache = new Map<string, ReturnType<typeof readDayFile>>();
  const attachedDayOf = daySrcMap(username, tripId, dayCache);

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
    const sidecar = readTripSidecar(ref, row.relPath);
    const src = frontmatterSrc(tripId, row.relPath);
    // The bytes' own folder names the day for anything stored there directly
    // (a day-named upload); a day-less upload later attached (B1976) is
    // still sitting at the trip's media root, so its day comes from whichever
    // day document names its src instead.
    const day = row.day ?? attachedDayOf.get(mediaKey(src));
    // The day's own caption wins once a day names this photograph — B1868.
    // Falls back to the sidecar's intake caption for anything no day
    // document has ever attached (day-less, or not yet re-read).
    const caption = day !== undefined ? dayMediaCaption(username, tripId, day, src, dayCache) : undefined;
    return {
      src,
      kind: "photo" as const,
      trip: tripId,
      day,
      caption: caption ?? sidecar?.caption,
      // What the photograph shows, off the same sidecar this row was already
      // reading — server-written (B1866), never accepted from a caller, and
      // absent for anything nothing has described (B1867).
      ...altOf(ref, src),
      bytes: fs.statSync(full).size,
      url: mediaUrl(ref, row.relPath),
      ...(sidecar?.uploadedBy ? { uploadedBy: sidecar.uploadedBy } : {}),
      ...(sidecar?.source ? { source: sidecar.source } : {}),
      ...(sidecar?.image ? { width: sidecar.image.width, height: sidecar.image.height } : {}),
      ...captureOf(sidecar),
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
  // Both places a sidecar can be — and the day's `meta/` directory if that
  // was the last one in it (B1864).
  removeTripSidecar(ref, path.relative(tripMediaDir(ref), file));
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

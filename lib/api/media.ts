import "server-only";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { decodeSource, extensionFor, makeDerivative } from "../ingest/image.ts";
import { getEntryBySlug } from "../entries";
import { frontmatterSrc } from "../ingest/paths.ts";
import { tripMediaDir, tripOriginalsDir } from "../media";
import { getTrips, parseTripRef, tripDir } from "../trips";
import { IMAGE_FORMATS, validateMediaBatch, type MediaCandidate, type Problem } from "../validate/media";
import { VIDEO_EXTENSIONS, probeVideo, transcodeVideo, videoToolsAvailable } from "../ingest/video";
import { loadUserConfig } from "../config";
import type { GalleryItem } from "../types";

/**
 * Photographs arriving over the network rather than off a memory card.
 *
 * `npm run ingest` has always been the only way media got in, which meant an
 * agent working over the network could write a day's prose and nothing else.
 * This is the same pipeline — decode, orient, strip metadata, resize — reached
 * through the API instead of the filesystem.
 *
 * Two files come out of one going in. The derivative is what the browser
 * gets: ≤2000px, no EXIF, no GPS. The original is kept untouched beside the
 * trip, because a derivative is not a source and a photobook plate wants more
 * pixels than a web page ever will. See `tripOriginalsDir`.
 */

export type UploadCandidate = {
  filename: string;
  bytes: Buffer;
};

/**
 * What was kept of one file, as opposed to what is served.
 *
 * The endpoint has always kept the original — the raw bytes, before any
 * resize, for whichever door they arrived through — and never said so. An
 * agent that sends 3000px, reads 2000px back in `items`, and has just been
 * told by the guide that a photobook is printed from the original has every
 * reason to conclude the promise did not hold. `items` carries the *served*
 * copy's dimensions; this carries the original's, so the two can be compared
 * rather than confused.
 */
export type KeptOriginal = {
  /** The name the caller sent, or the one derived from the URL. */
  filename: string;
  bytes: number;
  /** Absent for a video, where dimensions come from a probe rather than a
   * decode and are the transcode's business. */
  width?: number;
  height?: number;
};

export type UploadResult =
  | { ok: true; items: GalleryItem[]; kept: KeptOriginal[] }
  | { ok: false; problems: Problem[] };

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Every byte of media one journal holds, derivatives and originals alike.
 *
 * Walked rather than tracked in a counter: a counter is a second source of
 * truth that drifts the first time somebody deletes a file by hand, which on
 * a system whose whole premise is "your content is a folder you own" is not a
 * hypothetical. The walk costs a stat per file and only runs when an instance
 * has actually set a quota.
 */
function journalMediaBytes(username: string): number {
  let total = 0;
  const walk = (at: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(at, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(at, entry.name);
      if (entry.isDirectory()) walk(full);
      else
        try {
          total += fs.statSync(full).size;
        } catch {
          // Vanished between readdir and stat. Not our byte to count.
        }
    }
  };
  for (const trip of getTrips(username)) {
    walk(tripMediaDir(trip.ref));
    walk(tripOriginalsDir(trip.ref));
  }
  return total;
}

/**
 * A slug good enough to be a directory name, from whatever was sent.
 *
 * Deliberately not `slugify` from lib/slug.ts, which mints a slug from a
 * title. This one normalises a slug the caller already claims to have, and
 * the difference that matters is the empty case: `slugify` falls back to
 * "entry", so a `day=` of "!!!" would come out as a lookup for a day called
 * "entry" instead of the 400 the caller has earned. Everything reaching here
 * is already an ASCII slug that lib/slug.ts produced, so the two never
 * disagree about a letter in practice — but if this ever grows a caller that
 * passes a title, it should call lib/slug.ts and check the result instead.
 */
function safeSlug(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * The next free `NN` in a day's folder.
 *
 * Numbered rather than named after the upload: two cameras produce
 * `IMG_0001.JPG` on the same day about as often as not, and the frontmatter
 * has to keep them apart. Counting what is already there means a second
 * upload to the same day appends instead of overwriting.
 */
function nextIndex(dir: string): number {
  if (!fs.existsSync(dir)) return 1;
  const used = fs
    .readdirSync(dir)
    .map((f) => Number.parseInt(path.basename(f, path.extname(f)), 10))
    .filter((n) => Number.isFinite(n));
  return used.length === 0 ? 1 : Math.max(...used) + 1;
}

/**
 * Writes one day's worth of media and returns the gallery block for it.
 *
 * Validated as a batch before anything is written: a request that breaks a
 * limit leaves no half-imported day behind, which is the state that is
 * genuinely annoying to clean up by hand.
 */
/**
 * Photograph or clip, from the name alone.
 *
 * Not from the bytes: the batch is validated before anything is written, and
 * at that point all we have is what the caller called the file. Deciding
 * wrongly is caught downstream — a "video" that will not probe and an "image"
 * that will not decode are both refused with a message that names the file.
 */
function kindOf(filename: string): "image" | "video" {
  return VIDEO_EXTENSIONS.has(path.extname(filename).toLowerCase()) ? "video" : "image";
}

export async function storeUploads(
  ref: string,
  daySlug: string,
  uploads: UploadCandidate[],
): Promise<UploadResult> {
  const tripId = parseTripRef(ref)?.tripId;
  if (!tripId) {
    return { ok: false, problems: [{ field: "trip", got: ref, expected: "<user>/<trip-id>" }] };
  }

  const slug = safeSlug(daySlug);
  if (!slug) {
    return {
      ok: false,
      problems: [{ field: "day", got: JSON.stringify(daySlug), expected: "a day slug" }],
    };
  }
  if (uploads.length === 0) {
    return {
      ok: false,
      problems: [
        {
          field: "files",
          got: "nothing",
          expected: "at least one file",
          hint: "Send bytes as multipart/form-data under the field `files`, or JSON with `urls`.",
        },
      ],
    };
  }

  // The day has to exist. Accepting any slug meant a typo silently produced a
  // folder of public files attached to nothing, discoverable by anyone who
  // guessed the path and cleaned up by nobody. Drafts count: attaching
  // photographs to a day still awaiting approval is the normal way round.
  if (!getEntryBySlug(ref, slug, { includeDrafts: true })) {
    return {
      ok: false,
      problems: [
        {
          field: "day",
          got: JSON.stringify(daySlug),
          expected: "the slug of a day that exists in this trip — write the day first",
        },
      ],
    };
  }

  const limits = loadUserConfig(parseTripRef(ref)!.username).media;
  const mediaOut = path.join(tripMediaDir(ref), slug);
  const originalsOut = path.join(tripOriginalsDir(ref), slug);

  // The batch limit counts what is already on disk, not just what arrived —
  // forty per day means forty, not forty per request.
  const existing = fs.existsSync(mediaOut) ? fs.readdirSync(mediaOut).length : 0;
  // Every upload used to be declared an image, so an .mp4 was measured
  // against the image formats and refused as a broken photograph — while the
  // limits table in /agent.md advertised video. The extension decides.
  const candidates: MediaCandidate[] = uploads.map((u) => ({
    name: u.filename,
    kind: kindOf(u.filename),
    format: path.extname(u.filename).replace(".", "").toLowerCase().replace("jpg", "jpeg"),
    bytes: u.bytes.byteLength,
  }));
  const problems = validateMediaBatch(candidates, limits);

  // Video needs ffmpeg, which is the one thing here that is not an npm
  // dependency. Absent rather than broken: if it is not installed, say so
  // rather than failing at the transcode with a stack trace.
  if (candidates.some((c) => c.kind === "video") && !videoToolsAvailable()) {
    problems.push({
      field: "files",
      got: "a video, on a server with no ffmpeg",
      expected:
        "images only on this instance — ffmpeg and ffprobe are not installed, " +
        "so video cannot be converted for the browser. Send the photographs on " +
        "their own, and ask the person to install ffmpeg for the rest.",
    });
  }

  // Said differently from `validateMediaBatch`'s request-level problem above,
  // which used to carry the identical `expected` string — B209. This one is
  // about the day, it names what is already there, and its remedy is another
  // day rather than another request.
  if (existing + uploads.length > limits.itemsPerDay) {
    problems.push({
      field: "files",
      got: `${existing + uploads.length} items in this day`,
      expected:
        `at most ${limits.itemsPerDay} items in one day. This day already holds ${existing}, ` +
        `so it has room for ${Math.max(0, limits.itemsPerDay - existing)} more — put the rest ` +
        `on another day.`,
    });
  }

  // The journal's total allowance, if it has one. Counted across every trip
  // and including the originals, because those are the bytes actually on the
  // disk somebody is paying for.
  if (limits.perUserBytes !== null) {
    const held = journalMediaBytes(parseTripRef(ref)!.username);
    const incoming = uploads.reduce((n, u) => n + u.bytes.byteLength, 0);
    if (held + incoming > limits.perUserBytes) {
      problems.push({
        field: "media",
        got: `${megabytes(held + incoming)} in this journal`,
        expected: `at most ${megabytes(limits.perUserBytes)}`,
      });
    }
  }

  if (problems.length > 0) return { ok: false, problems };

  // Everything is built in a staging directory and moved into place only once
  // the whole batch has succeeded.
  //
  // The guide promises that "if any file in a batch is refused, nothing is
  // written: fix it and send the batch again", and that is the only advice
  // that can be given — an agent has no way to tell which of its files landed.
  // The *validation* was all-or-nothing; the writing was not. The loop wrote
  // each file as it went and returned on the first one that would not decode,
  // leaving everything before it on disk, so following the advice wrote those
  // a second time under fresh numbers and the retry duplicated half the day.
  //
  // Staged beside the trip rather than inside `media/`, because
  // `resolveMediaFile` resolves URLs into that directory and a half-written
  // batch should not be fetchable while it is being written. Same filesystem,
  // so the moves at the end are renames.
  const staging = fs.mkdtempSync(path.join(tripDir(ref), ".staging-"));
  const staged: { from: string; to: string }[] = [];
  const items: GalleryItem[] = [];
  const originals: KeptOriginal[] = [];
  let index = nextIndex(mediaOut);

  /** Give up, leaving the trip exactly as it was. */
  const abandon = (problems: Problem[]): UploadResult => {
    fs.rmSync(staging, { recursive: true, force: true });
    return { ok: false, problems };
  };

  try {
    for (const upload of uploads) {
      const stem = String(index).padStart(2, "0");
      // sharp reads a path, not a buffer, for the HEIC fallback path — so the
      // bytes land on disk first and are decoded from there. That also means
      // the original survives a failure to make a derivative.
      const kept = path.join(staging, `orig-${stem}${path.extname(upload.filename).toLowerCase()}`);
      fs.writeFileSync(kept, upload.bytes);
      staged.push({ from: kept, to: path.join(originalsOut, path.basename(kept).slice(5)) });

      if (kindOf(upload.filename) === "video") {
        // Transcoded rather than served as sent: a phone's clip is HEVC in a
        // MOV that a lot of browsers will not play, often with GPS in its
        // metadata. `transcodeVideo` is the same one ingest uses — h264 in an
        // MP4, faststart, metadata dropped — so both doors produce the same
        // thing.
        const probe = probeVideo(kept);
        if (!probe) {
          return abandon([
            {
              field: `${upload.filename}.format`,
              got: "something ffprobe could not read as video",
              expected: "a readable mp4, mov or webm",
            },
          ]);
        }
        if (probe.durationSeconds > limits.videoSeconds) {
          return abandon([
            {
              field: `${upload.filename}.duration`,
              got: `${probe.durationSeconds.toFixed(0)}s`,
              expected: `at most ${limits.videoSeconds}s — trim it first`,
            },
          ]);
        }

        const name = `${stem}.mp4`;
        const poster = `${stem}-poster.jpg`;
        const result = transcodeVideo(kept, path.join(staging, name), {
          maxSeconds: limits.videoSeconds,
        });
        fs.writeFileSync(path.join(staging, poster), result.poster);
        staged.push(
          { from: path.join(staging, name), to: path.join(mediaOut, name) },
          { from: path.join(staging, poster), to: path.join(mediaOut, poster) },
        );
        items.push({
          src: frontmatterSrc(tripId, path.join(slug, name)),
          type: "video",
          width: result.width,
          height: result.height,
          poster: frontmatterSrc(tripId, path.join(slug, poster)),
        });
        index += 1;
        continue;
      }

      // Decoding is where a file that merely *claims* to be an image gives up,
      // and it throws. Uncaught, that reached the route as a bare 500 with an
      // empty body — nothing for an agent to act on.
      let source;
      try {
        source = await decodeSource(kept);
      } catch {
        return abandon([
          {
            field: `${upload.filename}.format`,
            got: "something that could not be decoded as an image",
            expected: `a readable ${IMAGE_FORMATS.join(", ")} file`,
          },
        ]);
      }

      try {
        // Measured from the decoded source rather than from `upload.bytes`,
        // because a HEIC's own header is not something sharp can always read —
        // `decodeSource` is what guarantees a file with legible dimensions.
        // These are the *original's* pixels; the derivative's are below.
        const original = await sharp(source.file).metadata();
        const derivative = await makeDerivative(source);
        const name = `${stem}${extensionFor(derivative.format)}`;
        fs.writeFileSync(path.join(staging, name), derivative.bytes);
        staged.push({ from: path.join(staging, name), to: path.join(mediaOut, name) });
        items.push({
          // Trip-relative, never `/<user>/media/…`: the owner is prefixed at
          // read time, which is what let the move to multi-user rewrite no
          // entry file.
          src: frontmatterSrc(tripId, path.join(slug, name)),
          type: "image",
          width: derivative.width,
          height: derivative.height,
        });
        originals.push({
          filename: upload.filename,
          bytes: upload.bytes.byteLength,
          width: original.width,
          height: original.height,
        });
      } finally {
        source.dispose();
      }
      index += 1;
    }

    fs.mkdirSync(mediaOut, { recursive: true });
    fs.mkdirSync(originalsOut, { recursive: true });
    for (const { from, to } of staged) fs.renameSync(from, to);
  } catch (error) {
    // Anything unforeseen — a transcode that dies, a full disk — leaves the
    // trip untouched rather than half-written.
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }

  return { ok: true, items, kept: originals };
}

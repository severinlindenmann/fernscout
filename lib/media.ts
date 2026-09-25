import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { contentRoot } from "./contentRoot";
import { parseTripRef, tripDir } from "./trips";
import { IMAGE_MAX_PIXELS } from "./validate/media";

/**
 * Where a trip's media lives and how it is addressed.
 *
 * Files sit inside the trip they belong to — `content/trips/<id>/media/…` —
 * so a trip is one self-contained directory that can be copied, archived or
 * handed to someone else. The *URL* shape (`/media/<id>/…`) is unchanged from
 * when these files lived in `public/`, which is why no entry frontmatter had
 * to be rewritten for the move.
 *
 * Everything that reads or addresses media goes through here, so swapping the
 * VPS disk for object storage later is a change to this module rather than a
 * hunt through the codebase.
 */

/** URL prefix under which media is served. */
const MEDIA_URL_PREFIX = "/media";

/** The directory holding one trip's media. */
export function tripMediaDir(ref: string): string {
  return path.join(tripDir(ref), "media");
}

/**
 * Where a trip's per-photograph sidecars live — B1863.
 *
 * A sibling of `media/`, for exactly the reason `tripOriginalsDir` below is
 * one: `resolveMediaFile` resolves every `/media/…` request under
 * `tripMediaDir` and refuses anything that escapes it, so nothing in here is
 * reachable by URL.
 *
 * They used to sit *inside* `media/`, beside the derivative they describe,
 * and the route served them to anybody — including for a photograph it
 * correctly refused, since a sidecar is in no gallery and so matched no
 * label. The uploader's original filename and the caption of a `private`
 * photograph were a guessable URL away. Moving them out closes it by
 * construction rather than with a fourth filter on a route that has already
 * been wrong three times, and it is what makes any future enrichment of this
 * file (camera, coordinates, faces) safe by default.
 */
export function tripMetaDir(ref: string): string {
  return path.join(tripDir(ref), "meta");
}

/** The sidecar for one media file, addressed by that file's path relative to
 * the trip's `media/` root: `meta/<day>/<name>.jpg.meta.json`. */
export function tripSidecarPath(ref: string, relPath: string): string {
  return path.join(tripMetaDir(ref), `${relPath}.meta.json`);
}

/**
 * Where a trip's untouched source files are kept.
 *
 * A sibling of `media/`, not a child, and that is the whole security design:
 * `resolveMediaFile` below resolves every `/media/…` request under
 * `tripMediaDir` and refuses anything that escapes it, so nothing in here is
 * reachable by URL. No route serves it and none should.
 *
 * It exists because a derivative is not a source. Ingest writes one image at
 * 2000px on the longest edge and, until now, dropped what it was made from —
 * but a full-page photobook plate at 300 dpi wants roughly 2500×3500, so the
 * one artefact the print pipeline needs was the one being thrown away, and it
 * cannot be recovered later.
 *
 * `MEDIA_ORIGINALS_DIR` moves the whole lot somewhere else — another disk,
 * usually — for anyone whose content directory should stay small. The default
 * keeps them with the trip they belong to, gitignored, because a feature that
 * needs configuring before it works is a feature most people never get.
 */
export function tripOriginalsDir(ref: string): string {
  const configured = mediaOriginalsRoot();
  const parsed = parseTripRef(ref);
  if (configured && parsed) {
    return path.join(configured, parsed.username, parsed.tripId);
  }
  return path.join(tripDir(ref), "originals");
}

/**
 * Where `MEDIA_ORIGINALS_DIR` points, absolute, or null when it is unset.
 *
 * Its own function because a second caller needs the *root* rather than one
 * trip's directory under it: the photobook plan writes a path outside the
 * content root relative to this, so the string it records does not depend on
 * how far apart the two directories happen to sit (B210).
 */
export function mediaOriginalsRoot(): string | null {
  const configured = process.env.MEDIA_ORIGINALS_DIR?.trim();
  return configured ? path.resolve(configured) : null;
}

/** Public URL for a file inside a trip's media directory. */
export function mediaUrl(ref: string, relativePath: string): string {
  const clean = relativePath.replace(/^\/+/, "");
  const parsed = parseTripRef(ref);
  if (!parsed) return `${MEDIA_URL_PREFIX}/${clean}`;
  return `/${parsed.username}${MEDIA_URL_PREFIX}/${parsed.tripId}/${clean}`;
}

/** `name`, folded the way two spellings of one file are the same file — see
 * `resolveMediaFile`'s case-insensitive fallback. */
const foldedName = (name: string) => name.normalize("NFC").toLowerCase();

/**
 * Walks `rest` under `root` one segment at a time, matching each against the
 * directory's actual entries case-folded and NFC-normalised, rather than
 * assuming the filesystem will.
 *
 * Exists because a case-sensitive volume (most production Linux disks; a
 * developer's own Mac is not one) refuses `03.JPG` for a file written as
 * `03.jpg` — and frontmatter and disk can disagree on case for the same
 * reason `findOriginal` in `paid/photobook/lib/photobook/source.ts` has to: ingest and a
 * hand-typed `gallery:` entry do not always spell a name the same way. Tried
 * only after an exact match has already failed, so the common case pays
 * nothing for it.
 */
function foldedWalk(root: string, rest: string[]): string | null {
  let dir = root;
  for (const segment of rest) {
    const wanted = foldedName(segment);
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return null;
    }
    const match = entries.find((e) => foldedName(e) === wanted);
    if (!match) return null;
    dir = path.join(dir, match);
  }
  return dir;
}

/**
 * Whether `file` is *really* inside `root` — B1878.
 *
 * The lexical check in `resolveMediaFile` compares strings, which a symlink
 * inside the media directory satisfies while pointing anywhere at all: the
 * path stays under the root, and `statSync` follows the link and reports a
 * file. Nothing in Fernscout creates such a link, but the content folder is
 * one people edit by hand and sync between machines, and sync tools do.
 *
 * Both sides are resolved, not only the target: a content root reached
 * through a symlink (`/tmp` on macOS is one) would otherwise make every real
 * path look like an escape. Anything that cannot be resolved — a dangling
 * link, a race with a delete — is refused, which is the same 404 every other
 * failure here produces.
 */
function reallyInside(root: string, file: string): boolean {
  let realRoot: string;
  let realFile: string;
  try {
    realRoot = fs.realpathSync(root);
    realFile = fs.realpathSync(file);
  } catch {
    return false;
  }
  return realFile === realRoot || realFile.startsWith(realRoot + path.sep);
}

/**
 * Resolve a `/media/...` request path to a file on disk, or null.
 *
 * Returns null rather than throwing for anything suspicious: a path that
 * escapes the content root, a missing file, or a directory. Callers turn that
 * into a 404, which is also the right answer for a traversal attempt — it
 * tells a prober nothing.
 */
export function resolveMediaFile(username: string, segments: string[]): string | null {
  return resolveMedia(username, segments)?.file ?? null;
}

/**
 * `resolveMediaFile`, with the `stat` it already had to take to answer.
 *
 * The media route used to resolve a file and then stat it three more times —
 * for its `ETag`, for the resize's cache key, and for `Content-Length` — on
 * the path of every thumbnail in every grid. One stat, handed along, is the
 * same answer: all four were asking about the same file within one request,
 * and a file replaced between them would only have made them disagree with
 * each other.
 */
export function resolveMedia(
  username: string,
  segments: string[],
): { file: string; stat: fs.Stats } | null {
  if (segments.length < 2) return null;
  // A leading dot is bookkeeping, never content — `.fingerprints/`, a
  // `.DS_Store`, an `.ingest.json`. `lib/exportZip.ts` already refuses every
  // such segment when packaging a trip; this refuses them over HTTP, and it
  // subsumes `.` and `..` (B1863).
  if (segments.some((s) => s === "" || s.startsWith(".") || s.includes("\0"))) {
    return null;
  }

  const [tripId, ...rest] = segments;
  const root = path.resolve(tripMediaDir(`${username}/${tripId}`));
  let target = path.resolve(root, ...rest);

  // Belt and braces: even with the segment check above, confirm the resolved
  // path is still inside the trip's media directory. Lexical, and first,
  // because it costs nothing — a traversal attempt is refused before this
  // process touches the disk at all. The real path is checked once a file
  // has actually been found, below.
  if (target !== root && !target.startsWith(root + path.sep)) return null;

  let stat: fs.Stats | undefined;
  try {
    stat = fs.statSync(target);
  } catch {
    // Fall through to the case-folded walk below.
  }

  if (!stat) {
    const folded = foldedWalk(root, rest);
    if (!folded) return null;
    target = folded;
    try {
      stat = fs.statSync(target);
    } catch {
      return null;
    }
  }

  // And the same containment question asked of the filesystem rather than of
  // the string — B1878. After the case-folded walk as well as after the
  // direct hit: either can land on a link, and either way the answer is the
  // file this request actually gets.
  return stat.isFile() && reallyInside(root, target) ? { file: target, stat } : null;
}

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
};

/**
 * The media type this file is served as — and `application/octet-stream` is
 * not one of them. It means "not a media type this route serves", and the
 * media route refuses such a file rather than handing over bytes it cannot
 * name (B1863). Callers that only want a label for something already known
 * to be media are unaffected.
 */
export function contentTypeFor(file: string): string {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

/**
 * Whether this path names a clip rather than a photograph — B1885.
 *
 * Read off `CONTENT_TYPES` above rather than a second list of extensions:
 * the question "is this a video" and the question "what do we serve it as"
 * have one answer, and two lists of extensions is how a format gets added to
 * one of them only. Takes a `src` as happily as a file path — both end in
 * the extension, which is the whole of what is read.
 */
export function isVideoSrc(src: string): boolean {
  return contentTypeFor(src).startsWith("video/");
}

/** Every media file in a trip, as URL paths. Used by tooling and tests. */
function listTripMedia(ref: string): string[] {
  const root = tripMediaDir(ref);
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push(mediaUrl(ref, path.relative(root, full)));
    }
  };
  walk(root);
  return out.sort();
}

/** Absolute path of the content root, for tooling that needs it. */
function mediaContentRoot(): string {
  return contentRoot();
}

/**
 * A web-sized copy of one photograph, made here rather than by Next.
 *
 * Everything served from this directory is behind a permission check, and
 * Next's image optimiser cannot pass one: it answers `/_next/image` by
 * re-fetching the source through a mocked request carrying no cookies, so our
 * route sees a stranger, returns 404, and the optimiser reports 400. Nobody
 * could see the photographs on their own private trip.
 *
 * Ingest already writes a 2000px derivative, which is the right *source* and
 * far too much for a thumbnail — a grid of twelve is twelve full-size
 * downloads on whatever connection the reader has. So: resize on first ask,
 * keep the answer.
 *
 * The cache is deliberately outside `media/`. `resolveMediaFile` maps a URL
 * into a trip's media directory, so a cache kept in there would be reachable
 * by guessing its path — and it holds copies of pictures whose whole point is
 * that not everyone may fetch them. This sits under the content root's own
 * `.cache/`, which no route resolves into.
 *
 * Returns null if the file is not something sharp can resize (a video, an SVG
 * placeholder), which the caller reads as "serve the original".
 */
const RESIZABLE = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif"]);

/**
 * What identifies one *representation* of a media file: the path it was
 * reached by, the state of the bytes behind it, and the width being served.
 *
 * mtime and size rather than a digest of the content, because this is on the
 * path of every media request and hashing a 200 MB clip to answer one is the
 * cost being avoided rather than paid. The pair moves whenever a file is
 * written, which is the case that matters — ingest gives a changed photograph
 * a new name, so an in-place replacement is the rare hand-edit and this still
 * notices it.
 *
 * `width` is part of it because one file is served at nine of them plus the
 * original, and they are different bytes. `0` is the unresized answer; the
 * allow-list in `lib/mediaSizes.ts` starts at 160, so it can never collide
 * with a real width.
 *
 * Two callers, deliberately one function — B1730. `resizedCopy` names its
 * disk cache with this and the media route sends it as an `ETag`, and the two
 * drifting apart would mean a cached derivative served under a validator
 * describing different bytes.
 */
function representationKey(file: string, source: fs.Stats, width: number): string {
  return crypto
    .createHash("sha256")
    .update(`${file}:${source.mtimeMs}:${source.size}:${width}`)
    .digest("hex")
    .slice(0, 32);
}

/**
 * That key as a strong `ETag`, quoted and ready to send — or null when the
 * file cannot be stat'd, which the caller reads as "send no validator" rather
 * than as an error. B1730.
 *
 * Strong, not weak (`W/`), because it identifies the bytes exactly: two
 * responses carrying the same value here are byte-identical, and a client may
 * use it for a range request as well as for revalidation.
 */
export function mediaEtag(file: string, width: number | null, stat?: fs.Stats): string | null {
  let source: fs.Stats;
  try {
    source = stat ?? fs.statSync(file);
  } catch {
    return null;
  }
  return `"${representationKey(file, source, width ?? 0)}"`;
}

/**
 * Remove the web-sized copies `resizedCopy` cached for a photograph — B2259,
 * when a deleted day is purged. `servedAs` is the path the media route
 * resolved it at (what the cache key names); `bytesAt` is where the file is
 * now, whose mtime and size are unchanged by the move into trash.
 */
export function forgetDerivatives(servedAs: string, bytesAt: string, widths: readonly number[]): void {
  let source: fs.Stats;
  try {
    source = fs.statSync(bytesAt);
  } catch {
    return;
  }
  for (const width of widths) {
    const key = representationKey(servedAs, source, width);
    fs.rmSync(path.join(contentRoot(), ".cache", "media", `${key}.webp`), { force: true });
  }
}

/**
 * One sized copy, as the media route hands it on: either already on disk —
 * an open handle, so a purge landing between "it is there" and the first
 * byte read cannot turn a 200 into a truncated body — or just made, in
 * memory, because the bytes are in hand and reading them back from the
 * file that was just written would be a second trip to the disk for
 * nothing.
 *
 * Whoever receives a `handle` owns it and has to close it; `resizedCopy`
 * reads and closes, the route streams it and lets the stream close it.
 */
export type Derivative =
  | { handle: fs.promises.FileHandle; size: number }
  | { bytes: Buffer; size: number };

/**
 * Whether a resize is for somebody waiting on it (`now`) or ahead of a page
 * nobody has opened yet (`later` — `warmDerivatives`).
 */
type ResizePriority = "now" | "later";

/**
 * How many resizes run at once — and the reason it is a small number is not
 * sharp.
 *
 * libvips already spreads one decode over every core, so running more of
 * them side by side buys almost nothing. What it does cost is libuv's thread
 * pool: sharp's work runs on it, and so does every `fs` call this server
 * makes, including the reads behind every photograph already sized and
 * cached. A cold gallery of thirty asked for thirty resizes at once, all four
 * pool threads went to sharp, and the cached thumbnail beside them waited for
 * a decode it had nothing to do with. Two leaves the pool room to answer.
 */
const RESIZE_CONCURRENCY = Math.max(1, Math.min(2, os.availableParallelism()));

type QueuedResize = { priority: ResizePriority; start: () => void };
const resizeQueue: QueuedResize[] = [];
let resizesRunning = 0;

function drainResizes(): void {
  while (resizesRunning < RESIZE_CONCURRENCY && resizeQueue.length > 0) {
    // Somebody waiting goes before a warm-up, whenever they arrived.
    const at = resizeQueue.findIndex((job) => job.priority === "now");
    const [job] = resizeQueue.splice(at === -1 ? 0 : at, 1);
    resizesRunning += 1;
    job.start();
  }
}

function queueResize<T>(priority: ResizePriority, task: () => Promise<T>): { done: Promise<T>; job: QueuedResize } {
  let job!: QueuedResize;
  const done = new Promise<T>((resolve, reject) => {
    job = {
      priority,
      start: () => {
        task()
          .then(resolve, reject)
          .finally(() => {
            resizesRunning -= 1;
            drainResizes();
          });
      },
    };
  });
  resizeQueue.push(job);
  drainResizes();
  return { done, job };
}

/**
 * Resizes being made right now, by the cache file they will land in.
 *
 * A grid, a service worker keeping the trip and a warm-up after the upload
 * can all ask for the same photograph at the same width within the same
 * second, and each used to decode it on its own and race the others to the
 * rename. The first ask makes it; the rest wait for that answer.
 */
const resizesInFlight = new Map<string, { done: Promise<Made>; job: QueuedResize }>();

/**
 * What one resize job settles with, shared by everybody who waited on it —
 * which is why it is never a file handle: one handle handed to three
 * responses is closed by the first of them under the other two. `on-disk`
 * sends each waiter to open its own.
 */
type Made = Buffer | "on-disk" | null;

/**
 * A copy of `file` at `width`, from the cache when there is one and made (at
 * most once at a time, and at most `RESIZE_CONCURRENCY` files at once) when
 * there is not. Null for anything sharp will not resize, which the caller
 * reads as "serve the original".
 *
 * `source` is the stat the caller already has — `resolveMedia` took one — so
 * the cache key is computed from the same answer the `ETag` was.
 */
export async function mediaDerivative(
  file: string,
  width: number,
  source?: fs.Stats,
  priority: ResizePriority = "now",
): Promise<Derivative | null> {
  if (!RESIZABLE.has(path.extname(file).toLowerCase())) return null;

  let stat: fs.Stats;
  try {
    stat = source ?? (await fs.promises.stat(file));
  } catch {
    return null;
  }

  // Keyed by the file's identity *and* its mtime and size, so replacing a
  // photograph in place cannot serve the old one at every width forever.
  const key = representationKey(file, stat, width);
  const cached = path.join(contentRoot(), ".cache", "media", `${key}.webp`);

  const hit = await openCached(cached);
  if (hit) return hit;

  let running = resizesInFlight.get(cached);
  if (running) {
    // A warm-up that somebody is now waiting on stops being a warm-up.
    if (priority === "now") running.job.priority = "now";
  } else {
    const queued = queueResize(priority, () => makeDerivative(file, cached, width));
    running = { job: queued.job, done: queued.done.finally(() => resizesInFlight.delete(cached)) };
    resizesInFlight.set(cached, running);
  }

  const made = await running.done;
  if (made === "on-disk") return openCached(cached);
  return made ? { bytes: made, size: made.byteLength } : null;
}

async function openCached(cached: string): Promise<Derivative | null> {
  let handle: fs.promises.FileHandle | undefined;
  try {
    handle = await fs.promises.open(cached, "r");
    const { size } = await handle.stat();
    return { handle, size };
  } catch {
    // Not made yet.
    await handle?.close().catch(() => {});
    return null;
  }
}

async function makeDerivative(file: string, cached: string, width: number): Promise<Made> {
  // Made while this one waited its turn — by another process, or by a job
  // for the same file that finished between the caller's look and now.
  try {
    await fs.promises.access(cached);
    return "on-disk";
  } catch {
    // Still not there: make it.
  }

  const sharp = (await import("sharp")).default;
  let bytes: Buffer;
  try {
    bytes = await sharp(file, { failOn: "error", limitInputPixels: IMAGE_MAX_PIXELS })
      .rotate()
      .resize(width, undefined, { withoutEnlargement: true })
      .keepIccProfile()
      .webp({ quality: 78 })
      .toBuffer();
  } catch {
    // A corrupt or unreadable image is still a file somebody uploaded; hand
    // back the original and let the browser decide what to do with it.
    return null;
  }

  try {
    await fs.promises.mkdir(path.dirname(cached), { recursive: true });
    // Written beside and renamed, so a reader in another process (or a second
    // server behind the same content folder) never sees a half-written file.
    // Within this one, `resizesInFlight` already means one writer per file.
    const partial = `${cached}.${process.pid}.partial`;
    await fs.promises.writeFile(partial, bytes);
    await fs.promises.rename(partial, cached);
  } catch {
    // An unwritable cache is a slow site, not a broken one.
  }
  return bytes;
}

/** `mediaDerivative`, as the bytes — for callers that want the whole copy in
 *  hand (a model, a letter) rather than a response body. */
export async function resizedCopy(file: string, width: number): Promise<Buffer | null> {
  const derivative = await mediaDerivative(file, width);
  if (!derivative) return null;
  if ("bytes" in derivative) return derivative.bytes;
  try {
    return await derivative.handle.readFile();
  } catch {
    return null;
  } finally {
    await derivative.handle.close().catch(() => {});
  }
}

/**
 * Makes the sizes a trip's grids will ask for, ahead of anybody asking —
 * called after an upload has landed, from `afterResponse`, so the first
 * person to open the gallery is not the one who waits for a decode per
 * photograph.
 *
 * Through `resolveMedia`, with the same segments a page's `src` will reach
 * the route by, because the cache is keyed by the path the route resolves:
 * a warm-up keyed any other way would fill the cache with copies nothing
 * ever reads. At `later` priority, so a reader asking for something now is
 * never queued behind it.
 */
export async function warmDerivatives(
  username: string,
  srcs: readonly string[],
  widths: readonly number[],
): Promise<void> {
  for (const src of srcs) {
    // A stored `src` is trip-relative, `/media/<trip>/<day>/<name>` — the
    // route sees the same segments once the owner is prefixed.
    const segments = src.replace(/^\/media\//, "").split("/");
    const found = resolveMedia(username, segments);
    if (!found) continue;
    for (const width of widths) {
      const made = await mediaDerivative(found.file, width, found.stat, "later");
      if (made && "handle" in made) await made.handle.close().catch(() => {});
      // Something sharp will not decode fails at every width alike.
      if (!made) break;
    }
  }
}

/**
 * The same resize `resizedCopy` does, for bytes that were never written to
 * disk at all — B1517: a freshly uploaded photograph handed straight to a
 * model has nowhere to be cached from and nothing worth caching, since the
 * whole point is that it is read once and dropped, not kept.
 *
 * Returns null on anything sharp cannot decode, the same as `resizedCopy`.
 */
export async function resizedBuffer(bytes: Buffer, width: number): Promise<Buffer | null> {
  const sharp = (await import("sharp")).default;
  try {
    return await sharp(bytes, { failOn: "error", limitInputPixels: IMAGE_MAX_PIXELS })
      .rotate()
      .resize(width, undefined, { withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer();
  } catch {
    return null;
  }
}

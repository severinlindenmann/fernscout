import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { contentRoot } from "./contentRoot";
import { parseTripRef, tripDir } from "./trips";

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
export const MEDIA_URL_PREFIX = "/media";

/** The directory holding one trip's media. */
export function tripMediaDir(ref: string): string {
  return path.join(tripDir(ref), "media");
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

/**
 * Resolve a `/media/...` request path to a file on disk, or null.
 *
 * Returns null rather than throwing for anything suspicious: a path that
 * escapes the content root, a missing file, or a directory. Callers turn that
 * into a 404, which is also the right answer for a traversal attempt — it
 * tells a prober nothing.
 */
export function resolveMediaFile(username: string, segments: string[]): string | null {
  if (segments.length < 2) return null;
  if (segments.some((s) => s === "" || s === "." || s === ".." || s.includes("\0"))) {
    return null;
  }

  const [tripId, ...rest] = segments;
  const root = path.resolve(tripMediaDir(`${username}/${tripId}`));
  const target = path.resolve(root, ...rest);

  // Belt and braces: even with the segment check above, confirm the resolved
  // path is still inside the trip's media directory.
  if (target !== root && !target.startsWith(root + path.sep)) return null;

  let stat: fs.Stats;
  try {
    stat = fs.statSync(target);
  } catch {
    return null;
  }
  return stat.isFile() ? target : null;
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

export function contentTypeFor(file: string): string {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

/** Every media file in a trip, as URL paths. Used by tooling and tests. */
export function listTripMedia(ref: string): string[] {
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
export function mediaContentRoot(): string {
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

export async function resizedCopy(file: string, width: number): Promise<Buffer | null> {
  if (!RESIZABLE.has(path.extname(file).toLowerCase())) return null;

  let source: fs.Stats;
  try {
    source = fs.statSync(file);
  } catch {
    return null;
  }

  // Keyed by the file's identity *and* its mtime and size, so replacing a
  // photograph in place cannot serve the old one at every width forever.
  const key = crypto
    .createHash("sha256")
    .update(`${file}:${source.mtimeMs}:${source.size}:${width}`)
    .digest("hex")
    .slice(0, 32);
  const cached = path.join(contentRoot(), ".cache", "media", `${key}.webp`);

  try {
    return fs.readFileSync(cached);
  } catch {
    // Not made yet.
  }

  const sharp = (await import("sharp")).default;
  let bytes: Buffer;
  try {
    bytes = await sharp(file, { failOn: "error" })
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
    fs.mkdirSync(path.dirname(cached), { recursive: true });
    // Written beside and renamed, so two requests for the same width racing
    // each other cannot leave a half-written file for the third to read.
    const partial = `${cached}.${process.pid}.partial`;
    fs.writeFileSync(partial, bytes);
    fs.renameSync(partial, cached);
  } catch {
    // An unwritable cache is a slow site, not a broken one.
  }
  return bytes;
}

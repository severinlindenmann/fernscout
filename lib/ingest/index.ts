/**
 * The ingest pipeline: a folder of camera files in, an editable entry out.
 *
 * The measure of this module is a stopwatch, not a feature list. If writing up
 * a day costs more than about ten minutes the blog is abandoned by month two,
 * so every decision here is made in favour of "the author edits prose" over
 * "the author makes choices":
 *
 *   scan → analyse (EXIF + perceptual hash) → drop duplicates → cluster
 *        → geocode → derivatives → markdown → ledger
 *
 * Nothing in the chain asks a question. Wrong guesses are cheap to fix in the
 * markdown afterwards; a prompt for every photograph is not.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fromDate, readExif, wallClockMs, type ExifData } from "./exif.ts";
import { clusterMedia, fillMissingCoordinates } from "./cluster.ts";
import { distanceKm, geodataAvailable, reverseGeocode, type Place } from "./geo.ts";
import {
  DUPLICATE_THRESHOLD,
  contentHash,
  hammingDistance,
  sampledFileHash,
} from "./hash.ts";
import {
  IMAGE_EXTENSIONS,
  decodeSource,
  extensionFor,
  makeDerivative,
  perceptualHash,
  sourceLongestEdge,
  type DecodedSource,
  type DerivativeFormat,
} from "./image.ts";
import {
  MAX_SECONDS,
  VIDEO_EXTENSIONS,
  probeVideo,
  transcodeVideo,
  videoToolsAvailable,
  FFMPEG_MISSING_MESSAGE,
} from "./video.ts";
import {
  BODY_PLACEHOLDER,
  appendGallery,
  entryFileName,
  partOfDay,
  renderEntry,
  type IngestGalleryItem,
} from "./entry.ts";
import { slugify } from "../slug.ts";
import {
  ID_PATTERN,
  entriesDir,
  frontmatterSrc,
  manifestFile,
  mediaDir,
  tripDir,
} from "./paths.ts";
import { validateEntry } from "../validate/entry.ts";
import { MAX_ITEMS_PER_DAY, validateMediaItem, type Problem as MediaProblem } from "../validate/media.ts";
import { tripOriginalsDir } from "../media.ts";
import { forgetEntries } from "../entries.ts";

export type IngestOptions = {
  username: string;
  tripId: string;
  /** Folder to import. Scanned recursively. */
  source: string;
  /** Work everything out and write nothing. */
  dryRun?: boolean;
  /** Import files the ledger has already seen. */
  force?: boolean;
  gapHours?: number;
  splitKm?: number;
  maxEdge?: number;
  format?: DerivativeFormat;
  quality?: number;
  maxVideoSeconds?: number;
  /** Tags added to every entry this run creates. */
  tags?: string[];
  onProgress?: (message: string) => void;
};

export type IngestedEntry = {
  /** Path of the markdown file, ready to show a person — see `displayPath`. */
  file: string;
  created: boolean;
  date: string;
  location: string;
  mediaCount: number;
};

export type IngestResult = {
  entries: IngestedEntry[];
  skipped: { file: string; reason: string }[];
  failed: { file: string; reason: string }[];
  /** Files that produced a derivative this run. */
  imported: number;
  warnings: string[];
  elapsedMs: number;
};

// ---------------------------------------------------------------------------
// The ledger
// ---------------------------------------------------------------------------

type LedgerRecord = {
  /** Basename of the file that was imported, for the human reading the file. */
  source: string;
  /** Truncated SHA-256 of the original bytes. */
  sha: string;
  /** Difference hash, absent for video. */
  phash?: string;
  media: string;
  entry: string;
  importedAt: string;
};

type Ledger = { version: 1; imports: LedgerRecord[] };

function readLedger(username: string, tripId: string): Ledger {
  const file = manifestFile(username, tripId);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Ledger;
    if (Array.isArray(parsed?.imports)) return { version: 1, imports: parsed.imports };
  } catch {
    // No ledger yet, or one somebody has broken by hand. Either way the worst
    // case is re-importing photos that are already there, which is visible and
    // fixable — refusing to run would not be.
  }
  return { version: 1, imports: [] };
}

function writeLedger(username: string, tripId: string, ledger: Ledger): void {
  fs.writeFileSync(manifestFile(username, tripId), `${JSON.stringify(ledger, null, 2)}\n`);
}

// ---------------------------------------------------------------------------
// Scanning and analysis
// ---------------------------------------------------------------------------

type SourceFile = { file: string; kind: "image" | "video" };

function scan(dir: string): { media: SourceFile[]; notes: string[] } {
  const media: SourceFile[] = [];
  const notes: string[] = [];

  const walk = (at: string) => {
    for (const entry of fs.readdirSync(at, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      // Apple's sidecar folders and dotfiles are never content.
      if (entry.name.startsWith(".")) continue;
      const full = path.join(at, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (IMAGE_EXTENSIONS.has(ext)) media.push({ file: full, kind: "image" });
      else if (VIDEO_EXTENSIONS.has(ext)) media.push({ file: full, kind: "video" });
      else if (ext === ".md" || ext === ".txt") notes.push(full);
    }
  };

  walk(dir);
  return { media, notes };
}

type Analysed = {
  file: string;
  kind: "image" | "video";
  sha: string;
  phash?: string;
  exif: ExifData;
  takenAtMs: number;
  lat?: number;
  lng?: number;
  /** Held open so the HEIC conversion is done once, not twice. */
  decoded?: DecodedSource;
};

/**
 * Runs `worker` over `items` a few at a time.
 *
 * sharp releases the event loop while libvips works, so a small pool turns a
 * folder of thirty photos from serial seconds into parallel ones. It is
 * deliberately not unbounded: each in-flight decode holds a full-resolution
 * bitmap, and thirty of those at once is gigabytes.
 */
async function pooled<T, R>(
  items: T[],
  worker: (item: T, index: number) => Promise<R>,
  size = Math.max(2, Math.min(8, os.cpus().length)),
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      for (let i = next++; i < items.length; i = next++) {
        results[i] = await worker(items[i], i);
      }
    }),
  );
  return results;
}

/** A media file over one of the hard limits in lib/validate/media.ts. Thrown
 * rather than silently skipped so it lands in the run's `failed` list next to
 * whatever else went wrong with a file — the existing `pooled()` catch below
 * already turns any `analyse` throw into exactly that. */
export class MediaLimitError extends Error {
  constructor(problems: MediaProblem[]) {
    super(problems.map((p) => `${p.field} — got ${p.got}, expected ${p.expected}`).join("; "));
    this.name = "MediaLimitError";
  }
}

async function analyse(source: SourceFile): Promise<Analysed> {
  const stat = fs.statSync(source.file);
  const bytes = source.kind === "image" ? new Uint8Array(fs.readFileSync(source.file)) : null;
  const exif = bytes ? readExif(bytes) : {};
  // Read once and shared below: probing is the only way to get a video's
  // capture time when the container has no EXIF-equivalent, and it is also
  // the only way to get its duration for the length check.
  const probe = source.kind === "video" ? probeVideo(source.file) : null;

  // A file with no capture time still has to land somewhere sensible. mtime is
  // usually close enough for anything straight off a card, and always beats
  // dropping the file or putting it on today's date.
  const takenAt = exif.takenAt ?? probe?.takenAt ?? fromDate(stat.mtime);

  const sha = bytes ? contentHash(bytes) : sampledFileHash(source.file);
  const name = path.basename(source.file);

  // Bytes on disk are known without opening the file, so this is checked
  // before decodeSource — a 300 MB HEIC is rejected in milliseconds rather
  // than after the (possibly external, always slower) HEIC conversion runs.
  const sizeProblems = validateMediaItem({ name, kind: source.kind, bytes: stat.size });
  if (sizeProblems.length > 0) throw new MediaLimitError(sizeProblems);

  const analysed: Analysed = {
    file: source.file,
    kind: source.kind,
    sha,
    exif,
    takenAtMs: wallClockMs(takenAt),
    lat: exif.lat,
    lng: exif.lng,
  };

  if (source.kind === "image") {
    analysed.decoded = await decodeSource(source.file);
    analysed.phash = await perceptualHash(analysed.decoded);
    const longestEdge = await sourceLongestEdge(analysed.decoded);
    const dimensionProblems = validateMediaItem({ name, kind: "image", longestEdge });
    if (dimensionProblems.length > 0) {
      // Rejected after all — release the temp file a HEIC conversion may
      // have left behind rather than leaking it.
      analysed.decoded.dispose();
      throw new MediaLimitError(dimensionProblems);
    }
  } else {
    const durationProblems = validateMediaItem({ name, kind: "video", durationSeconds: probe?.durationSeconds });
    if (durationProblems.length > 0) throw new MediaLimitError(durationProblems);
  }

  return analysed;
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

/** A `2026-08-14.md` in the folder becomes that day's prose; anything else
 * becomes the prose of the first entry. Typing the day on your phone into a
 * text file and dropping it next to the photos is the fastest write-up there
 * is, so it is worth supporting. */
function readNotes(files: string[]): { byDate: Map<string, string>; loose: string } {
  const byDate = new Map<string, string>();
  const loose: string[] = [];
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8").trim();
    if (!text) continue;
    const dated = /^(\d{4}-\d{2}-\d{2})/.exec(path.basename(file));
    if (dated) byDate.set(dated[1], [byDate.get(dated[1]), text].filter(Boolean).join("\n\n"));
    else loose.push(text);
  }
  return { byDate, loose: loose.join("\n\n") };
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

/**
 * Guesses how you got from one stop to the next — but only when there is no
 * room to be wrong.
 *
 * A guess the author has to delete is worse than no guess, so this fires for
 * one case: a jump too far and too fast to be anything but a plane. Trains,
 * buses and cars overlap far too much in both distance and speed to call
 * apart from photograph timestamps.
 */
export function guessTransport(
  from: { lat?: number; lng?: number; takenAtMs: number },
  to: { lat?: number; lng?: number; takenAtMs: number },
): "flight" | undefined {
  if (from.lat === undefined || from.lng === undefined) return undefined;
  if (to.lat === undefined || to.lng === undefined) return undefined;
  const km = distanceKm(from.lat, from.lng, to.lat, to.lng);
  const hours = (to.takenAtMs - from.takenAtMs) / 3_600_000;
  if (km < 400 || hours <= 0) return undefined;
  return km / hours > 250 ? "flight" : undefined;
}

// ---------------------------------------------------------------------------
// The pipeline
// ---------------------------------------------------------------------------

export class IngestError extends Error {}

/** A path to show a person: relative when that is shorter and readable, and
 * absolute when the content directory lives outside the repo — which it does
 * on a server, where `../../../../..` helps nobody. */
function displayPath(file: string): string {
  const relative = path.relative(process.cwd(), file);
  return relative.startsWith("..") ? file : relative;
}

function nextIndex(dir: string): number {
  if (!fs.existsSync(dir)) return 1;
  let highest = 0;
  for (const name of fs.readdirSync(dir)) {
    const n = Number(/^(\d+)/.exec(name)?.[1] ?? NaN);
    if (Number.isFinite(n)) highest = Math.max(highest, n);
  }
  return highest + 1;
}

export async function ingest(options: IngestOptions): Promise<IngestResult> {
  const started = Date.now();
  const say = options.onProgress ?? (() => {});
  const { username, tripId } = options;

  if (!ID_PATTERN.test(username)) throw new IngestError(`"${username}" is not a valid username.`);
  if (!ID_PATTERN.test(tripId)) throw new IngestError(`"${tripId}" is not a valid trip id.`);

  const trip = tripDir(username, tripId);
  if (!fs.existsSync(path.join(trip, "trip.md"))) {
    throw new IngestError(
      `No trip at ${trip}.\n` +
        `  Ingest fills an existing trip; it does not invent one. Create\n` +
        `  ${path.join(trip, "trip.md")} with id/title/start/end first.`,
    );
  }
  if (!fs.existsSync(options.source) || !fs.statSync(options.source).isDirectory()) {
    throw new IngestError(`${options.source} is not a folder.`);
  }

  const warnings: string[] = [];
  const skipped: { file: string; reason: string }[] = [];
  const failed: { file: string; reason: string }[] = [];

  const { media, notes } = scan(options.source);
  if (media.length === 0) throw new IngestError(`No photos or videos found in ${options.source}.`);
  say(`Found ${media.length} file(s).`);

  const hasVideo = media.some((m) => m.kind === "video");
  const canVideo = hasVideo && videoToolsAvailable();
  if (hasVideo && !canVideo) warnings.push(FFMPEG_MISSING_MESSAGE);

  const ledger = readLedger(username, tripId);
  const seenSha = new Set(ledger.imports.map((r) => r.sha));
  const seenPhash = ledger.imports.map((r) => r.phash).filter((h): h is string => !!h);

  // --- analyse ------------------------------------------------------------
  const analysed: Analysed[] = [];
  await pooled(media, async (source) => {
    if (source.kind === "video" && !canVideo) {
      skipped.push({ file: source.file, reason: "no ffmpeg" });
      return;
    }
    try {
      analysed.push(await analyse(source));
    } catch (err) {
      failed.push({ file: source.file, reason: (err as Error).message });
    }
  });
  say(`Read metadata from ${analysed.length} file(s).`);

  // --- dedupe -------------------------------------------------------------
  const fresh: Analysed[] = [];
  for (const item of analysed.sort((a, b) => a.file.localeCompare(b.file))) {
    if (!options.force) {
      if (seenSha.has(item.sha)) {
        skipped.push({ file: item.file, reason: "already imported" });
        item.decoded?.dispose();
        continue;
      }
      const near =
        item.phash && seenPhash.find((h) => hammingDistance(h, item.phash!) <= DUPLICATE_THRESHOLD);
      if (near) {
        skipped.push({ file: item.file, reason: "duplicate of a photo already in this trip" });
        item.decoded?.dispose();
        continue;
      }
    }
    // Also guard against the same photo appearing twice inside this one run.
    seenSha.add(item.sha);
    if (item.phash) seenPhash.push(item.phash);
    fresh.push(item);
  }

  if (fresh.length === 0) {
    for (const item of analysed) item.decoded?.dispose();
    say("Nothing new — every file in that folder is already in this trip.");
    return {
      entries: [],
      skipped,
      failed,
      imported: 0,
      warnings,
      elapsedMs: Date.now() - started,
    };
  }

  // --- cluster ------------------------------------------------------------
  const located = fillMissingCoordinates(fresh);
  const clusters = clusterMedia(located, {
    gapHours: options.gapHours,
    splitKm: options.splitKm,
  });
  say(`Grouped into ${clusters.length} entr${clusters.length === 1 ? "y" : "ies"}.`);

  if (!geodataAvailable()) {
    warnings.push(
      "No offline place index, so locations were left blank. Build it with: npm run build:geodata",
    );
  }

  const { byDate, loose } = readNotes(notes);
  const entriesOut = entriesDir(username, tripId);
  const mediaOut = mediaDir(username, tripId);
  const originals = tripOriginalsDir(`${username}/${tripId}`);
  const format = options.format ?? "jpeg";
  const extension = extensionFor(format);

  const results: IngestedEntry[] = [];
  const newRecords: LedgerRecord[] = [];
  // Geocode once per cluster: the lookup is cheap, but the name decides both
  // the entry's title and its filename, so it has to be the same answer twice.
  const places: (Place | null)[] = clusters.map((cluster) =>
    geodataAvailable() && cluster.lat !== undefined && cluster.lng !== undefined
      ? reverseGeocode(cluster.lat, cluster.lng)
      : null,
  );
  const usedSlugs = new Set<string>();
  let imported = 0;
  let previousStop: { lat?: number; lng?: number; takenAtMs: number; location: string } | undefined;

  for (const [clusterIndex, cluster] of clusters.entries()) {
    const first = cluster.items[0];
    const place = places[clusterIndex];
    const location = place?.name ?? "";
    const baseSlug = slugify(location || `day-${cluster.date}`);

    // One entry's gallery, capped — see docs/plans/W29-content-validation.md.
    // The excess stays on the memory card, not silently in the entry: each
    // one is named individually in `skipped` so a re-run with a tighter date
    // range (or two entries instead of one) is an informed choice, not a
    // mystery about where the rest of the photos went.
    const items =
      cluster.items.length > MAX_ITEMS_PER_DAY ? cluster.items.slice(0, MAX_ITEMS_PER_DAY) : cluster.items;
    for (const over of cluster.items.slice(MAX_ITEMS_PER_DAY)) {
      skipped.push({ file: over.file, reason: `over the ${MAX_ITEMS_PER_DAY}-item-per-day limit` });
      over.decoded?.dispose();
    }

    // An entry file that already exists is joined, not avoided — that is how
    // "I found six more photos from Tuesday" works. Only a collision inside
    // this one run needs a different name, because two stops in the same town
    // on the same day are two entries.
    const hour = new Date(first.takenAtMs).getUTCHours();
    let slug = baseSlug;
    if (usedSlugs.has(`${cluster.date}/${slug}`)) slug = `${baseSlug}-${partOfDay(hour)}`;
    for (let n = 2; usedSlugs.has(`${cluster.date}/${slug}`); n++) slug = `${baseSlug}-${n}`;
    usedSlugs.add(`${cluster.date}/${slug}`);

    const entryFile = path.join(entriesOut, entryFileName(cluster.date, slug));
    const exists = fs.existsSync(entryFile);
    const folder = path.join(mediaOut, slug);
    let index = nextIndex(folder);
    const digits = Math.max(2, String(index + items.length - 1).length);

    const gallery: IngestGalleryItem[] = [];

    for (const item of items) {
      const name = String(index).padStart(digits, "0");
      try {
        if (item.kind === "image") {
          const derivative = await makeDerivative(item.decoded!, {
            maxEdge: options.maxEdge,
            format,
            quality: options.quality,
          });
          const relative = path.join(slug, `${name}${extension}`);
          if (!options.dryRun) {
            fs.mkdirSync(folder, { recursive: true });
            fs.writeFileSync(path.join(mediaOut, relative), derivative.bytes);
          }
          gallery.push({
            src: frontmatterSrc(tripId, relative),
            type: "image",
            width: derivative.width,
            height: derivative.height,
          });
          newRecords.push({
            source: path.basename(item.file),
            sha: item.sha,
            phash: item.phash,
            media: frontmatterSrc(tripId, relative),
            entry: path.basename(entryFile),
            importedAt: new Date().toISOString(),
          });
        } else {
          const relative = path.join(slug, `${name}.mp4`);
          const posterRelative = path.join(slug, `${name}.jpg`);
          if (options.dryRun) {
            gallery.push({ src: frontmatterSrc(tripId, relative), type: "video" });
          } else {
            fs.mkdirSync(folder, { recursive: true });
            const clip = transcodeVideo(item.file, path.join(mediaOut, relative), {
              maxSeconds: options.maxVideoSeconds ?? MAX_SECONDS,
            });
            fs.writeFileSync(path.join(mediaOut, posterRelative), clip.poster);
            gallery.push({
              src: frontmatterSrc(tripId, relative),
              type: "video",
              poster: frontmatterSrc(tripId, posterRelative),
              width: clip.width,
              height: clip.height,
            });
          }
          newRecords.push({
            source: path.basename(item.file),
            sha: item.sha,
            media: frontmatterSrc(tripId, relative),
            entry: path.basename(entryFile),
            importedAt: new Date().toISOString(),
          });
        }
        imported += 1;
        index += 1;

        // The file exactly as it arrived, under the day it belongs to. Named
        // after the derivative rather than the camera, so the two line up when
        // the photobook goes looking for a better version of `01.jpg`.
        if (!options.dryRun) {
          const keep = path.join(originals, slug);
          fs.mkdirSync(keep, { recursive: true });
          fs.copyFileSync(
            item.file,
            path.join(keep, `${name}${path.extname(item.file).toLowerCase()}`),
          );
        }
      } catch (err) {
        failed.push({ file: item.file, reason: (err as Error).message });
      } finally {
        item.decoded?.dispose();
      }
    }

    if (gallery.length === 0) continue;

    const transport =
      previousStop && location
        ? guessTransport(previousStop, { lat: cluster.lat, lng: cluster.lng, takenAtMs: first.takenAtMs })
        : undefined;

    if (!options.dryRun) {
      fs.mkdirSync(entriesOut, { recursive: true });
      if (exists) {
        const merged = appendGallery(fs.readFileSync(entryFile, "utf8"), gallery);
        if (merged === null) {
          warnings.push(
            `${path.basename(entryFile)} has no frontmatter block, so the new photos were not ` +
              `added to it. They are on disk under media/${slug}/.`,
          );
        } else {
          fs.writeFileSync(entryFile, merged);
          // Ingest is a CLI, so its cache dies with the process — but it also
          // runs inside tests that read back what it wrote.
          forgetEntries(`${username}/${tripId}`);
        }
      } else {
        const time = new Date(first.takenAtMs);
        const timeOfDay = `${String(time.getUTCHours()).padStart(2, "0")}:${String(
          time.getUTCMinutes(),
        ).padStart(2, "0")}`;
        const body = byDate.get(cluster.date) ?? (clusterIndex === 0 ? loose : "");
        const resolvedTransport =
          transport && previousStop
            ? { mode: transport, from: previousStop.location, to: location }
            : undefined;

        // What ingest computed itself is checked too, not just what an agent
        // sends — a bad EXIF timestamp or a cluster that lost half its
        // coordinates is exactly the kind of thing this rule set exists to
        // catch. Non-fatal: the photos already imported, and a warning a
        // person can act on beats an entry that silently never gets written.
        const problems = validateEntry({
          date: cluster.date,
          time: timeOfDay,
          lat: cluster.lat,
          lng: cluster.lng,
          transportMode: resolvedTransport?.mode,
          tags: options.tags ?? [],
          // Validated post-placeholder: an entry with no notes yet is not an
          // empty entry, it is one waiting for the author's words.
          content: body.trim() || BODY_PLACEHOLDER,
        });
        if (problems.length > 0) {
          warnings.push(
            `${entryFileName(cluster.date, slug)}: ` +
              problems.map((p) => `${p.field} — got ${p.got}, expected ${p.expected}`).join("; "),
          );
        }

        fs.writeFileSync(
          entryFile,
          renderEntry({
            title: location || `Day ${cluster.date}`,
            date: cluster.date,
            time: timeOfDay,
            location,
            country: place?.country ?? "",
            countryCode: place?.countryCode,
            lat: cluster.lat,
            lng: cluster.lng,
            gallery,
            tags: options.tags ?? [],
            transport: resolvedTransport,
            body,
          }),
        );
      }
    }

    results.push({
      file: displayPath(entryFile),
      created: !exists,
      date: cluster.date,
      location,
      mediaCount: gallery.length,
    });

    if (location) {
      previousStop = {
        lat: cluster.lat,
        lng: cluster.lng,
        takenAtMs: items[items.length - 1].takenAtMs,
        location,
      };
    }
  }

  if (!options.dryRun && newRecords.length > 0) {
    ledger.imports.push(...newRecords);
    writeLedger(username, tripId, ledger);
  }

  return { entries: results, skipped, failed, imported, warnings, elapsedMs: Date.now() - started };
}

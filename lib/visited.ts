import "server-only";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { userDir } from "./users";
import { journalPath } from "./journalPath";
import { isOpenToApprovedGuest, isOpenToCloseCircle, isOpenToLink } from "./access";
import { isOwner, journalReader } from "./contacts/session";
import { loadUserConfig } from "./config";
import { mediaOriginalsRoot } from "./media";
import { withStorageQuota } from "./storageQuota";
import { validateMediaBatch, type Problem } from "./validate/media";
import { contentHash } from "./ingest/hash";
import { decodeSource, makeDerivative, printJpegFor, MAX_DECODE_PIXELS } from "./ingest/image";
import {
  VISITED_DEFAULT_VISIBILITY,
  isCountryCode,
  type VisitedCreate,
  type VisitedDoc,
  type VisitedPatch,
} from "./api/v2/schemas/visited";
import type { Trip, TripVisibility } from "./types";

/**
 * Countries visited without a trip — B2914.
 *
 * One JSON file per country, `content/<user>/visited/<CC>.json`, so adding a
 * country that is already there lands on the same file. Same family as
 * `lib/figures.ts`: journal-level content, fixed key order, no database.
 *
 * The one photograph goes through the ordinary image ingest
 * (`decodeSource`/`makeDerivative`/`printJpegFor`): a 2000px derivative is
 * served from `visited/media/<CC>/`, and the untouched original stays beside
 * it under `visited/originals/<CC>/` (or `MEDIA_ORIGINALS_DIR`) as the print
 * master. Neither folder is ever resolved from a URL — the serving route
 * (`app/at/[user]/visited-media`) names one file by entry and checks the
 * entry's own visibility first.
 */

export type VisitedEntry = {
  country: string;
  places?: string;
  year?: number;
  month?: number;
  note?: string;
  /** File name of the served derivative inside `visited/media/<CC>/`. */
  photo?: string;
  visibility: TripVisibility;
  created: string;
  updated: string;
};

function visitedDir(username: string): string {
  return path.join(userDir(username), "visited");
}

/** The code is validated against the map's country list before it is ever a
 * path, so nothing but two uppercase letters can reach the filesystem. */
function codeOf(code: string): string | null {
  return /^[A-Z]{2}$/.test(code) && isCountryCode(code) ? code : null;
}

function mediaDir(username: string, code: string): string {
  return path.join(visitedDir(username), "media", code);
}

function originalsDir(username: string, code: string): string {
  const root = mediaOriginalsRoot();
  return root ? path.join(root, username, "visited", code) : path.join(visitedDir(username), "originals", code);
}

function toJson(e: VisitedEntry): string {
  const data = {
    country: e.country,
    places: e.places,
    year: e.year,
    month: e.month,
    note: e.note,
    photo: e.photo,
    visibility: e.visibility,
    created: e.created,
    updated: e.updated,
  };
  return `${JSON.stringify(data, null, 2)}\n`;
}

function write(username: string, e: VisitedEntry): void {
  fs.mkdirSync(visitedDir(username), { recursive: true });
  fs.writeFileSync(path.join(visitedDir(username), `${e.country}.json`), toJson(e));
}

export function getVisit(username: string, rawCode: string): VisitedEntry | null {
  const code = codeOf(rawCode);
  if (!code) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(visitedDir(username), `${code}.json`), "utf8")) as VisitedEntry;
    return raw.country === code ? raw : null;
  } catch {
    return null;
  }
}

/** Every entry, by country code. Unfiltered — callers outside the owner's own
 * writes go through `visibleVisits`. */
export function listVisits(username: string): VisitedEntry[] {
  let names: string[];
  try {
    names = fs.readdirSync(visitedDir(username));
  } catch {
    return [];
  }
  return names
    .filter((n) => /^[A-Z]{2}\.json$/.test(n))
    .map((n) => getVisit(username, n.slice(0, 2)))
    .filter((e): e is VisitedEntry => e !== null)
    .sort((a, b) => a.country.localeCompare(b.country));
}

/** Adds a country. One already there is returned as it stands and nothing is
 * written — adding twice never duplicates or overwrites. */
export function addVisit(username: string, input: VisitedCreate): { entry: VisitedEntry; created: boolean } {
  const country = input.country.toUpperCase();
  const existing = getVisit(username, country);
  if (existing) return { entry: existing, created: false };
  const now = new Date().toISOString();
  const entry: VisitedEntry = {
    country,
    places: input.places,
    year: input.year,
    month: input.month,
    note: input.note,
    visibility: input.visibility ?? VISITED_DEFAULT_VISIBILITY,
    created: now,
    updated: now,
  };
  write(username, entry);
  return { entry, created: true };
}

/** `null` in the patch clears a field. Null when there is no such entry, or
 * when the result would be a month without a year. */
export function updateVisit(
  username: string,
  code: string,
  patch: VisitedPatch,
): VisitedEntry | null | "month_needs_year" {
  const current = getVisit(username, code);
  if (!current) return null;
  const next: VisitedEntry = { ...current, updated: new Date().toISOString() };
  for (const key of ["places", "year", "month", "note"] as const) {
    const v = patch[key];
    if (v === undefined) continue;
    if (v === null) delete next[key];
    else (next[key] as string | number) = v;
  }
  if (patch.visibility) next.visibility = patch.visibility;
  if (next.month !== undefined && next.year === undefined) return "month_needs_year";
  write(username, next);
  return next;
}

/** Removes the entry and its served photograph. The original is a print
 * master and is left where it is. */
export function deleteVisit(username: string, code: string): boolean {
  const entry = getVisit(username, code);
  if (!entry) return false;
  fs.rmSync(path.join(visitedDir(username), `${entry.country}.json`), { force: true });
  fs.rmSync(mediaDir(username, entry.country), { recursive: true, force: true });
  return true;
}

// ── photograph ──────────────────────────────────────────────────────────

const PHOTO_FILE_RE = /^[0-9a-f]{32}\.jpg$/;

export type VisitedPhotoResult =
  | { ok: true; entry: VisitedEntry }
  | { ok: false; error: "no_entry" }
  | { ok: false; error: "invalid_media"; problems: Problem[] }
  | { ok: false; error: "storage_full"; problem: string };

/**
 * Attach (or replace) the entry's one photograph — the same decode, derivative
 * and print-master steps a day's photograph takes (`storeTripPhoto`), filed
 * under the entry. A replaced photograph's derivative is dropped; every
 * original stays.
 */
export async function putVisitPhoto(
  username: string,
  rawCode: string,
  upload: { filename: string; bytes: Buffer },
): Promise<VisitedPhotoResult> {
  const entry = getVisit(username, rawCode);
  if (!entry) return { ok: false, error: "no_entry" };
  const code = entry.country;

  const limits = loadUserConfig(username).media;
  const originalExt = path.extname(upload.filename).toLowerCase();
  const problems = validateMediaBatch(
    [
      {
        name: upload.filename,
        kind: "image",
        format: originalExt.replace(".", "").replace("jpg", "jpeg"),
        bytes: upload.bytes.byteLength,
      },
    ],
    limits,
  );
  if (problems.length > 0) return { ok: false, error: "invalid_media", problems };

  const hash = contentHash(upload.bytes);
  const file = `${hash}.jpg`;
  const dir = mediaDir(username, code);
  const originals = originalsDir(username, code);

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-visited-"));
  try {
    const staged = path.join(scratch, `in${originalExt}`);
    fs.writeFileSync(staged, upload.bytes);
    let derivativeBytes: Buffer;
    let printJpeg: Awaited<ReturnType<typeof printJpegFor>> = null;
    let source;
    try {
      source = await decodeSource(staged);
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
      const edge = validateMediaBatch([{ name: upload.filename, kind: "image", longestEdge }], limits);
      if (edge.length > 0) return { ok: false, error: "invalid_media", problems: edge };
      derivativeBytes = (await makeDerivative(source)).bytes;
      printJpeg = await printJpegFor(source, `${hash}${originalExt}`);
    } finally {
      source.dispose();
    }

    const guard = await withStorageQuota(username, upload.bytes.byteLength + (printJpeg?.bytes.length ?? 0), () => {
      fs.mkdirSync(dir, { recursive: true });
      fs.mkdirSync(originals, { recursive: true });
      const original = path.join(originals, `${hash}${originalExt}`);
      if (!fs.existsSync(original)) fs.writeFileSync(original, upload.bytes);
      if (printJpeg) fs.writeFileSync(path.join(originals, printJpeg.name), printJpeg.bytes);
      fs.writeFileSync(path.join(dir, file), derivativeBytes);
      if (entry.photo && entry.photo !== file) fs.rmSync(path.join(dir, path.basename(entry.photo)), { force: true });
    });
    if (!guard.ok) return { ok: false, error: "storage_full", problem: guard.problem };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }

  const next = { ...entry, photo: file, updated: new Date().toISOString() };
  write(username, next);
  return { ok: true, entry: next };
}

/** Detach the photograph. The derivative goes; the original stays. */
export function removeVisitPhoto(username: string, rawCode: string): VisitedEntry | null {
  const entry = getVisit(username, rawCode);
  if (!entry) return null;
  if (entry.photo) fs.rmSync(path.join(mediaDir(username, entry.country), path.basename(entry.photo)), { force: true });
  const next = { ...entry, updated: new Date().toISOString() };
  delete next.photo;
  write(username, next);
  return next;
}

/** The served derivative's absolute path, only for the file this entry names
 * now — never a path built from the URL. */
export function visitPhotoFile(username: string, entry: VisitedEntry, file: string): string | null {
  if (!entry.photo || entry.photo !== file || !PHOTO_FILE_RE.test(file)) return null;
  const full = path.join(mediaDir(username, entry.country), file);
  return fs.existsSync(full) ? full : null;
}

// ── who may see what ────────────────────────────────────────────────────

/** Who is asking, in the three facts trips already branch on. */
export type VisitReader = { owner: boolean; guest: boolean; close: boolean };

/**
 * The reader of a rendered page or media request, from the browser cookie —
 * the same two lookups `mayReadTrip` makes (`isOwner`, `journalReader`).
 * Bearer tokens never come through here; an API route builds its own reader.
 */
export async function visitReader(username: string): Promise<VisitReader> {
  const owner = await isOwner(username);
  const { guest, close } = await journalReader(username);
  return { owner, guest, close };
}

/**
 * Whether this reader may see an entry of this visibility — `mayReadTrip`'s
 * own branch order, with the same predicates (`lib/access.ts`): the owner
 * sees everything; `public` is open to anyone; `guest` needs an approved
 * guest of the journal; `private` needs the close circle (B1749). Being signed
 * in proves nothing on its own.
 */
function admits(reader: VisitReader, visibility: TripVisibility): boolean {
  if (reader.owner) return true;
  const like = { visibility } as Trip;
  if (!reader.guest) return isOpenToLink(like);
  return reader.close ? isOpenToCloseCircle(like) : isOpenToApprovedGuest(like);
}

/** The entries this reader may see. Every consumer — page, map, counts, API,
 * media — reads only this list. */
export function visibleVisits(username: string, reader: VisitReader): VisitedEntry[] {
  return listVisits(username).filter((e) => admits(reader, e.visibility));
}

/** One entry, or null both when there is none and when it is not this
 * reader's to see — a refusal must not confirm the entry exists. */
export function visibleVisit(username: string, code: string, reader: VisitReader): VisitedEntry | null {
  const entry = getVisit(username, code);
  return entry && admits(reader, entry.visibility) ? entry : null;
}

/** The wire shape, with the photograph's served address. */
export function visitedDocOf(username: string, e: VisitedEntry): VisitedDoc {
  return {
    country: e.country,
    ...(e.places !== undefined ? { places: e.places } : {}),
    ...(e.year !== undefined ? { year: e.year } : {}),
    ...(e.month !== undefined ? { month: e.month } : {}),
    ...(e.note !== undefined ? { note: e.note } : {}),
    ...(e.photo ? { photo: { src: e.photo, url: `${journalPath(username)}/visited-media/${e.country}/${e.photo}` } } : {}),
    visibility: e.visibility,
    created: e.created,
    updated: e.updated,
  };
}

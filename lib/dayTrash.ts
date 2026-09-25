// Recently deleted days — B2259.
//
// Deleting a day from the studio moves it, whole, into the journal's own
// trash folder rather than removing it: the day file, its photographs, their
// kept originals, their sidecars and the fingerprint cache.
//
//   content/<user>/.trash/<trip>/<stem>--<stamp>/
//     trashed.json         { deletedAt, formerStatus, trip, stem, title, date, cover? }
//     day.json             the day file, rewritten as a draft
//     media/ meta/ originals/ fingerprints.json   whichever existed
//
// Why here: the leading dot is what keeps every reader away without a filter
// of its own. Readers, feed, search, sitemap and the v2 API read
// `trips/<trip>/…` only; the sync manifest skips every dot segment
// (`lib/sync/manifest.ts`); the export walks each trip's own folder
// (`lib/exportZip.ts`), so a deleted day is not exported; the media route
// resolves under `trips/<trip>/media/` only. Journal deletion removes the
// whole user folder, trash included; trip deletion removes that trip's trash
// (`lib/deletions.ts`). GPS history is never read or touched here.
//
// A deleted day is kept 30 days. `listTrash` purges anything older before it
// answers, and the studio hub and the "Recently deleted" page both call it —
// the purge is lazy, on studio load, with no timer of its own.
// ponytail: lazy purge; a journal whose owner never opens the studio keeps its
// trash (still invisible, still counted in storage) until they do. Hook
// `purgeTrash` to the nightly backup timer if that ever matters.
import "server-only";
import fs from "node:fs";
import path from "node:path";
import { contentRoot } from "./contentRoot";
import { MEDIA_WIDTHS } from "./mediaSizes";
import { forgetDerivatives, tripMediaDir, tripMetaDir, tripOriginalsDir } from "./media";
import { tripDir, tripRef } from "./trips";

export const TRASH_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

type TrashMeta = {
  deletedAt: string;
  formerStatus: "draft" | "published";
  trip: string;
  /** The day file's full stem, `YYYY-MM-DD-slug`. */
  stem: string;
  title: string;
  date: string;
  /** The trip's cover, when it was one of this day's photographs and was
   *  cleared with it; put back on restore if the trip still has none. */
  cover?: string;
};

export type TrashEntry = TrashMeta & { id: string; daysLeft: number };

type Fail = { ok: false; error: string; message: string };

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const safe = (value: string) => {
  if (!SEGMENT.test(value) || value.includes("..")) throw new Error(`unsafe path segment: ${JSON.stringify(value)}`);
  return value;
};

const bareOf = (stem: string) => stem.replace(/^\d{4}-\d{2}-\d{2}-/, "");

function trashRoot(user: string): string {
  return path.join(contentRoot(), safe(user), ".trash");
}

/** One trip's trash — also what `deleteTrip` removes with the trip. */
export function tripTrashDir(user: string, tripId: string): string {
  return path.join(trashRoot(user), safe(tripId));
}

/** `rename`, or copy-then-remove when the two sit on different disks
 *  (`MEDIA_ORIGINALS_DIR` may put originals on another one). */
function move(from: string, to: string): void {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    fs.renameSync(from, to);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err;
    try {
      fs.cpSync(from, to, { recursive: true, preserveTimestamps: true, errorOnExist: true, force: false });
    } catch (copyErr) {
      // A half-made copy must not be left behind: the source is still whole,
      // and a partial destination would block the retry (and the rollback).
      fs.rmSync(to, { recursive: true, force: true });
      throw copyErr;
    }
    fs.rmSync(from, { recursive: true, force: true });
  }
}

/** Every move is recorded; a failure puts back what already moved, newest
 *  first, so a failed delete or restore leaves the day exactly as it was. */
function moveAll(pairs: [string, string][]): { ok: true } | { ok: false; message: string } {
  const done: [string, string][] = [];
  try {
    for (const [from, to] of pairs) {
      if (fs.existsSync(to)) throw new Error(`${to} already exists`);
      move(from, to);
      done.push([from, to]);
    }
    return { ok: true };
  } catch (err) {
    for (const [from, to] of done.reverse()) {
      try {
        move(to, from);
      } catch {
        // Best effort; the error below names what failed.
      }
    }
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/** Where each piece of a day lives in its trip, and where it goes in trash. */
function pieces(user: string, tripId: string, stem: string, entryDir: string): [string, string][] {
  const ref = tripRef(user, tripId);
  const bare = bareOf(stem);
  return [
    [path.join(tripDir(ref), "entries", `${stem}.json`), path.join(entryDir, "day.json")],
    [path.join(tripMediaDir(ref), bare), path.join(entryDir, "media")],
    [path.join(tripMetaDir(ref), bare), path.join(entryDir, "meta")],
    [path.join(tripOriginalsDir(ref), bare), path.join(entryDir, "originals")],
    [path.join(tripDir(ref), ".fingerprints", `${bare}.json`), path.join(entryDir, "fingerprints.json")],
  ];
}

function readJsonFile(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Raw read-modify-write, so a key this code does not know survives (B1639). */
function editJson(file: string, edit: (doc: Record<string, unknown>) => void): void {
  const doc = readJsonFile(file);
  if (!doc) return;
  edit(doc);
  fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
}

function stampOf(now: Date): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

/** Media sources every *other* day of the trip uses inside this day's
 *  folder. Non-empty means deleting the folder would take another day's
 *  photographs, which is refused. */
function sharedMedia(user: string, tripId: string, stem: string): string[] {
  const entries = path.join(tripDir(tripRef(user, tripId)), "entries");
  const prefix = `/media/${tripId}/${bareOf(stem)}/`;
  let files: string[] = [];
  try {
    files = fs.readdirSync(entries).filter((f) => f.endsWith(".json") && f !== `${stem}.json`);
  } catch {
    return [];
  }
  return files.filter((f) => JSON.stringify(readJsonFile(path.join(entries, f))?.media ?? []).includes(prefix));
}

/**
 * Move one day into trash. The caller has already checked the owner, the
 * day's existence and the owner's consent to take a shared day down. The
 * trashed copy is always a draft, so a restore never re-publishes.
 */
export function trashDay(user: string, tripId: string, stem: string, now = new Date()): { ok: true; id: string } | Fail {
  const ref = tripRef(user, tripId);
  const dayFile = path.join(tripDir(ref), "entries", `${safe(stem)}.json`);
  const day = readJsonFile(dayFile);
  if (!day) return { ok: false, error: "unknown_day", message: "There is no such day." };

  const others = sharedMedia(user, tripId, stem);
  if (others.length > 0) {
    return {
      ok: false,
      error: "media_shared",
      message: `Another day uses photographs from this day's folder (${others.join(", ")}). Nothing was deleted.`,
    };
  }

  const id = `${stem}--${stampOf(now)}`;
  const entryDir = path.join(tripTrashDir(user, tripId), id);
  const moves = pieces(user, tripId, stem, entryDir).filter(([from]) => fs.existsSync(from));

  const tripFile = path.join(tripDir(ref), "trip.json");
  const cover = readJsonFile(tripFile)?.cover;
  const coverFromDay = typeof cover === "string" && cover.startsWith(`/media/${tripId}/${bareOf(stem)}/`);

  const meta: TrashMeta = {
    deletedAt: now.toISOString(),
    formerStatus: day.status === "published" ? "published" : "draft",
    trip: tripId,
    stem,
    title: typeof day.title === "string" ? day.title : "",
    date: typeof day.date === "string" ? day.date : stem.slice(0, 10),
    ...(coverFromDay ? { cover: cover as string } : {}),
  };

  const notDeleted = (why: unknown): Fail => {
    fs.rmSync(entryDir, { recursive: true, force: true });
    const message = why instanceof Error ? why.message : String(why);
    return { ok: false, error: "not_deleted", message: `The day could not be moved (${message}). Nothing was deleted.` };
  };
  // The stamp first, so no step after the moves can fail to write it.
  try {
    fs.mkdirSync(entryDir, { recursive: true });
    fs.writeFileSync(path.join(entryDir, "trashed.json"), `${JSON.stringify(meta, null, 2)}\n`);
  } catch (err) {
    return notDeleted(err);
  }
  const moved = moveAll(moves);
  if (!moved.ok) return notDeleted(moved.message);

  // The two edits are part of the same step: if either fails, the day file
  // gets its own bytes back and every move is undone.
  const dayInTrash = path.join(entryDir, "day.json");
  const original = fs.readFileSync(dayInTrash, "utf8");
  try {
    editJson(dayInTrash, (doc) => {
      doc.status = "draft";
    });
    if (coverFromDay) editJson(tripFile, (doc) => void delete doc.cover);
  } catch (err) {
    try {
      fs.writeFileSync(dayInTrash, original);
    } catch {
      // Reported below; the move back still runs.
    }
    for (const [from, to] of [...moves].reverse()) {
      try {
        move(to, from);
      } catch {
        // Best effort; the error names what failed.
      }
    }
    return notDeleted(err);
  }
  return { ok: true, id };
}

function readMeta(entryDir: string): TrashMeta | null {
  const meta = readJsonFile(path.join(entryDir, "trashed.json"));
  return meta && typeof meta.deletedAt === "string" && typeof meta.stem === "string" ? (meta as unknown as TrashMeta) : null;
}

function* trashDirs(user: string): Generator<{ tripId: string; id: string; dir: string }> {
  let trips: string[] = [];
  try {
    trips = fs.readdirSync(trashRoot(user));
  } catch {
    return;
  }
  for (const tripId of trips) {
    let ids: string[] = [];
    try {
      ids = fs.readdirSync(path.join(trashRoot(user), tripId));
    } catch {
      continue;
    }
    for (const id of ids) yield { tripId, id, dir: path.join(trashRoot(user), tripId, id) };
  }
}

/** Remove, for good, every trashed day older than `TRASH_DAYS`, and the
 *  web-sized copies the media route cached of its photographs. */
function purgeTrash(user: string, now = new Date()): number {
  let purged = 0;
  for (const { tripId, dir } of trashDirs(user)) {
    const meta = readMeta(dir);
    // No readable stamp: nothing says how old it is, so it is left alone.
    const deletedAt = meta ? Date.parse(meta.deletedAt) : Number.NaN;
    if (!meta || Number.isNaN(deletedAt) || now.getTime() - deletedAt < TRASH_DAYS * DAY_MS) continue;
    const media = path.join(dir, "media");
    let files: string[] = [];
    try {
      files = fs.readdirSync(media);
    } catch {
      // No photographs.
    }
    const home = path.resolve(tripMediaDir(tripRef(user, tripId)), bareOf(meta.stem));
    for (const name of files) forgetDerivatives(path.join(home, name), path.join(media, name), MEDIA_WIDTHS);
    fs.rmSync(dir, { recursive: true, force: true });
    purged++;
  }
  return purged;
}

/** What "Recently deleted" lists, newest first — after the purge. */
export function listTrash(user: string, now = new Date()): TrashEntry[] {
  purgeTrash(user, now);
  const out: TrashEntry[] = [];
  for (const { id, dir } of trashDirs(user)) {
    const meta = readMeta(dir);
    if (!meta) continue;
    const left = TRASH_DAYS - Math.floor((now.getTime() - Date.parse(meta.deletedAt)) / DAY_MS);
    // An unreadable stamp is never purged (above), so it never counts down.
    out.push({ ...meta, id, daysLeft: Number.isNaN(left) ? TRASH_DAYS : Math.max(1, left) });
  }
  return out.sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : -1));
}

/**
 * Put a trashed day back, as a draft. Refused, with nothing moved, when the
 * trip is gone, the entry is gone (purged), or the day's address is taken.
 */
export function restoreDay(user: string, tripId: string, id: string): { ok: true; stem: string } | Fail {
  let entryDir: string;
  try {
    entryDir = path.join(tripTrashDir(user, tripId), safe(id));
  } catch {
    return { ok: false, error: "unknown_deleted_day", message: "There is no such deleted day." };
  }
  const meta = readMeta(entryDir);
  if (!meta) {
    return {
      ok: false,
      error: "unknown_deleted_day",
      message: `This day is no longer in Recently deleted — after ${TRASH_DAYS} days it is gone for good.`,
    };
  }
  const ref = tripRef(user, tripId);
  const tripFile = path.join(tripDir(ref), "trip.json");
  if (!fs.existsSync(tripFile)) {
    return { ok: false, error: "unknown_trip", message: "The trip this day belonged to no longer exists." };
  }

  const stem = safe(meta.stem);
  const bare = bareOf(stem);
  const moves = pieces(user, tripId, stem, entryDir)
    .map(([home, trashed]) => [trashed, home] as [string, string])
    .filter(([from]) => fs.existsSync(from));
  let entryFiles: string[] = [];
  try {
    entryFiles = fs.readdirSync(path.join(tripDir(ref), "entries"));
  } catch {
    // A trip with no days yet.
  }
  const taken =
    entryFiles.some((f) => f === `${stem}.json` || (f.endsWith(".json") && bareOf(f.slice(0, -5)) === bare)) ||
    moves.some(([, home]) => fs.existsSync(home));
  if (taken) {
    return {
      ok: false,
      error: "slug_taken",
      message: `Another day in this trip now uses the address "${bare}". Rename or delete that one first, then restore this one.`,
    };
  }

  const moved = moveAll(moves);
  if (!moved.ok) {
    return { ok: false, error: "not_restored", message: `The day could not be put back (${moved.message}). Nothing was changed.` };
  }
  if (meta.cover) {
    try {
      editJson(tripFile, (doc) => {
        if (typeof doc.cover !== "string") doc.cover = meta.cover;
      });
    } catch {
      // The day is back; only the cover is not. The trip page still works
      // without one, and the owner can pick it again.
    }
  }
  fs.rmSync(entryDir, { recursive: true, force: true });
  return { ok: true, stem };
}

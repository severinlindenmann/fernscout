import "server-only";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

import { userDir } from "./users";
import { readSidecar as readSidecarFile, writeSidecar, type Sidecar } from "./sidecar";
import { IMAGE_EXTENSIONS } from "./ingest/image";
import { VIDEO_EXTENSIONS } from "./ingest/video";

/**
 * Somewhere to put a file before it belongs to a day — B663.
 *
 * Every other door into a journal makes a file name the day it is for:
 * `storeUploads` refuses a slug that names no entry, which is right for the
 * pipeline and wrong for the way a week away actually goes. Somebody empties a
 * camera on the evening it happened; the days that will hold those pictures
 * are written later, sometimes much later, and until then there was nowhere to
 * put two hundred photographs at all.
 *
 * `content/<username>/inbox/` is that place. It is inside the journal folder
 * on purpose — it is the owner's content, it is in their backup and their
 * export, and since B661 counts the whole folder it is already inside the
 * storage ceiling with nothing further to write.
 *
 * ## The name is the content
 *
 * `<sha256[0..12]>-<safe-stem><ext>`. Two files called `IMG_0001.JPG` from two
 * cameras get different prefixes and both survive; the *same bytes* uploaded
 * twice resolve to the same name, so the second upload is a no-op that hands
 * back the first one's id. That is the whole duplicate story and it needs no
 * index to be true — it is a property of the filename, so it stays true when
 * somebody copies a file in by hand, which on a folder they own they will.
 *
 * ## One sidecar per file
 *
 * `a3f1c2-sunset.jpg` beside `a3f1c2-sunset.jpg.meta.json` — the suffix rather
 * than a swapped extension, because `files/` may itself hold a `.json` and a
 * sidecar that could be mistaken for an upload is one that gets listed as one.
 * A file and its facts move,
 * copy and delete together, and two agents uploading at once never write the
 * same file. A single `index.json` would be a lock nobody has, and a
 * half-written one would orphan every file in the folder.
 *
 * **Nothing on a sidecar is inferred.** `description`, `lat`, `lon`,
 * `takenAt`, `caption` and `tags` are what somebody said, and are absent when
 * nobody said anything — AGENTS.md's one rule, at the door where it is
 * cheapest to break: a plausible description of a photograph is exactly the
 * kind of invention nobody catches.
 *
 * The shape itself, and the only function that writes one anywhere in this
 * repository, live in `lib/sidecar.ts` — B1864. A file arriving here keeps
 * that one sidecar for life: when it is filed onto a day it *moves* with the
 * photograph rather than being rebuilt from a narrower type.
 *
 * ## Nothing here is reachable by URL
 *
 * `resolveMediaFile` resolves under `tripMediaDir` and nothing else, so this
 * is true by construction. Keep it that way: a file waiting to be filed is not
 * published, and whoever uploaded it has not decided anything yet.
 */

/**
 * What a file is *for*, which is what decides where it goes next.
 *
 * A flat folder would make an agent guess. `media` is destined for a day's
 * gallery and is the only kind `POST /api/v1/<user>/inbox` will file; the
 * other five are held for the pipelines that will read them. (The helper's
 * own media route is a separate door and also files `files`, for anything
 * that is not a photograph or a video — B683.)
 */
export const INBOX_KINDS = ["media", "files", "photobook", "postcards", "location", "contact"] as const;
export type InboxKind = (typeof INBOX_KINDS)[number];

/**
 * What may land in `files/` — the kinds that are read rather than published.
 *
 * Nothing reads them yet (B663 stores them and stops there). They are accepted
 * now so a bank statement, a GPS export or a scan has somewhere to arrive when
 * something is built that understands it, and so the format does not have to
 * change then.
 */
export const INBOX_FILE_EXTENSIONS = new Set([".csv", ".pdf", ".json", ".txt", ".gpx", ".md", ".vcf"]);

/**
 * What somebody said about a file — one photograph's whole sidecar shape,
 * `Sidecar` in `lib/sidecar.ts`, minus the `kind` the folder decides (B1864).
 * Every field optional, every field theirs.
 */
export type InboxMeta = Omit<Sidecar, "kind">;

/** A sidecar as it sits on disk: what was measured, plus what was said. */
export type InboxEntry = Sidecar & {
  id: string;
  kind: InboxKind;
  /** The name the uploader used, kept so a person recognises their own file. */
  filename: string;
  bytes: number;
  sha256: string;
  uploadedAt: string;
};

export function inboxDir(username: string, kind?: InboxKind): string {
  const root = path.join(userDir(username), "inbox");
  return kind ? path.join(root, kind) : root;
}

/** Which kind an extension belongs to, or null for one nothing here takes. */
export function kindForExtension(filename: string): InboxKind | null {
  const ext = path.extname(filename).toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext) || VIDEO_EXTENSIONS.has(ext)) return "media";
  if (INBOX_FILE_EXTENSIONS.has(ext)) return "files";
  return null;
}

/**
 * A stem good enough to be part of a filename.
 *
 * Deliberately not `slugify` (lib/slug.ts), which mints a slug from a title
 * and falls back to "entry" — the fallback here is the hash, which is already
 * in the name, so a file called `????.jpg` becomes `a3f1c2….jpg` rather than
 * `a3f1c2-entry.jpg`.
 */
function safeStem(filename: string): string {
  return path
    .basename(filename, path.extname(filename))
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** The id a file's bytes and name produce. Pure: the same input is the same
 * id on every machine, which is what makes an upload idempotent. */
export function inboxId(filename: string, bytes: Buffer): string {
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
  const stem = safeStem(filename);
  return `${hash}${stem ? `-${stem}` : ""}${path.extname(filename).toLowerCase()}`;
}

/** Where a sidecar sits for an id. */
function sidecarPath(username: string, kind: InboxKind, id: string): string {
  return path.join(inboxDir(username, kind), `${id}.meta.json`);
}

export type StoredInboxFile = { entry: InboxEntry; existed: boolean };

/**
 * Put one file in the bucket.
 *
 * `existed: true` is the same bytes under the same name arriving twice — the
 * file is left exactly as it is and the first upload's id comes back, so a
 * caller retrying a half-finished batch cannot double the journal's size.
 * The sidecar is *not* overwritten in that case either: the first description
 * somebody wrote is not silently replaced by a second call that said nothing.
 */
export function storeInboxFile(
  username: string,
  kind: InboxKind,
  filename: string,
  bytes: Buffer,
  meta: InboxMeta,
): StoredInboxFile {
  const id = inboxId(filename, bytes);
  const dir = inboxDir(username, kind);
  const file = path.join(dir, id);
  const sidecar = sidecarPath(username, kind, id);

  if (fs.existsSync(file) && fs.existsSync(sidecar)) {
    return { entry: readEntry(sidecar, kind)!, existed: true };
  }

  fs.mkdirSync(dir, { recursive: true });
  const entry: InboxEntry = {
    id,
    kind,
    filename,
    bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    uploadedAt: new Date().toISOString(),
    ...meta,
  };

  // The bytes first, the sidecar second. A crash between them leaves a file
  // with no facts about it, which `listInbox` reports as an unlisted stray
  // rather than losing; the other order would advertise a file that is not
  // there.
  fs.writeFileSync(file, bytes);
  writeSidecar(sidecar, entry);
  return { entry, existed: false };
}

function readEntry(at: string, kind: InboxKind): InboxEntry | null {
  const parsed = readSidecarFile(at) as InboxEntry | null;
  // `kind` is where the file actually is, never what the file claims — a
  // sidecar edited by hand must not be able to move a file between folders
  // by saying so.
  return parsed ? { ...parsed, kind } : null;
}

/** Everything in the bucket, by kind. Sorted newest first within each. */
export function listInbox(username: string): Record<InboxKind, InboxEntry[]> {
  const out = {} as Record<InboxKind, InboxEntry[]>;
  for (const kind of INBOX_KINDS) {
    const dir = inboxDir(username, kind);
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      out[kind] = [];
      continue;
    }
    out[kind] = names
      .filter((n) => n.endsWith(".meta.json"))
      .map((n) => readEntry(path.join(dir, n), kind))
      .filter((e): e is InboxEntry => e !== null && fs.existsSync(path.join(dir, e.id)))
      .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  }
  return out;
}

/**
 * One file by id, wherever in the bucket it is.
 *
 * The id carries no kind, deliberately: a caller referencing a photograph
 * should not have to remember which folder it was put in, and the id is
 * unique across the bucket because it is a hash of the bytes.
 *
 * `path.basename` on the way in is the whole path-traversal guard — an id
 * arrives from a request and is joined into a directory name, so it is a
 * security boundary in the sense AGENTS.md means.
 */
export function findInboxFile(
  username: string,
  id: string,
): { entry: InboxEntry; file: string } | null {
  const safe = path.basename(id);
  for (const kind of INBOX_KINDS) {
    const dir = inboxDir(username, kind);
    const file = path.join(dir, safe);
    const sidecar = sidecarPath(username, kind, safe);
    if (fs.existsSync(file) && fs.existsSync(sidecar)) {
      const entry = readEntry(sidecar, kind);
      if (entry) return { entry, file };
    }
  }
  return null;
}

/**
 * Take a file out of the bucket, sidecar and all. `true` if it was there.
 *
 * The **bytes** decide whether it was there, not the pair — B1864. A filed
 * photograph's sidecar has already MOVED onto the trip by the time this is
 * called, and asking `findInboxFile` (which requires both) would have
 * answered "nothing here" and left the bytes in the inbox forever. It is also
 * the right answer for a file whose sidecar was lost some other way:
 * `listInbox` already reports one as an unlisted stray rather than as
 * content, and a stray nothing can remove is worse than one nothing lists.
 */
export function removeInboxFile(username: string, id: string): boolean {
  const safe = path.basename(id);
  for (const kind of INBOX_KINDS) {
    const file = path.join(inboxDir(username, kind), safe);
    if (!fs.existsSync(file)) continue;
    fs.rmSync(file, { force: true });
    fs.rmSync(sidecarPath(username, kind, safe), { force: true });
    return true;
  }
  return false;
}

/** `content/<user>/inbox/days/<date>/`, the same shape as the flat bucket
 *  but scoped to one date — Phase 2's staging area. `date` is trusted to be
 *  an ISO `YYYY-MM-DD` by every caller in this file; nothing here validates
 *  it, because every caller already has it from a place that did (a
 *  WhatsApp message's own timestamp, or a person answering "which day"). */
export function dayInboxDir(username: string, date: string, kind?: InboxKind): string {
  const root = path.join(userDir(username), "inbox", "days", date);
  return kind ? path.join(root, kind) : root;
}

/** Strict `YYYY-MM-DD`, nothing looser — B1990. Every route that takes a day
 *  off the wire (the move and delete routes under `app/api/helper/…`) checks
 *  a caller-supplied date against this before it ever reaches `dayInboxDir`
 *  or its siblings, since those functions trust their `date` argument
 *  completely and do no validation of their own (see the doc comment above). */
export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Every date that has a day folder under `inbox/days/`, sorted — B1990, for
 *  the studio inbox page's own grouping and for marking a `DayStrip` cell as
 *  already holding *something* waiting, even before it holds a written day. */
export function listInboxDayFolders(username: string): string[] {
  const root = path.join(userDir(username), "inbox", "days");
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}

function daySidecarPath(username: string, date: string, kind: InboxKind, id: string): string {
  return path.join(dayInboxDir(username, date, kind), `${id}.meta.json`);
}

/** Everything staged for one date, by kind. Mirrors `listInbox`, scoped to a
 *  date folder rather than the flat bucket. An unknown date reads as every
 *  kind empty, not as an error — a date nobody has staged anything for yet
 *  is the ordinary case, not a failure. */
export function listDayInbox(username: string, date: string): Record<InboxKind, InboxEntry[]> {
  const out = {} as Record<InboxKind, InboxEntry[]>;
  for (const kind of INBOX_KINDS) {
    const dir = dayInboxDir(username, date, kind);
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      out[kind] = [];
      continue;
    }
    out[kind] = names
      .filter((n) => n.endsWith(".meta.json"))
      .map((n) => readEntry(path.join(dir, n), kind))
      .filter((e): e is InboxEntry => e !== null && fs.existsSync(path.join(dir, e.id)))
      .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  }
  return out;
}

/** One staged file for one date, by id. Mirrors `findInboxFile`, scoped to a
 *  date folder. `path.basename` on `id` is the same path-traversal guard
 *  `findInboxFile` applies — an id reaches here from a request body. */
export function findDayInboxFile(
  username: string,
  date: string,
  id: string,
): { entry: InboxEntry; file: string } | null {
  const safe = path.basename(id);
  for (const kind of INBOX_KINDS) {
    const dir = dayInboxDir(username, date, kind);
    const file = path.join(dir, safe);
    const sidecar = daySidecarPath(username, date, kind, safe);
    if (fs.existsSync(file) && fs.existsSync(sidecar)) {
      const entry = readEntry(sidecar, kind);
      if (entry) return { entry, file };
    }
  }
  return null;
}

/** Take a staged file out of a date folder, sidecar and all. `true` if it
 *  was there. Mirrors `removeInboxFile`, scoped to a date folder — Phase 3
 *  calls this once a file has been moved into a real entry's own media, by
 *  which time the sidecar has gone with it (B1864), so the bytes are what
 *  this looks for. */
export function removeDayInboxFile(username: string, date: string, id: string): boolean {
  const safe = path.basename(id);
  for (const kind of INBOX_KINDS) {
    const file = path.join(dayInboxDir(username, date, kind), safe);
    if (!fs.existsSync(file)) continue;
    fs.rmSync(file, { force: true });
    fs.rmSync(daySidecarPath(username, date, kind, safe), { force: true });
    return true;
  }
  return false;
}

/**
 * Tie a flat-bucket file to a date — moving its bytes and sidecar out of
 * `inbox/<kind>/` and into `inbox/days/<date>/<kind>/`, keeping the same id.
 *
 * A **move**, not a copy or an index entry, per the spec: the flat bucket is
 * for undated content, so a dated item has no business still answering to
 * `listInbox`/`findInboxFile`/`attach_files`'s "everything waiting" query
 * once it has a date. `null` when the id is not presently in the flat
 * bucket — already moved, or never staged there at all.
 */
export function moveInboxFileToDay(
  username: string,
  id: string,
  date: string,
): { entry: InboxEntry } | null {
  const found = findInboxFile(username, id);
  if (!found) return null;
  const { entry } = found;
  const destDir = dayInboxDir(username, date, entry.kind);
  fs.mkdirSync(destDir, { recursive: true });
  fs.renameSync(found.file, path.join(destDir, entry.id));
  fs.renameSync(
    sidecarPath(username, entry.kind, entry.id),
    daySidecarPath(username, date, entry.kind, entry.id),
  );
  return { entry };
}

/**
 * The inverse of `moveInboxFileToDay` — a staged file that turned out not to
 * belong to the entry the date folder became, moved back to the flat bucket
 * rather than destroyed with the folder. `null` when the id is not presently
 * staged for that date.
 */
export function moveInboxFileFromDay(
  username: string,
  date: string,
  id: string,
): { entry: InboxEntry } | null {
  const found = findDayInboxFile(username, date, id);
  if (!found) return null;
  const { entry } = found;
  const destDir = inboxDir(username, entry.kind);
  fs.mkdirSync(destDir, { recursive: true });
  fs.renameSync(found.file, path.join(destDir, entry.id));
  fs.renameSync(
    daySidecarPath(username, date, entry.kind, entry.id),
    sidecarPath(username, entry.kind, entry.id),
  );
  return { entry };
}

/**
 * Merge new facts into one staged item's sidecar, wherever it currently
 * sits — a date folder (pass `date`) or the flat bucket. Unlike
 * `storeInboxFile`, this *is* meant to change what a sidecar already says: an
 * answer (a caption typed after the fact, a caption question asked and
 * declined) arriving once a file is already staged has nowhere else to land.
 * `false` when the id is not found in the place named. */
export function updateInboxMeta(
  username: string,
  id: string,
  patch: InboxMeta,
  date?: string,
): boolean {
  const safe = path.basename(id);
  if (date) {
    const found = findDayInboxFile(username, date, safe);
    if (found) {
      writeSidecar(daySidecarPath(username, date, found.entry.kind, found.entry.id), patch);
      return true;
    }
  }
  const found = findInboxFile(username, safe);
  if (found) {
    writeSidecar(sidecarPath(username, found.entry.kind, found.entry.id), patch);
    return true;
  }
  return false;
}

/**
 * One location pin with no day to attach to yet — B2013.
 *
 * Every flat-bucket `location` entry is one of these: `handleLocationPin`
 * (`paid/whatsapp/lib/whatsapp/dispatch.ts`) only ever leaves a pin in the flat bucket when
 * its message date falls outside every trip's range, and moves it straight
 * into `inbox/days/<date>/` (`moveInboxFileToDay`) the moment a trip is
 * actually running for that date. `name`/`address` are what the WhatsApp
 * message itself carried (`Sidecar.placeName`/`placeAddress`) — never a
 * lookup, never invented.
 */
export type WaitingPin = {
  id: string;
  kind: "pin";
  lat: number;
  lon: number;
  receivedAt: string;
  name?: string;
  address?: string;
};

/** Every pin waiting for a day — B2014 reads this to offer one to the plan. */
export function listWaitingPins(username: string): WaitingPin[] {
  return listInbox(username)
    .location.filter((e) => typeof e.lat === "number" && typeof e.lon === "number")
    .map((e) => ({
      id: e.id,
      kind: "pin",
      lat: e.lat as number,
      lon: e.lon as number,
      receivedAt: e.receivedAt ?? e.uploadedAt,
      ...(e.placeName ? { name: e.placeName } : {}),
      ...(e.placeAddress ? { address: e.placeAddress } : {}),
    }));
}

/**
 * Remove one waiting pin — B2014's own write side, once the plan has used it
 * or the person has discarded it. Scoped to the flat `location` kind only: a
 * pin already filed onto a day has moved on and this id no longer names one.
 */
export function removeWaitingPin(username: string, id: string): boolean {
  const found = findInboxFile(username, id);
  if (!found || found.entry.kind !== "location") return false;
  return removeInboxFile(username, id);
}

/** Every byte the bucket holds — for the storage breakdown (B664). */
export function inboxBytes(username: string): number {
  let total = 0;
  for (const entries of Object.values(listInbox(username))) {
    for (const entry of entries) total += entry.bytes;
  }
  return total;
}

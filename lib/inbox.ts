import "server-only";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

import { userDir } from "./users";
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
 * other three are held for the pipelines that will read them. (The helper's
 * own media route is a separate door and also files `files`, for anything
 * that is not a photograph or a video — B683.)
 */
export const INBOX_KINDS = ["media", "files", "photobook", "postcards"] as const;
export type InboxKind = (typeof INBOX_KINDS)[number];

/**
 * What may land in `files/` — the kinds that are read rather than published.
 *
 * Nothing reads them yet (B663 stores them and stops there). They are accepted
 * now so a bank statement, a GPS export or a scan has somewhere to arrive when
 * something is built that understands it, and so the format does not have to
 * change then.
 */
export const INBOX_FILE_EXTENSIONS = new Set([".csv", ".pdf", ".json", ".txt", ".gpx", ".md"]);

/** What somebody said about a file. Every field optional, every field theirs. */
export type InboxMeta = {
  description?: string;
  lat?: number;
  lon?: number;
  takenAt?: string;
  caption?: string;
  tags?: string[];
  /**
   * Where this arrived from, when it was not the ordinary web upload —
   * B1059. Absent means the web door, as it always meant before this field
   * existed.
   */
  source?: "whatsapp";
  /**
   * When the *message* carrying this file was received — never a guess at
   * when the photograph was taken. Set alongside `source`, and only then: a
   * photograph sent *as a photograph* over WhatsApp has had its EXIF
   * stripped, so this is the one honest timestamp there is for it, and it is
   * an arrival time rather than a capture time even when the file itself
   * carried a real one (a document is not re-read for it here — see B1059's
   * own note on why that is a documented scope cut rather than an oversight).
   */
  receivedAt?: string;
};

/** A sidecar as it sits on disk: what was measured, plus what was said. */
export type InboxEntry = InboxMeta & {
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
    return { entry: readSidecar(sidecar, kind)!, existed: true };
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
  fs.writeFileSync(sidecar, `${JSON.stringify(entry, null, 2)}\n`);
  return { entry, existed: false };
}

function readSidecar(at: string, kind: InboxKind): InboxEntry | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(at, "utf8")) as InboxEntry;
    // `kind` is where the file actually is, never what the file claims — a
    // sidecar edited by hand must not be able to move a file between folders
    // by saying so.
    return { ...parsed, kind };
  } catch {
    return null;
  }
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
      .map((n) => readSidecar(path.join(dir, n), kind))
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
      const entry = readSidecar(sidecar, kind);
      if (entry) return { entry, file };
    }
  }
  return null;
}

/** Take a file out of the bucket, sidecar and all. `true` if it was there. */
export function removeInboxFile(username: string, id: string): boolean {
  const found = findInboxFile(username, id);
  if (!found) return false;
  fs.rmSync(found.file, { force: true });
  fs.rmSync(`${found.file}.meta.json`, { force: true });
  return true;
}

/** Every byte the bucket holds — for the storage breakdown (B664). */
export function inboxBytes(username: string): number {
  let total = 0;
  for (const entries of Object.values(listInbox(username))) {
    for (const entry of entries) total += entry.bytes;
  }
  return total;
}

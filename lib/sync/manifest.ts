import "server-only";
import fs from "node:fs";
import path from "node:path";

import { userDir } from "../users";
import { contentHash } from "../ingest/hash";

/**
 * What a journal's folder holds, file by file, with a hash — B1495.
 *
 * Content has only ever flowed one way. The helper's `publish` skill walks a
 * local `content/` tree, asks the instance which slugs it already has, and
 * sends the difference; there is no matching road down, so *edit on my laptop,
 * publish, correct a day on the site, then get the newest version back down
 * here* ends in unzipping a full export over the top and losing whatever was
 * local. This module is the half of the answer that lives on the server: one
 * list of paths, sizes and hashes that a client can diff its own folder
 * against.
 *
 * ## `gps/` is not here, and that is the first thing to know
 *
 * The owner decided it before any code, and the reasoning is not about any
 * one owner. A manifest covering `gps/` would be the first thing in this
 * codebase that can hand back a coordinate — to whoever holds an owner token,
 * and those sit in agent scrollbacks — and it would end the property that
 * makes the folder safe at all: that deleting `gps/` leaves every trip
 * rendering identically. A laptop copy gets each trip's derived, clipped
 * `track.json` and nothing else.
 *
 * That is machinery rather than a sentence somebody later disagrees with.
 * This module reaches `gps/` through no import — it never calls into
 * `lib/gps/` at all — and `test/gps-store.test.ts` asserts both that and the
 * stronger thing: a manifest built over a journal with a real position
 * history mentions neither the folder nor any coordinate in it.
 *
 * ## What is in, and what is out
 *
 * In: `config.json`, and everything under `trips/<id>/` — `trip.md`,
 * `entries/*.md` including drafts, `costs.md`, `plan.md`, and `media/` as the
 * derivative files sit on disk. Drafts are in because the folder is a
 * faithful mirror or it is not a backup. `inbox/` is in, sidecars and all: it
 * is where photographs wait before they belong to a day, which is the one job
 * the helper exists for.
 *
 * Out, in four groups, each for its own reason:
 *
 * - **`gps/`** — above.
 * - **Generated output** — `postcards/`, `photobooks/`, `.ingest.json`, and
 *   `track.json`, which the server derives from a position history the client
 *   will never hold. Syncing a derived file up at the thing that derives it is
 *   a conflict waiting to happen with nothing on either side worth keeping.
 * - **`originals/`** — the full-resolution photographs a photobook prints
 *   from, an order of magnitude larger than what the site serves. This is the
 *   call `lib/exportZip.ts:152` already made for the same folder in the same
 *   words: back them up with the filesystem, not through a browser. A client
 *   is told the count and the bytes it did not fetch rather than left to
 *   assume it has everything.
 * - **Dotfiles, at any depth** — `.DS_Store` wherever the Finder left one,
 *   `.fingerprints/`, and the client's own `.fernscout-sync.json`, which must
 *   never be uploaded by the thing that writes it.
 *
 * ## The hash, and why it is the whole file
 *
 * `contentHash` (lib/ingest/hash.ts) — SHA-256 over every byte, hex, 32
 * characters. Deliberately **not** `sampledFileHash` beside it, even for
 * video, and this is the one place in this codebase where the cheaper hash is
 * the wrong one. A sampled collision in ingest means a photograph is skipped
 * and you add it again. A sampled collision here means a changed file is
 * silently never synced, in either direction, while both sides go on
 * believing they agree — invisible, and permanent.
 *
 * It is affordable, measured rather than assumed: SHA-256 over the whole of
 * `content/example` (153 files, 22 MiB) is 45 ms, about 500 MiB/s, so a
 * gigabyte journal is two seconds — and only on the first run, because
 * `hashCache` below turns an unchanged file into a `stat()`.
 *
 * ## No `mtime` on the wire
 *
 * An entry is `{ path, size, hash }` and nothing else. A modification time
 * does not survive `export.zip` — the fresh-sync path — does not survive a
 * copy, and never agrees between a server and a laptop, so carrying one would
 * add a field that disagrees on every run and has to be ignored. It is a
 * cache key here and on the client, and it crosses nothing.
 */

/** One file, as both sides agree to describe it. */
type ManifestEntry = {
  /** POSIX-slashed, relative to `content/<username>/`. */
  path: string;
  size: number;
  hash: string;
};

export type SyncManifest = {
  user: string;
  /** Every file in the sync, sorted by path so two runs compare cleanly. */
  files: ManifestEntry[];
  /**
   * What was deliberately left out, so a client can say so rather than
   * quietly presenting a partial copy as a backup. `originals` is the only
   * one with bytes worth reporting; the rest are small or derived.
   */
  omitted: { originals: { files: number; bytes: number } };
};

/**
 * The client's own base manifest, which must never be uploaded by the thing
 * that writes it. Named here rather than in the helper because the exclusion
 * has to hold on the server too: a person who copies their laptop folder onto
 * the instance by hand should not publish their sync state.
 */
const BASE_MANIFEST_FILE = ".fernscout-sync.json";

/** Derived server-side from a position history the client never holds. */
const DERIVED_FILES = new Set(["track.json"]);

/**
 * Top-level directories under `content/<username>/` that a sync never walks.
 *
 * `gps` is the one that matters and is asserted by test. The other two are
 * generated output. `inbox` is deliberately absent from this list — it syncs.
 */
const EXCLUDED_ROOTS = new Set(["gps", "postcards", "photobooks"]);

/** Any path segment beginning with a dot, the rule `lib/exportZip.ts` uses. */
function isDotfilePath(relative: string): boolean {
  return relative.split("/").some((segment) => segment.startsWith("."));
}

/**
 * Files under `dir`, depth first, names sorted — the same walk
 * `lib/exportZip.ts` does, kept here rather than imported because that module
 * is about archives and this one is about identity, and sharing a private
 * helper across the two would couple them for six lines.
 */
function walkFiles(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

/**
 * Hashes already computed, keyed on the path and what `stat` said about it.
 *
 * Process-lifetime and unbounded on purpose: it is one small string per file
 * of a journal the instance is already serving, and an eviction policy would
 * be more code than the thing it manages. A file edited in place changes its
 * size or its mtime — `fs.writeFileSync` sets both — so a stale entry needs a
 * write that preserves the byte count *and* the timestamp, which is a
 * deliberate act rather than an accident.
 */
const hashCache = new Map<string, { key: string; hash: string }>();

function hashOf(file: string, stat: fs.Stats): string {
  const key = `${stat.size}:${stat.mtimeMs}`;
  const seen = hashCache.get(file);
  if (seen && seen.key === key) return seen.hash;
  const hash = contentHash(fs.readFileSync(file));
  hashCache.set(file, { key, hash });
  return hash;
}

/** Test-only: a hash cache that outlives a temp directory is a lying cache. */
export function clearSyncHashCache(): void {
  hashCache.clear();
}

/**
 * Whether one path relative to `content/<username>/` belongs in the manifest.
 *
 * Exported so the file doors can ask the same question the listing asked —
 * a path this refuses must not be readable or writable by a caller who guessed
 * it, and two copies of this rule would be two rules within a month.
 */
export function inSync(relative: string): boolean {
  if (!relative || relative.startsWith("/")) return false;
  const segments = relative.split("/");
  // `..` never reaches the filesystem: a username is a directory name, and so
  // is everything under it.
  if (segments.some((segment) => segment === "." || segment === "..")) return false;
  if (isDotfilePath(relative)) return false;
  if (relative.toLowerCase() === BASE_MANIFEST_FILE) return false;
  if (segments.length === 1) return relative.toLowerCase() === "config.json";

  // **Lowercased before every comparison**, because the filesystem under this
  // is usually case-insensitive. On APFS a request for `ORIGINALS/01.jpg`
  // resolves to the real `originals/01.jpg`, so a case-sensitive check here
  // would exclude a folder from the listing and then serve it anyway to
  // anybody who shouted. Found by the security pass on this branch's own
  // code, which is exactly the shape a reviewer catches and a test written
  // beside the implementation does not: the fixture spells it the way the
  // implementation does.
  //
  // The top level needs no such care to be *safe* — it is an allow-list, so
  // `GPS/` is refused for not being `trips`, `inbox` or `config.json` rather
  // than for matching an exclusion — but it is folded anyway, so the
  // exclusion says what it means rather than relying on the default.
  const root = segments[0].toLowerCase();
  if (EXCLUDED_ROOTS.has(root)) return false;
  if (root === "inbox") return segments.length >= 3;
  if (root !== "trips") return false;

  // trips/<id>/...
  if (segments.length < 3) return false;
  if (segments[2].toLowerCase() === "originals") return false;
  if (segments.length === 3 && DERIVED_FILES.has(segments[2].toLowerCase())) return false;
  return true;
}

/**
 * The absolute path one manifest path names, or null if it names nothing.
 *
 * The last check is **`realpath`, not a string comparison**, and that
 * distinction is the whole point. `inSync` has already refused every `..`
 * segment, which makes `path.join(root, relative)` start with `root` by
 * construction — so a `startsWith` here would be a tautology dressed as a
 * boundary, and the comment beside it claiming to stop a symlink would simply
 * be untrue. It was, until the security pass on this branch said so.
 *
 * `fs.realpathSync` resolves every link in the chain, so a symlink inside the
 * journal pointing at `gps/`, at another journal, or at `/etc/passwd` lands
 * outside `root` and is refused. Nothing in this codebase creates a symlink
 * under `content/` today, so this is hardening rather than a live hole — but
 * the listing's own walk skips symlinks (`Dirent.isFile()` is false for one),
 * which means a link here could only ever be a file the manifest never
 * offered, reached by a caller who guessed. That is exactly the case this
 * function exists to answer.
 *
 * A path that does not exist throws rather than resolving, which is the same
 * `null` — the route answers 404 either way.
 */
export function resolveSyncPath(username: string, relative: string): string | null {
  if (!inSync(relative)) return null;
  const root = userDir(username);
  const full = path.join(root, relative);
  try {
    const real = fs.realpathSync(full);
    const realRoot = fs.realpathSync(root);
    if (real !== realRoot && !real.startsWith(realRoot + path.sep)) return null;
    return real;
  } catch {
    return null;
  }
}

/** What was left on the server, so the client can say so out loud. */
function countOriginals(username: string): { files: number; bytes: number } {
  const tripsRoot = path.join(userDir(username), "trips");
  let files = 0;
  let bytes = 0;
  for (const trip of walkFiles(tripsRoot)) {
    const relative = path.relative(tripsRoot, trip).split(path.sep);
    if (relative[1] !== "originals") continue;
    files += 1;
    try {
      bytes += fs.statSync(trip).size;
    } catch {
      // Vanished between the walk and the stat. Counting it as nothing is
      // closer to true than refusing the whole manifest over one file.
    }
  }
  return { files, bytes };
}

/**
 * Every file of one journal a sync carries, with its hash.
 *
 * Sorted by path, so the same journal produces the same manifest twice and a
 * client diffing two runs is comparing like with like.
 */
export function buildManifest(username: string): SyncManifest {
  const root = userDir(username);
  const files: ManifestEntry[] = [];

  for (const file of walkFiles(root)) {
    const relative = path.relative(root, file).split(path.sep).join("/");
    if (!inSync(relative)) continue;
    let stat: fs.Stats;
    try {
      stat = fs.statSync(file);
    } catch {
      continue;
    }
    files.push({ path: relative, size: stat.size, hash: hashOf(file, stat) });
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  return { user: username, files, omitted: { originals: countOriginals(username) } };
}

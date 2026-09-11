import "server-only";
import fs from "node:fs";
import matter from "gray-matter";
import path from "node:path";
import { buffer as streamToBuffer } from "node:stream/consumers";
import { ZipArchive } from "archiver";
import { isDraft } from "./entries";
import { isOpenToLink } from "./access";
import { userConfigPath } from "./config";
import { getTrips } from "./trips";
import { userDir } from "./users";
import type { Trip } from "./types";

/**
 * The anti-lock-in pitch, made concrete: a zip of one user's content that
 * `content/<username>/` could be rebuilt from — the exact markdown-plus-media
 * layout `lib/trips.ts` and `lib/entries.ts` already read, so restoring it is
 * "unzip into content/<username>/", nothing bespoke.
 *
 * Two scopes, because this can be reached two different ways:
 *
 * - `"all"` — every trip, exactly as it sits on disk, drafts included. This is
 *   the owner's own backup. `scripts/export.ts` produces it locally, and two
 *   HTTP routes serve it: `/<username>/export.zip` to a token carrying the
 *   journal owner's unqualified `write:content`, and
 *   `/<username>/delete/<token>/export.zip` to the single-use, hour-lived
 *   token mailed to `owner.email` before a deletion. This comment used to say
 *   "nothing here is exposed over HTTP", which stopped being true when the
 *   first of those learned to serve it — and a route that read it as still
 *   true handed the whole journal to any token belonging to it, trip-scoped
 *   ones included (B231). **Anything reaching for this scope has to establish
 *   that it is the owner, not merely that it is inside the journal.**
 *
 *   A **trip** deletion mail's export button is this same scope, narrowed by
 *   `tripId` to the trip being deleted (B1387) — the mail's own prose says
 *   "this trip", so the archive it links has to actually be that. The route
 *   reads both `scope` and `tripId` off the one already-resolved deletion
 *   token; neither is ever accepted as a URL or query parameter.
 * - `"open-to-link"` — only trips an anonymous visitor could already reach
 *   (`isOpenToLink`: public + unlisted): a convenience packaging of content
 *   already reachable, never a new way to reach content that wasn't. `guest`
 *   and `private` trips are excluded outright rather than partially redacted
 *   — a plain GET carries nothing that says who is asking, so the safe answer
 *   is "not in this zip." Since B1086 no HTTP route serves this scope — the
 *   owner-only route serves `"all"` and nothing serves the anonymous one — so
 *   `config.json`'s owner block never leaves over a plain GET. It stays a
 *   library scope (`scripts/export.ts`, and the tests that pin the contract).
 */
export type ExportScope = "all" | "open-to-link";

function tripsForScope(username: string, scope: ExportScope, tripId?: string): Trip[] {
  const trips = getTrips(username);
  const scoped = scope === "all" ? trips : trips.filter(isOpenToLink);
  return tripId === undefined ? scoped : scoped.filter((trip) => trip.id === tripId);
}

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

/**
 * Whether a file is an unpublished entry.
 *
 * The `open-to-link` scope means "what an anonymous visitor could already
 * see", and a draft is precisely what they cannot: it is absent from the
 * story, the feed, the sitemap, the search index and its own permalink. The
 * trip filter above was the only thing this scope applied, so a public trip
 * handed over every draft in it — the agent's unreviewed writing, downloadable
 * by anybody, which is the one rule this project has.
 */
function isDraftEntry(file: string): boolean {
  if (path.extname(file) !== ".md") return false;
  if (path.basename(path.dirname(file)) !== "entries") return false;
  try {
    return isDraft(matter(fs.readFileSync(file, "utf8")).data);
  } catch {
    // Unreadable or unparseable: not something to hand out either.
    return true;
  }
}

/**
 * Any path segment beginning with a dot — `.DS_Store` wherever the Finder
 * left one, `.fingerprints/`, `.ingest.json` at a trip's root. Internal
 * bookkeeping nobody asked to export, in every scope and every export — a
 * real zip pulled from a scratch journal turned up `.DS_Store` at the trip
 * root *and* under `media/`, so this checks every segment rather than only
 * the first the way the `originals/` check below does (B1387).
 */
function isDotfilePath(relativeToTripRoot: string): boolean {
  return relativeToTripRoot.split(path.sep).some((segment) => segment.startsWith("."));
}

/**
 * Queues one user's content onto a zip archive. Doesn't finalize it — the
 * caller decides how to consume the resulting stream (buffered for a test or
 * a CLI write, or piped straight into an HTTP response body).
 *
 * `tripId`, when given, narrows to one trip — B1387. `scope` still answers
 * *who may see this*; `tripId` answers *how much*, and the two compose: a
 * trip-scoped export of the `"open-to-link"` scope (nothing currently asks
 * for that combination, but nothing here assumes otherwise) still drops a
 * `private` trip's own files, and a trip-scoped `"all"` export — the shape a
 * trip deletion mails — narrows to that one trip's own directory and nothing
 * else in the journal.
 *
 * A trip-scoped export never carries `config.json`: that file holds the
 * whole owner block (name, email, phone), and a mail whose prose says "this
 * trip" must not also hand over the rest of the journal's identity. Only the
 * whole-journal export (`tripId` absent) carries it.
 */
function appendUserContent(
  archive: ZipArchive,
  username: string,
  scope: ExportScope,
  tripId?: string,
): void {
  const root = userDir(username);

  if (tripId === undefined) {
    const configPath = userConfigPath(username);
    if (fs.existsSync(configPath)) {
      archive.file(configPath, { name: "config.json" });
    }
  }

  // The model-consent record (B684) used to travel in the owner's own "all"
  // export — a record of what the *owner* agreed to, so it seemed to belong
  // beside the rest of the backup. It is internal bookkeeping exactly the way
  // a dotfile is, though, and a real export pulled from a scratch journal
  // showed it sitting at the content root alongside `.DS_Store` and
  // `.ingest.json` rather than anywhere a restore reads from — so it is now
  // excluded the same way those are (`consentFile()`, deliberately not
  // called here — B1387), in every scope, not only the anonymous one.

  for (const trip of tripsForScope(username, scope, tripId)) {
    const tripRoot = path.join(root, "trips", trip.id);
    for (const file of walkFiles(tripRoot)) {
      const relative = path.relative(tripRoot, file);
      // Never the originals, in either scope. They are what the photobook
      // prints from, an order of magnitude larger than what the site serves,
      // and an export people actually download has to stay downloadable —
      // back them up with the filesystem, not through a browser.
      if (relative.split(path.sep)[0] === "originals") continue;
      if (isDotfilePath(relative)) continue;
      if (scope === "open-to-link" && isDraftEntry(file)) continue;
      const name = path.relative(root, file).split(path.sep).join("/");
      archive.file(file, { name });
    }
  }
}

/** A fresh, unfinalized archive with one user's content already queued onto
 * it — `finalize()` and consume the stream (or use one of the helpers below).
 * `tripId` narrows to one trip; see `appendUserContent`. */
export function createUserExportArchive(
  username: string,
  scope: ExportScope,
  tripId?: string,
): ZipArchive {
  const archive = new ZipArchive({ zlib: { level: 9 } });
  appendUserContent(archive, username, scope, tripId);
  return archive;
}

/** The whole zip in memory — fine for a CLI or a test; the route handler
 * streams instead so a large media library never sits in memory twice. */
export async function buildUserExportZipBuffer(
  username: string,
  scope: ExportScope,
  tripId?: string,
): Promise<Buffer> {
  const archive = createUserExportArchive(username, scope, tripId);
  const bufferPromise = streamToBuffer(archive);
  await archive.finalize();
  return bufferPromise;
}

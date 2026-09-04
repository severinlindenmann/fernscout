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
 * - `"open-to-link"` — only trips an anonymous visitor could already reach
 *   (`isOpenToLink`: public + unlisted). This is what
 *   `/<username>/export.zip` serves: a convenience packaging of content
 *   already reachable, never a new way to reach content that wasn't. `guest`
 *   and `private` trips are excluded outright rather than partially redacted
 *   — a plain GET carries nothing that says who is asking, so the safe answer
 *   is "not in this zip."
 */
export type ExportScope = "all" | "open-to-link";

function tripsForScope(username: string, scope: ExportScope): Trip[] {
  const trips = getTrips(username);
  return scope === "all" ? trips : trips.filter(isOpenToLink);
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
 * Queues one user's content onto a zip archive. Doesn't finalize it — the
 * caller decides how to consume the resulting stream (buffered for a test or
 * a CLI write, or piped straight into an HTTP response body).
 */
export function appendUserContent(
  archive: ZipArchive,
  username: string,
  scope: ExportScope,
): void {
  const root = userDir(username);

  const configPath = userConfigPath(username);
  if (fs.existsSync(configPath)) {
    archive.file(configPath, { name: "config.json" });
  }

  for (const trip of tripsForScope(username, scope)) {
    const tripRoot = path.join(root, "trips", trip.id);
    for (const file of walkFiles(tripRoot)) {
      // Never the originals, in either scope. They are what the photobook
      // prints from, an order of magnitude larger than what the site serves,
      // and an export people actually download has to stay downloadable —
      // back them up with the filesystem, not through a browser.
      if (path.relative(tripRoot, file).split(path.sep)[0] === "originals") continue;
      if (scope === "open-to-link" && isDraftEntry(file)) continue;
      const name = path.relative(root, file).split(path.sep).join("/");
      archive.file(file, { name });
    }
  }
}

/** A fresh, unfinalized archive with one user's content already queued onto
 * it — `finalize()` and consume the stream (or use one of the helpers below). */
export function createUserExportArchive(username: string, scope: ExportScope): ZipArchive {
  const archive = new ZipArchive({ zlib: { level: 9 } });
  appendUserContent(archive, username, scope);
  return archive;
}

/** The whole zip in memory — fine for a CLI or a test; the route handler
 * streams instead so a large media library never sits in memory twice. */
export async function buildUserExportZipBuffer(
  username: string,
  scope: ExportScope,
): Promise<Buffer> {
  const archive = createUserExportArchive(username, scope);
  const bufferPromise = streamToBuffer(archive);
  await archive.finalize();
  return bufferPromise;
}

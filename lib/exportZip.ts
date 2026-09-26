import "server-only";
import fs from "node:fs";
import path from "node:path";
import { buffer as streamToBuffer } from "node:stream/consumers";
import { ZipArchive } from "archiver";
import { getAllEntries, AS_AUTHOR } from "./entries";
import { isOpenToLink } from "./access";
import { userConfigPath } from "./config";
import { mediaOriginalsRoot, tripOriginalsDir } from "./media";
import { getTrips, tripRef } from "./trips";
import { userDir } from "./users";
import { readerTrack } from "./gps/track";
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
  // `.json`, not `.md` — B1598 changed what a day is on disk, and this check
  // did not follow. While it read `.md` it answered `false` for every day
  // there is, so **every draft went into an `open-to-link` export**: the one
  // scope whose whole point is that it is handed to somebody who was not
  // invited. A day is a draft precisely because nobody has decided it should
  // be read yet.
  if (path.extname(file) !== ".json") return false;
  if (path.basename(path.dirname(file)) !== "entries") return false;
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    // Not `isDraft()`: that only catches an explicit `"draft"`, so a day
    // written with no `status` at all (dayFromJson's own default, and every
    // reading path other than this one, treat that as a draft) would slip
    // past it and into an anonymous, open-to-link export — B2347.
    return data.status !== "published";
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
 * root *and* under `media/`, so this checks every segment (B1387).
 */
function isDotfilePath(relativeToTripRoot: string): boolean {
  return relativeToTripRoot.split(path.sep).some((segment) => segment.startsWith("."));
}

/**
 * What every representation of one photograph shares: where it sits under
 * whichever root holds it, and its stem.
 *
 * A single photograph is on disk several times over — the served derivative
 * at `media/<day>/01.jpg`, the untouched print master at
 * `originals/<day>/01.heic` (a different extension: ingest numbers both from
 * the same index, neither name predicts the other's — see `deleteMediaFiles`),
 * and the `.meta.json` sidecar beside either. Only the root segment and the
 * extension differ, so the key drops both and keeps `<day>/01`.
 *
 * That is deliberately *not* a path. B1863 (the media route) and B1875 (this
 * file) are the same defect twice: a hold-back that names one path while
 * another path serves the same bytes. A fourth path — a thumbnail tree, a
 * `meta/` sidecar tree — is caught by this without a further edit, because a
 * new path for an existing photograph can only vary the root it hangs under
 * or the extension it ends in; vary anything else and it is no longer the
 * same photograph's file.
 *
 * Case-folded and NFC-normalised for the reason `lib/media.ts` folds names:
 * frontmatter and disk disagree about case often enough that `01.JPG` must
 * not be a way past this.
 */
function photographKey(pathUnderRoot: string): string {
  const clean = pathUnderRoot.replace(/\.meta\.json$/i, "");
  const dir = clean.slice(0, clean.length - path.posix.basename(clean).length);
  const stem = path.posix.basename(clean, path.posix.extname(clean));
  return (dir + stem).normalize("NFC").toLowerCase();
}

/** Whether a file at `pathUnderRoot` is one of a held-back photograph's
 * representations. */
function isHeldBack(held: Set<string>, pathUnderRoot: string): boolean {
  return pathUnderRoot !== "" && held.has(photographKey(pathUnderRoot));
}

/** The dates of `tripId` that have a published day — for `track.json`'s own
 * filter below. Draft status only, same shape `lib/gps/api.ts` used to check
 * before B2202 moved that gate to serve time. */
function publishedDatesOf(username: string, tripId: string, reader: "person" | "public"): Set<string> {
  const published = getAllEntries(tripRef(username, tripId), {
    includeDrafts: false,
    reader,
  });
  return new Set(published.map((e) => e.date));
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
    // Photographs the trip itself lets in but a day or an item holds back —
    // B596/B632. This scope means, in this file's own words above, what an
    // anonymous visitor could already see, and such a visitor cannot see
    // these: visible() strips them from every reading path and the media
    // route refuses the file. An export carrying them would be the second
    // half of that pair failing, which AGENTS.md calls worse than having no
    // protection at all.
    //
    // Exactly the mistake this function already made once about drafts, one
    // filter over. The trip-level check is not enough, because a narrowing
    // can sit on a single day or a single photograph inside a trip anybody
    // may read.
    const heldBack = scope === "open-to-link" ? narrowedMedia(username, trip.id) : null;
    for (const file of walkFiles(tripRoot)) {
      const relative = path.relative(tripRoot, file);
      // B1603: originals used to be skipped here — "back them up with the
      // filesystem, not through a browser" — which is not an option for a
      // hosted owner, who has no filesystem access at all. `originals/` is
      // the print master an upload keeps losslessly (B1533) precisely so it
      // is not lost; an export is one of the two ways this content ever
      // leaves the server, and dropping it there loses it for good. Kept
      // in, at the same cost every other export already accepts.
      if (isDotfilePath(relative)) continue;
      if (scope === "open-to-link" && isDraftEntry(file)) continue;
      // Tested by photograph identity, not by path: the first segment says
      // *which representation* (`media/`, `originals/`, a `meta/` sidecar
      // tree, whatever is added next) and everything after it is the same for
      // all of them. B1875 — this line used to compare the whole relative
      // path, so it dropped `media/<day>/<file>` and shipped the untouched,
      // still-EXIF-bearing `originals/<day>/<file>` of the same photograph.
      if (heldBack && isHeldBack(heldBack, relative.split(path.sep).slice(1).join("/"))) continue;
      const name = path.relative(root, file).split(path.sep).join("/");
      // B2202: derivation now covers every trip date regardless of publish
      // state, so `track.json` on disk can hold a draft day's or a
      // too-recent fix's segment — the same reason a reader's own map page
      // no longer reads it raw. Filtered the same way, to published dates,
      // in every scope: an owner's own backup is not the studio's unclipped
      // preview this ticket left unbuilt (see docs/gps.md).
      if (relative === "track.json") {
        const track = readerTrack(
          username,
          trip.id,
          // An open-to-link export is what an anonymous visitor may take away,
          // so only days a public reader sees (second B2202 review).
          publishedDatesOf(username, trip.id, scope === "open-to-link" ? "public" : "person"),
        );
        if (track) archive.append(Buffer.from(`${JSON.stringify(track)}\n`), { name });
        continue;
      }
      archive.file(file, { name });
    }

    // `MEDIA_ORIGINALS_DIR` moves originals off `tripRoot` entirely (see
    // `lib/media.ts`), so the walk above never finds them there — they would
    // otherwise vanish from the export exactly the way B1603 was filed
    // against, just for a different reason (a different disk, not a skip).
    if (mediaOriginalsRoot()) {
      const originalsDir = tripOriginalsDir(tripRef(username, trip.id));
      for (const file of walkFiles(originalsDir)) {
        const relative = path.relative(originalsDir, file);
        if (isDotfilePath(relative)) continue;
        // This loop had no hold-back check at all (B1875): with
        // `MEDIA_ORIGINALS_DIR` set it walked the originals disk and queued
        // every file on it. `relative` is already the path under the trip's
        // originals root, so it is the identity path directly.
        if (heldBack && isHeldBack(heldBack, relative.split(path.sep).join("/"))) continue;
        const name = [...path.relative(root, tripRoot).split(path.sep), "originals", ...relative.split(path.sep)].join(
          "/",
        );
        archive.file(file, { name });
      }
    }
  }
}

/**
 * A `photographKey` for every photograph a day or an item holds back.
 *
 * Read at AS_AUTHOR deliberately: the question is not what this caller may
 * see, but what the content itself is marked as. A reader-level read would
 * hide the very items being collected — the closed default would return
 * nothing, the filter would be empty, and everything would pass. That is
 * B1647's shape, and getting it backwards here fails open.
 */
function narrowedMedia(username: string, tripId: string): Set<string> {
  const held = new Set<string>();
  for (const entry of getAllEntries(tripRef(username, tripId), AS_AUTHOR)) {
    for (const item of entry.gallery) {
      if (!entry.visibility && !item.visibility) continue;
      for (const src of [item.src, item.poster]) {
        if (!src) continue;
        const at = src.indexOf("/media/");
        if (at === -1) continue;
        const rest = src.slice(at + "/media/".length).split("/").slice(1).join("/");
        // One key per photograph, not one per path — B1875. It covers the
        // derivative, the print master under `originals/` whose extension
        // need not match, and the sidecar in both places one can be: `meta/`
        // where B1863 writes them now, and beside the derivative where an
        // older journal still has one. A sidecar carries the uploader's
        // filename and the caption, so an export that dropped the bytes and
        // kept the description would be this filter's own leak, one file over.
        if (rest) held.add(photographKey(rest));
      }
    }
  }
  return held;
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

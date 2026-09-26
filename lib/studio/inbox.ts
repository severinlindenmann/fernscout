import "server-only";
import fs from "node:fs";
import path from "node:path";
import {
  dayInboxDir,
  inboxDir,
  INBOX_KINDS,
  listDayInbox,
  listInbox,
  listInboxDayFolders,
  type InboxEntry,
  type InboxKind,
} from "@/lib/inbox";
import { VIDEO_EXTENSIONS } from "@/lib/ingest/video";
import { GPS_IMPORTERS } from "@/importers/gps";
import { getTrip, getTrips, tripRef } from "@/lib/trips";
import { AS_AUTHOR, getAllEntries } from "@/lib/entries";
import { attachGallery } from "@/lib/api/entries";
import { earliestTodayISO } from "@/lib/tripTime";
import { readVCard } from "@/lib/vcard";
import { groupWaitingDays, type WaitingDays } from "@/lib/studio/dayCards";
import { tripMediaDir } from "@/lib/media";
import { mediaKey } from "@/lib/photos";
import { frontmatterSrc } from "@/lib/ingest/paths";
import { readTripSidecar } from "@/lib/sidecar";
import type { GalleryItem } from "@/lib/types";

/**
 * The studio's own inbox page — B1990. Every read a client component
 * needs, computed server-side (`node:fs` throughout `lib/inbox.ts`), the
 * same split `lib/studio/hub.ts` and `lib/studio/day.ts` already make.
 */

/** What a tile draws, derived from the storage kind plus the extension —
 *  never from a separate field nobody wrote. `kind: "media"` is unambiguous
 *  by extension (image or video); `location`/`contact` are unambiguous by
 *  kind itself, since those buckets only ever hold what was explicitly filed
 *  there (`lib/inbox.ts`'s `kindFor`); everything else — `files`, and a
 *  `.gpx`/`.vcf` that landed in `files` because nobody named a kind for it —
 *  falls back to the extension a person would recognise. */
export type InboxFileType =
  | "photo"
  | "video"
  | "location"
  | "contact"
  | "statement"
  | "document"
  | "transcript";

export function inboxFileType(kind: InboxKind, filename: string): InboxFileType {
  const ext = path.extname(filename).toLowerCase();
  if (kind === "media") return VIDEO_EXTENSIONS.has(ext) ? "video" : "photo";
  if (kind === "location") return "location";
  if (kind === "contact") return "contact";
  if (ext === ".gpx") return "location";
  if (ext === ".vcf") return "contact";
  if (ext === ".csv") return "statement";
  if (ext === ".txt" || ext === ".md") return "transcript";
  // .pdf, .json and anything else this bucket ever takes.
  return "document";
}

export type InboxRow = {
  id: string;
  kind: InboxKind;
  /** `null` for the flat, undated bucket — "waiting". */
  day: string | null;
  name: string;
  bytes: number;
  type: InboxFileType;
  takenAt?: string;
  uploadedAt: string;
  /** A photo's own pixel size, measured at upload — absent for a video, or
   *  for anything uploaded before B1995. */
  dimensions?: { width: number; height: number };
  /** A `.vcf` tile's own name, first email and counts, read off the card
   *  itself — absent for anything else, and for a card too big or too
   *  malformed to read. */
  contact?: { name?: string; email?: string; phones: number; emails: number };
  /** What the tile's inline preview shows beyond a photograph's own
   *  thumbnail — B2084. A CSV's first rows; a location export's format name
   *  and never a single position from inside it. Absent for everything else,
   *  which previews as its size and type. */
  preview?: { kind: "table"; rows: string[][] } | { kind: "location"; format: string | null };
  /** B2207 — set only for a photograph filed onto a trip with no day
   *  (`storeTripPhoto`, `lib/api/v2/media.ts`, `day` declined): the trip it
   *  is waiting in, so its own "waiting for a day in <trip>" section knows
   *  which trip's days to move it onto. Absent for every other row — a day's
   *  own trip is not ambiguous the way this one is. */
  trip?: string;
};

/**
 * A `.vcf` no bigger than a shared contact ever legitimately is — B1995. The
 * bound is checked against the already-known `bytes` before a single byte is
 * read, so a mislabelled multi-megabyte file costs this a stat, not a read.
 */
const VCF_MAX_BYTES = 64 * 1024;

/** One card's name and counts, or nothing — isolated per file so one
 *  malformed `.vcf` cannot take the rest of the page down with it. */
function contactFor(file: string, bytes: number): InboxRow["contact"] | undefined {
  if (bytes > VCF_MAX_BYTES) return undefined;
  try {
    const { name, email, phones, emails } = readVCard(fs.readFileSync(file, "utf8"));
    return { name, email, phones, emails };
  } catch {
    return undefined;
  }
}

/** The first `bytes` of a file as text — a preview never reads a whole
 *  export that may run to hundreds of megabytes. */
function head(file: string, bytes: number): string {
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(bytes);
    return buf.subarray(0, fs.readSync(fd, buf, 0, bytes, 0)).toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

/** One CSV line split on `delimiter`, double quotes honoured. */
function splitCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted && c === '"' && line[i + 1] === '"') {
      cell += '"';
      i++;
    } else if (c === '"') {
      quoted = !quoted;
    } else if (c === delimiter && !quoted) {
      cells.push(cell);
      cell = "";
    } else {
      cell += c;
    }
  }
  cells.push(cell);
  return cells.map((v) => v.trim().slice(0, 40));
}

const PREVIEW_ROWS = 4;
const PREVIEW_COLUMNS = 6;

/** A CSV's header plus its first three rows — B2084. The delimiter is
 *  whichever of `;`, `,` or a tab the header line holds most of: a Swiss
 *  bank's export is semicolons, most others commas.
 *  ponytail: a quoted cell spanning a line break splits there; a preview
 *  shows it as two short rows, which is harmless. */
function csvPreview(file: string): string[][] {
  const lines = head(file, 8 * 1024).split(/\r?\n/).filter((l) => l.trim()).slice(0, PREVIEW_ROWS);
  if (lines.length === 0) return [];
  const delimiter = [";", ",", "\t"].sort((a, b) => lines[0].split(b).length - lines[0].split(a).length)[0];
  return lines.map((line) => splitCsvLine(line, delimiter).slice(0, PREVIEW_COLUMNS));
}

function previewFor(file: string, type: InboxFileType, filename: string): InboxRow["preview"] {
  const ext = path.extname(filename).toLowerCase();
  try {
    if (ext === ".csv") return { kind: "table", rows: csvPreview(file) };
    if (type === "location" || ext === ".json") {
      // The same 64 kB `detect` reads on import (`lib/gps/api.ts`), and only
      // the importer's own label comes back out — never the text it read.
      const text = head(file, 64 * 1024);
      const format = GPS_IMPORTERS.find((i) => i.detect(text, filename))?.label ?? null;
      return format || type === "location" ? { kind: "location", format } : undefined;
    }
  } catch {
    // An unreadable file previews as its size and type, like any other.
  }
  return undefined;
}

function rowsFor(username: string, byKind: Record<InboxKind, InboxEntry[]>, day: string | null): InboxRow[] {
  const rows: InboxRow[] = [];
  for (const kind of INBOX_KINDS) {
    for (const entry of byKind[kind]) {
      const dir = day ? dayInboxDir(username, day, kind) : inboxDir(username, kind);
      const guessed = inboxFileType(kind, entry.filename);
      const preview = previewFor(path.join(dir, entry.id), guessed, entry.filename);
      // B2082 — the location flow uploads a Timeline export without naming a
      // kind, so it lands in `files` as a "document". The preview's own GPS
      // `detect` already recognised it: the tile is somebody's movement
      // history, typed as such (private note, no move).
      const type = guessed === "document" && preview?.kind === "location" ? "location" : guessed;
      rows.push({
        id: entry.id,
        kind,
        day,
        name: entry.filename,
        bytes: entry.bytes,
        type,
        takenAt: entry.takenAt,
        uploadedAt: entry.uploadedAt,
        dimensions: entry.dimensions,
        contact: type === "contact" ? contactFor(path.join(dir, entry.id), entry.bytes) : undefined,
        preview,
      });
    }
  }
  return rows;
}

export type InboxHubModel = {
  waiting: InboxRow[];
  /** Newest day first. */
  days: { date: string; rows: InboxRow[] }[];
  dayBounds: { start: string; end: string };
  writtenDates: string[];
  /** B2138 — every day already written, by date, with its trip: a move of a
   *  photograph onto a date that has one can put it on that day for real
   *  (`/api/helper/<user>/day/attach`), and two trips on one date are asked
   *  between rather than guessed. */
  entriesByDate: Record<string, InboxDayEntry[]>;
  /** B2207 — a photograph filed onto a trip with no day (`storeTripPhoto`,
   *  `day` declined) is on disk under `trips/<id>/media/` but referenced by
   *  no day and so invisible to `waiting`/`days` above, which only ever read
   *  `content/<user>/inbox/`. One group per trip that has any, newest trip
   *  first is not promised — order follows `getTrips`. Empty for a trip with
   *  nothing waiting, and the array itself is empty on a journal with none. */
  tripWaiting: TripWaitingGroup[];
};

export type InboxDayEntry = { tripId: string; tripTitle: string; slug: string; title: string; published: boolean };

/** B2207 — one trip's own day-less photographs, plus the days they could be
 *  moved onto (narrower than the studio's own "put it on" sheet: only *this*
 *  trip's days, since the file already lives under this trip and nothing
 *  here moves it to another one). */
export type TripWaitingGroup = {
  tripId: string;
  tripTitle: string;
  rows: InboxRow[];
  /** Newest first. */
  days: { slug: string; date: string; title: string }[];
};

/** Every media key (`<tripId>/<relPath>`, `mediaKey`'s own shape) a
 *  published or draft day in this trip already names — a gallery item's
 *  `src`, and a video's own `poster` beside it. A day-less trip photo whose
 *  key is *not* in here is what "waiting" means for B2207. */
function referencedTripMediaKeys(ref: string): Set<string> {
  const keys = new Set<string>();
  for (const entry of getAllEntries(ref, AS_AUTHOR)) {
    for (const item of entry.gallery) {
      keys.add(mediaKey(item.src));
      if (item.poster) keys.add(mediaKey(item.poster));
    }
  }
  return keys;
}

/** Only the two extensions `storeTripPhoto` (`lib/api/v2/media.ts`) ever
 *  writes a derivative as, and never a video's own poster frame — that
 *  belongs to the clip beside it, not a tile of its own. */
function isTripMediaDerivative(name: string): boolean {
  return /\.(?:jpg|mp4)$/i.test(name) && !/-poster\.jpg$/i.test(name);
}

/** One trip's own waiting rows — everything directly under its `media/`
 *  root (a day's own photographs live one level deeper, in `media/<day>/`,
 *  so a root file is a day-less one by construction) that no day's gallery
 *  references yet. */
function tripWaitingRows(trip: { id: string; ref: string }): InboxRow[] {
  const dir = tripMediaDir(trip.ref);
  if (!fs.existsSync(dir)) return [];
  const referenced = referencedTripMediaKeys(trip.ref);
  const rows: InboxRow[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!isTripMediaDerivative(name)) continue;
    const full = path.join(dir, name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      continue; // gone between the readdir and the stat
    }
    if (!stat.isFile()) continue;
    if (referenced.has(`${trip.id}/${name}`)) continue;
    const isVideo = VIDEO_EXTENSIONS.has(path.extname(name).toLowerCase());
    const sidecar = readTripSidecar(trip.ref, name);
    rows.push({
      id: name,
      kind: "media",
      day: null,
      trip: trip.id,
      name: sidecar?.filename ?? name,
      bytes: stat.size,
      type: isVideo ? "video" : "photo",
      takenAt: sidecar?.takenAt,
      uploadedAt: sidecar?.uploadedAt ?? stat.mtime.toISOString(),
      dimensions: sidecar?.image ? { width: sidecar.image.width, height: sidecar.image.height } : undefined,
    });
  }
  return rows.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}

/** Every trip that has at least one day-less photograph waiting — B2207. */
export function tripWaitingGroups(username: string): TripWaitingGroup[] {
  return getTrips(username)
    .map((trip) => ({
      tripId: trip.id,
      tripTitle: trip.title,
      rows: tripWaitingRows(trip),
      days: getAllEntries(trip.ref, AS_AUTHOR)
        .map((entry) => ({ slug: entry.slug, date: entry.date, title: entry.title }))
        .sort((a, b) => b.date.localeCompare(a.date)),
    }))
    .filter((group) => group.rows.length > 0);
}

/**
 * File a day-less trip photograph onto one of that trip's own days —
 * B2207. The bytes already live under `trips/<id>/media/`, addressed by the
 * same hash `storeTripPhoto` gave them; nothing here re-uploads or moves
 * them, it only writes the gallery reference `attachGallery` (lib/api/
 * entries.ts) needs to stop treating the file as unreferenced.
 */
export function attachTripWaitingMedia(
  username: string,
  tripId: string,
  filename: string,
  slug: string,
): { ok: true; attached: number } | { ok: false; error: string; bug?: boolean } {
  const ref = tripRef(username, tripId);
  if (!getTrip(ref)) return { ok: false, error: "unknown_trip" };

  // `path.basename` first — the same traversal guard the flat inbox's own
  // move/delete routes use before joining an id into a path.
  const safeName = path.basename(filename);
  const dir = tripMediaDir(ref);
  const full = path.join(dir, safeName);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(full);
  } catch {
    return { ok: false, error: "unknown_file" };
  }
  // Must actually sit in the trip's media root, not a day subfolder reached
  // by naming one in `filename` — a file already filed has no business being
  // attached a second time through this door.
  if (!stat.isFile() || path.dirname(full) !== path.resolve(dir) || !isTripMediaDerivative(safeName)) {
    return { ok: false, error: "unknown_file" };
  }

  if (referencedTripMediaKeys(ref).has(`${tripId}/${safeName}`)) {
    return { ok: false, error: "already_attached" };
  }

  const isVideo = VIDEO_EXTENSIONS.has(path.extname(safeName).toLowerCase());
  const sidecar = readTripSidecar(ref, safeName);
  const item: GalleryItem = {
    src: frontmatterSrc(tripId, safeName),
    type: isVideo ? "video" : "image",
    ...(sidecar?.caption ? { caption: sidecar.caption } : {}),
    ...(sidecar?.image ? { width: sidecar.image.width, height: sidecar.image.height } : {}),
  };
  return attachGallery(ref, slug, [item]);
}

/** Everything the inbox page shows, grouped exactly as the ticket asks:
 *  "waiting for a day" first, then one group per day folder. */
export function buildInboxHubModel(username: string): InboxHubModel {
  const waiting = rowsFor(username, listInbox(username), null);
  const dates = listInboxDayFolders(username);
  const days = dates
    .map((date) => ({ date, rows: rowsFor(username, listDayInbox(username, date), date) }))
    .sort((a, b) => b.date.localeCompare(a.date));

  const trips = getTrips(username);
  // `earliestTodayISO` (`lib/tripTime.ts`), not `toISOString().slice(0, 10)`
  // — B1993. The latter is UTC, which made "today" arrive up to several
  // hours late for anyone west of Greenwich and disabled a same-day move the
  // owner had every right to make.
  const today = earliestTodayISO();
  const starts = trips.map((t) => t.start).sort();
  // The oldest waiting file's own date (whichever it recorded — a taken-at
  // reading if one exists, else when it was uploaded) can predate every
  // trip's own start, e.g. a camera roll emptied before this trip was ever
  // created — B1993. Bounding the strip to the earliest trip alone made that
  // photograph's own capture date unreachable even though it is exactly
  // where the file belongs.
  const waitingDates = waiting.map((row) => (row.takenAt ?? row.uploadedAt).slice(0, 10)).sort();
  const start = [starts[0], waitingDates[0]].filter((d): d is string => !!d).sort()[0] ?? today;

  const written = new Set<string>(dates);
  const entriesByDate: Record<string, InboxDayEntry[]> = {};
  for (const trip of trips) {
    for (const entry of getAllEntries(trip.ref, AS_AUTHOR)) {
      written.add(entry.date);
      (entriesByDate[entry.date] ??= []).push({
        tripId: trip.id,
        tripTitle: trip.title,
        slug: entry.slug,
        title: entry.title,
        published: !entry.draft,
      });
    }
  }

  return {
    waiting,
    days,
    dayBounds: { start, end: today },
    writtenDates: [...written].sort(),
    entriesByDate,
    tripWaiting: tripWaitingGroups(username),
  };
}

/**
 * The hub tile's own count and size — B2134. The same entries
 * `buildInboxHubModel` turns into cards, the flat bucket and every day folder
 * alike: B1990 counted only the flat bucket, so the chip said "11 files"
 * over a page of 12 cards. Read without the previews and contact cards the
 * page also opens, which is why this is not `buildInboxHubModel` itself.
 */
export function inboxSummary(username: string): { count: number; bytes: number } {
  const buckets = [listInbox(username), ...listInboxDayFolders(username).map((date) => listDayInbox(username, date))];
  let count = 0;
  let bytes = 0;
  for (const byKind of buckets) {
    for (const kind of INBOX_KINDS) {
      count += byKind[kind].length;
      for (const entry of byKind[kind]) bytes += entry.bytes;
    }
  }
  // B2207 — a day-less trip photo is waiting the same way anything above is,
  // just in a different folder (`trips/<id>/media/`, not `inbox/`); the
  // owner's own count promises "how much needs my attention", not "how much
  // is in this one place".
  for (const group of tripWaitingGroups(username)) {
    count += group.rows.length;
    for (const row of group.rows) bytes += row.bytes;
  }
  return { count, bytes };
}

/** B2193 — the waiting photographs (the flat bucket's `media`, exactly what
 *  `/studio/day/new` picks from) as one card per day they were taken on. */
export function waitingDaysFor(username: string): WaitingDays {
  return groupWaitingDays(listInbox(username).media, getTrips(username));
}

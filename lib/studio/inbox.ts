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
import { getTrips } from "@/lib/trips";
import { AS_AUTHOR, getAllEntries } from "@/lib/entries";
import { earliestTodayISO } from "@/lib/tripTime";
import { readVCard } from "@/lib/vcard";
import { groupWaitingDays, type WaitingDays } from "@/lib/studio/dayCards";

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
};

export type InboxDayEntry = { tripId: string; tripTitle: string; slug: string; title: string; published: boolean };

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
  return { count, bytes };
}

/** B2193 — the waiting photographs (the flat bucket's `media`, exactly what
 *  `/studio/day/new` picks from) as one card per day they were taken on. */
export function waitingDaysFor(username: string): WaitingDays {
  return groupWaitingDays(listInbox(username).media, getTrips(username));
}

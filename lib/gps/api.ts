import { GPS_IMPORTERS } from "@/importers/gps";
import { CONTACTS_IMPORTERS } from "@/importers/contacts";
import { checkGpsImporter, type GpsImporter, type Fix } from "@/importers/gps/schema";
import { AS_AUTHOR, getAllEntries } from "@/lib/entries";
import { getTrip, getTrips, tripRef } from "@/lib/trips";
import { appendFixes, deleteMonths, deleteRange, listMonths, readRange, type AppendResult } from "./store";
import {
  deriveTrack,
  hasHomeZoneOrDeclined,
  isExcluded,
  readExcludeZones,
  readHomeDeclined,
  trackForTrip,
  writeExcludeZones,
  writeHomeDeclined,
  type ExcludeZone,
} from "./enrich";
import { deleteTrack, trackPointCount, writeTrack } from "./track";
import { reverseGeocode } from "../ingest/geo";
import { earliestTodayISO } from "../tripTime";
import { zonedTimeToUtc } from "../timezone";

/** No fix ever reaches a reader less than this long after it was made —
 * B2202, so a public trip never shows a stranger where the owner is right
 * now. */
const MIN_AGE_MS = 24 * 60 * 60 * 1000;

/** Straight-line metres cut off both ends of every segment — B2202, so no
 * line starts or ends at the place somebody slept. See `trimByDistance` in
 * `./enrich.ts` for why this is distance, not path length. */
const TRIM_METRES = 500;

/** Every date of `trip` mapped to the `timezone` its own day carries, for
 * every day that has one — drafts included, since derivation now covers
 * every trip date regardless of publish state. `deriveTrack`'s local-midnight
 * windows use this; a date absent from the map is bounded in UTC. Read at
 * `AS_AUTHOR` deliberately: a draft's own timezone is still the true local
 * time of the fixes made that day, and hiding it would only make the window
 * wrong, not safer — the reader-facing filter is `readerTrack`, not this. */
function dayTimezones(username: string, trip: { id: string }): Record<string, string> {
  const zones: Record<string, string> = {};
  for (const entry of getAllEntries(tripRef(username, trip.id), AS_AUTHOR)) {
    if (entry.timezone) zones[entry.date] = entry.timezone;
  }
  return zones;
}

/**
 * What an API route may reach — B671.
 *
 * This is the only thing an API route is allowed to reach for. The route
 * authenticates, finds the bytes and answers; everything about *what an
 * import is* — which importer, whether it holds up, what goes on disk — is
 * here, so there is one answer to that question however the bytes arrived.
 *
 * **It writes, and reads back only two kinds of derived answer, never a
 * position that leaves this file unexamined.** Until B2200 there was no
 * function here that handed back anything read from a fix at all — what the
 * site drew was the trip-wide `track.json` (`./track.ts`), and a `GET` that
 * returned fixes would have undone the whole shape B665 built.
 * `placeForDay` was the first exception: a single day's dwell-weighted place
 * name, never a coordinate, reachable only from the owner's own cookie on
 * the studio's new-day page. `ownerTripLine` (B2226) is the second — the
 * owner's own raw, unclipped route for one trip, reachable only from the
 * owner's own cookie on the studio's location page, with no `/api/v2` door
 * at all. `recordedTrips` (also B2226) reads the store too, but hands back
 * only counts and timestamps, never a coordinate — the same shape
 * `coverageOf` above already had. `test/gps-store.test.ts` asserts that no
 * route imports `./store` or `./enrich` directly, and that exactly these
 * three — `placeForDay`, `recordedTrips`, `ownerTripLine` — are the exports
 * here that reach into the store at all — this module is the reason both
 * can still be true at once.
 */

/**
 * The kinds of data that can be imported.
 *
 * Positions and a phone's address book. Each has its own folder under
 * `importers/`, its own row type and its own writer — the same request shape
 * with a different word, which is why the API takes a kind at all rather than
 * being called `/gps/import`.
 *
 * A bank statement (`costs`) moved to `/api/v2` in B1624: the upload half is
 * the shared media door (`intent.kind: "bank_export"`) and the read half is
 * `GET /api/v2/{user}/statements/{src}` — see
 * docs/plans/2026-09-12-api-v2/content.md §3. It never belonged in a door
 * whose contract is "store bytes, answer with an item, or write a
 * measurement"; a statement report is neither.
 *
 * **An absent `kind` is refused rather than defaulted.** Reading a phone's
 * address book as positions is not a mistake to make quietly, and it was one
 * word away while there was a single kind to fall back to.
 */
export const IMPORT_KINDS = ["gps", "contacts"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

/**
 * The bounding box of a read, and nothing else about it — B1937.
 *
 * This is what the location flow's peek screen is allowed to draw: an area,
 * never the line inside it. Four numbers describe a rectangle; they do not
 * describe a route, and nowhere in this module is there a function that
 * hands back an ordered list of positions. Keep it that way — see the
 * module doc comment above and `test/gps-extent-not-route.test.ts`.
 */
export type Extent = { minLat: number; maxLat: number; minLon: number; maxLon: number };

/** How much of one trip's own date range this read actually touches — for
 * the peek and decide screens' "N of M days" line. Never a coordinate. */
export type TripCoverage = { tripId: string; days: number; tripDays: number };

function extentOf(rows: Fix[]): Extent | null {
  if (rows.length === 0) return null;
  let minLat = rows[0].lat;
  let maxLat = rows[0].lat;
  let minLon = rows[0].lon;
  let maxLon = rows[0].lon;
  for (const row of rows) {
    if (row.lat < minLat) minLat = row.lat;
    if (row.lat > maxLat) maxLat = row.lat;
    if (row.lon < minLon) minLon = row.lon;
    if (row.lon > maxLon) maxLon = row.lon;
  }
  return { minLat, maxLat, minLon, maxLon };
}

/** Distinct UTC calendar days with at least one row inside `[start, end]`,
 * against the trip's own length in days — B1937's "N of M days" line. */
function coverageOf(rows: Fix[], trip: { id: string; start: string; end: string }): TripCoverage {
  const from = Date.parse(`${trip.start}T00:00:00Z`);
  const to = Date.parse(`${trip.end}T23:59:59.999Z`);
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.t < from || row.t > to) continue;
    seen.add(new Date(row.t).toISOString().slice(0, 10));
  }
  // From date to date, not from the millisecond span — `to` deliberately
  // reaches 23:59:59.999 above so a fix on the trip's last evening still
  // counts, and that same offset would otherwise round this count up by one.
  const startOfEnd = Date.parse(`${trip.end}T00:00:00Z`);
  const tripDays = Math.max(1, Math.round((startOfEnd - from) / 86_400_000) + 1);
  return { tripId: trip.id, days: seen.size, tripDays };
}

export type ImportOutcome = {
  kind: "gps";
  /** The importer that read it — asked for, or detected. */
  format: string;
  detected: boolean;
  /** How many rows came out of the file, before thinning. */
  read: number;
  /** ISO dates of the first and last row, or null for an empty read. */
  from: string | null;
  to: string | null;
  /** The area this read covers. Never the positions themselves. */
  extent: Extent | null;
  /** Present when `trips` was passed — one row per trip asked about. */
  coverage?: TripCoverage[];
  /** Absent on a dry run: nothing was written. */
  stored?: AppendResult;
  /** Trips whose track was re-derived because their dates overlap this
   *  import — B2202. Counts and a per-trip ok/fail only, never a coordinate.
   *  Absent on a dry run, same as `stored`. */
  rederived?: { tripId: string; ok: boolean }[];
};

/** Neither an error nor an outcome: the file could not be read as anything. */
export type ImportRefusal = {
  refusal: "unknown_format" | "unreadable" | "contract";
  message: string;
  problems?: string[];
};

export function isRefusal(result: ImportOutcome | ImportRefusal): result is ImportRefusal {
  return "refusal" in result;
}

/** What `GET /api/v2/<user>/import` answers with, and what a caller needs
 * before they can make the `POST`. */
export function importFormats(): {
  kind: ImportKind;
  what: string;
  formats: { id: string; label: string }[];
}[] {
  return [
    {
      kind: "gps",
      what: "where somebody went — a location history, drawn as one trip's route",
      formats: GPS_IMPORTERS.map((i) => ({ id: i.id, label: i.label })),
    },
    {
      kind: "contacts",
      what: "who might get post — a phone's own address book, read and shown before anybody is added",
      formats: CONTACTS_IMPORTERS.map((i) => ({ id: i.id, label: i.label })),
    },
  ];
}

/** How much of the file `detect` is shown — the same 64 kB the contract
 * promises, so an importer behaves identically whatever the door. */
const HEAD_CHARS = 64 * 1024;

/** How to name the file in a refusal. `inline` is the placeholder the route
 * gives pasted text, and telling somebody that nothing recognised "inline"
 * sends them looking for a file they never sent. */
function subject(filename: string): string {
  return filename === "inline" ? "the text you sent" : JSON.stringify(filename);
}

function chooseImporter(
  text: string,
  filename: string,
  format: string | undefined,
): { importer: GpsImporter; detected: boolean } | ImportRefusal {
  if (format !== undefined) {
    const named = GPS_IMPORTERS.find((i) => i.id === format);
    if (!named)
      return {
        refusal: "unknown_format",
        message:
          `No importer called ${JSON.stringify(format)}. ` +
          `Known formats: ${GPS_IMPORTERS.map((i) => i.id).join(", ")}. ` +
          "Leave `format` out and the file is recognised from its own contents.",
      };
    return { importer: named, detected: false };
  }
  const head = text.slice(0, HEAD_CHARS);
  const found = GPS_IMPORTERS.find((i) => i.detect(head, filename));
  if (!found)
    return {
      refusal: "unknown_format",
      message:
        `Nothing recognised ${subject(filename)}. Name the format explicitly — one of ` +
        `${GPS_IMPORTERS.map((i) => i.id).join(", ")} — or, if this came out of a tool of ` +
        "your own, print JSON Lines of `[t, lat, lon]` and send it as `fixes`.",
    };
  return { importer: found, detected: true };
}

/**
 * Read a file into the journal's store.
 *
 * `dryRun` parses, checks and reports without writing anything — the same
 * check `importers/gps/schema.ts` exports, so somebody testing an importer
 * they wrote gets told what is wrong in words rather than finding out from a
 * map of the Gulf of Guinea a week later.
 */
export function importGps(
  username: string,
  text: string,
  filename: string,
  options: {
    format?: string;
    dryRun?: boolean;
    /** Trips to report coverage for — dates only, never used for anything
     *  but the "N of M days" count. */
    trips?: { id: string; start: string; end: string }[];
  } = {},
): ImportOutcome | ImportRefusal {
  const chosen = chooseImporter(text, filename, options.format);
  if ("refusal" in chosen) return chosen;

  let rows;
  try {
    rows = chosen.importer.parse(text);
  } catch (error) {
    return {
      refusal: "unreadable",
      message:
        `${chosen.importer.id} could not read ${subject(filename)}: ` +
        `${(error as Error).message}. ` +
        (chosen.detected
          ? "It was chosen by looking at the file, so it may be the wrong one — name a format."
          : "It was the format you named; check that against the file."),
    };
  }

  const problems = checkGpsImporter(chosen.importer, rows);
  if (problems.length > 0)
    return {
      refusal: "contract",
      message: `${chosen.importer.id} read the file, and what came out does not hold up.`,
      problems,
    };

  const times = rows.map((r) => r.t);
  const outcome: ImportOutcome = {
    kind: "gps",
    format: chosen.importer.id,
    detected: chosen.detected,
    read: rows.length,
    from: new Date(Math.min(...times)).toISOString(),
    to: new Date(Math.max(...times)).toISOString(),
    extent: extentOf(rows),
    ...(options.trips ? { coverage: options.trips.map((trip) => coverageOf(rows, trip)) } : {}),
  };
  if (options.dryRun) return outcome;
  const stored = appendFixes(username, rows);
  // B2202: re-derive on import, not on publish — the trip's own reader-facing
  // filter (`readerTrack`) is what keeps a draft or a too-recent fix off the
  // page, so a stale track between imports was only ever a staleness problem,
  // not a safety one, and re-deriving here is what makes an import's own
  // effect visible without a second call to POST …/track.
  const rederived = rederiveOverlappingTrips(
    username,
    Math.min(...times),
    Math.max(...times),
  );
  return { ...outcome, stored, rederived };
}

/**
 * D7's "throw it away" branch — delete the raw history an import just
 * wrote, once whatever tracks were wanted have already been derived and
 * written to their trips.
 *
 * **Only the imported file's own time range** (B1843 addendum, 2026-09-24) —
 * not whole months, since B2196 has the phone recording for weeks under D3,
 * and an owner who imports a Google export mid-trip and discards it must not
 * also wipe the phone's own recording for the rest of that month.
 */
export function discardImportedHistory(username: string, range: { from: number; to: number }): { removed: number; months: string[] } {
  return deleteRange(username, range.from, range.to);
}

/** The months currently held — names only, never a fix. What a purge
 * screen offers to delete (B1843 addendum). */
export function gpsMonthsHeld(username: string): string[] {
  return listMonths(username);
}

/**
 * The standalone purge (B1843 addendum) — whole months by name, or every
 * month this journal holds. Bytes are actually removed (`deleteMonths`).
 * Already-drawn `trips/<trip>/track.json` files are a different, published
 * artefact and survive untouched.
 */
export function purgeGpsHistory(
  username: string,
  selection: { months: string[] } | { all: true },
): { monthsDeleted: string[]; monthsHeld: string[] } {
  const held = new Set(listMonths(username));
  // Report what was actually removed, not what was asked for — a named month
  // this journal never held is not a deletion, and claiming it was would be
  // a purge result that lies about its own effect.
  const months = "all" in selection ? [...held] : selection.months.filter((m) => held.has(m));
  deleteMonths(username, months);
  return { monthsDeleted: months, monthsHeld: listMonths(username) };
}

/**
 * Derive one trip's line from what the store holds, and write it.
 *
 * The second half of the loop, and the half that is a *decision*: importing is
 * the owner handing over their history, and this is them saying that this
 * trip's map may show where they went. It reads the store and hands back
 * counts — never a coordinate.
 *
 * Idempotent, and safe to run again whenever the store gains fixes for those
 * dates. It rewrites one file and touches nothing else.
 */
export function deriveTripTrack(
  username: string,
  trip: { id: string; start: string; end: string },
): { segments: number; points: number; zones: number; written: boolean } {
  const zones = readExcludeZones(username);
  // B2202 rework: derivation now covers every trip date, drafts included —
  // never inside the last 24h, though, so a fix nobody has even written a
  // day for yet still cannot reach a reader within the hour. Which dates a
  // reader may actually be shown is decided later, at serve time
  // (`readerTrack`, ./track.ts), never here.
  const track = trackForTrip(username, {
    start: trip.start,
    end: trip.end,
    zones,
    dayTimezones: dayTimezones(username, trip),
    maxEndMs: Date.now() - MIN_AGE_MS,
    trimMetres: TRIM_METRES,
  });
  const points = trackPointCount(track);
  // Nothing left to draw — the store has no fixes for these dates, or every
  // one trimmed away — deletes any existing line rather than leaving it
  // stale (B2202: staleness here is a safety gap, not a convenience).
  if (track.segments.length === 0) {
    deleteTrack(username, trip.id);
    return { segments: 0, points: 0, zones: zones.length, written: false };
  }
  writeTrack(username, trip.id, track);
  return { segments: track.segments.length, points, zones: zones.length, written: true };
}

/**
 * Re-derive every trip whose date range overlaps `[fromMs, toMs]` — B2202.
 * Called after a successful, non-dry-run GPS import, which is now the only
 * place a track is re-derived automatically (publishing and unpublishing a
 * day no longer touch it at all: the reader-facing filter at serve time,
 * `readerTrack`, is what actually enforces which dates are safe to show).
 * Best-effort per trip — one trip's derivation failing must not fail the
 * import, or take down another trip's re-derive with it.
 */
function rederiveOverlappingTrips(
  username: string,
  fromMs: number,
  toMs: number,
): { tripId: string; ok: boolean }[] {
  const results: { tripId: string; ok: boolean }[] = [];
  for (const trip of getTrips(username)) {
    const tripFrom = Date.parse(`${trip.start}T00:00:00Z`);
    const tripTo = Date.parse(`${trip.end}T23:59:59.999Z`);
    if (tripTo < fromMs || tripFrom > toMs) continue;
    try {
      deriveTripTrack(username, { id: trip.id, start: trip.start, end: trip.end });
      results.push({ tripId: trip.id, ok: true });
    } catch {
      results.push({ tripId: trip.id, ok: false });
    }
  }
  return results;
}

/**
 * Private zones over the network — B2203. `exclude.json` used to be
 * something only a shell could write (`docs/gps.md`'s own "a hosted owner
 * cannot keep their home off the route"); `GET`/`PUT /api/v2/<user>/gps/zones`
 * is that door now, and this is the whole of what it may reach for — the same
 * rule the rest of this file follows, and the reason a zone the owner types
 * in never comes back out as a *recorded* position: it is what they typed,
 * never a fix read from the store.
 */
export const ZONE_LIMITS = {
  /** Enough for a home, a work address, a couple of frequent haunts, and
   * nowhere near enough to be a second location history. */
  maxZones: 20,
  /** A radius below 50 m is thinner than most GPS receivers are accurate to
   * — it would look like it worked and clip almost nothing. */
  minRadiusM: 50,
  /** Above 5 km a "private zone" is a whole city, which is not what this
   * door is for — see `docs/gps.md`. */
  maxRadiusM: 5_000,
} as const;

export type { ExcludeZone };

/** `GET`'s whole answer. */
export function listZones(username: string): { zones: ExcludeZone[]; homeDeclined: boolean } {
  return { zones: readExcludeZones(username), homeDeclined: readHomeDeclined(username) };
}

/** `PUT`'s whole answer — replaces the zone list, and updates the decline
 * flag only when the caller actually sent one, so a `PUT` of zones alone
 * never silently un-declines a home the owner already said no to.
 *
 * Both files are written before either is read back: an unreadable
 * `home-declined.json` after a perfectly good zones write must not surface
 * as a generic 500 that looks like nothing happened — the route's own catch
 * around this call answers the same `unreadable_zones` refusal `GET` does,
 * which is honest about what actually failed (the confirming read, not the
 * write) without leaking which write, if any, is now on disk.
 */
export function writeZones(
  username: string,
  zones: ExcludeZone[],
  homeDeclined?: boolean,
): { zones: ExcludeZone[]; homeDeclined: boolean } {
  writeExcludeZones(username, zones);
  if (homeDeclined !== undefined) writeHomeDeclined(username, homeDeclined);
  return listZones(username);
}

export { hasHomeZoneOrDeclined };

/** A day may be offered a place, never a coordinate — B2200. Not exported:
 * `placeForDay`'s one caller (`app/api/helper/[user]/day/place/route.ts`)
 * writes its own inline `{ name, country } | null` rather than importing a
 * type from a module nothing else may reach. */
type PlaceForDay = { name: string; country: string };

/**
 * Longer than this with no fix and a stretch stops counting as dwelling in
 * whichever place preceded it — the same two-hour reading `enrich.ts` uses
 * for a break in the drawn line, so "where was I" and "was this a gap in the
 * line" agree with each other.
 */
const DWELL_CAP_SECONDS = 2 * 60 * 60;

/**
 * The place a person would name for the most of one day's fixes, weighted by
 * how long each one was current — not the single most common fix, and not an
 * average of coordinates, which would land somewhere between two real places
 * on a day spent in both.
 *
 * ponytail: dwell time is approximated as the gap to the *next* fix, capped
 * at two hours — the last fix of a run gets no weight for whatever followed
 * it. That undercounts a day that ends mid-visit, which is a cheaper wrong
 * answer than guessing how long somebody stayed after their phone stopped
 * reporting. Upgrade path, if it ever matters: split each gap between the fix
 * before and after it instead of crediting it whole to the earlier one.
 */
function dwellWeightedPlace(fixes: Fix[]): PlaceForDay | null {
  if (fixes.length === 0) return null;
  const sorted = [...fixes].sort((a, b) => a.t - b.t);
  const weight = new Map<string, number>();
  const label = new Map<string, PlaceForDay>();
  for (let i = 0; i < sorted.length; i++) {
    const next = sorted[i + 1];
    if (!next) continue;
    const seconds = Math.min(DWELL_CAP_SECONDS, (next.t - sorted[i].t) / 1000);
    if (seconds <= 0) continue;
    const place = reverseGeocode(sorted[i].lat, sorted[i].lon);
    if (!place) continue;
    const key = `${place.name}\u0000${place.country}`;
    weight.set(key, (weight.get(key) ?? 0) + seconds);
    if (!label.has(key)) label.set(key, { name: place.name, country: place.country });
  }
  let bestKey: string | null = null;
  let bestWeight = 0;
  for (const [key, w] of weight) {
    if (w > bestWeight) {
      bestWeight = w;
      bestKey = key;
    }
  }
  return bestKey ? (label.get(bestKey) ?? null) : null;
}

/**
 * D1 — a new day may be offered the place its own owner's positions say they
 * were, so the studio's new-day flow can ask "you were in Chiang Mai — use
 * it?" instead of a blank field. This is the **one** function in this
 * codebase that hands back anything derived from a single position rather
 * than a whole trip's shape: `test/gps-store.test.ts` asserts it is the only
 * export here that reaches `readRange`, the same way it asserts nothing
 * under `app/` reaches `./store` or `./enrich` directly. Only the owner's own
 * cookie on the studio's new-day page may call it (`isHelperOwner`,
 * `lib/helper/server.ts`) — a bearer token is refused there by construction,
 * never here, because refusing it in one place that every caller shares is
 * the whole reason B671 put a door in front of `./store` at all.
 *
 * Four rules, in order:
 *
 * 1. **Only a date inside the trip, and not after today.** A day outside the
 *    trip is somebody's ordinary life and never this function's to name; a
 *    day in the future has no fixes yet regardless.
 * 2. **Private zones removed first** (`readExcludeZones`/`isExcluded`,
 *    `./enrich.ts` — the same reader `deriveTripTrack` uses). An unreadable
 *    zone list fails closed: this returns `null` rather than risk naming a
 *    place the owner meant to hide.
 * 3. **The place is wherever the remaining fixes add up to the most dwell
 *    time**, named at city level by the **offline** `reverseGeocode`
 *    (`lib/ingest/geo.ts`) — never a network lookup, so a position never
 *    leaves the server to get a name.
 * 4. **Never a coordinate out.** The answer is `{ name, country }` and
 *    nothing else; a caller that wants a point for the day it writes uses the
 *    geocoded place's own centroid (`reverseGeocode`'s `lat`/`lng`), never a
 *    fix this function read.
 */
export function placeForDay(username: string, tripId: string, date: string): PlaceForDay | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const trip = getTrip(tripRef(username, tripId));
  if (!trip) return null;
  if (date > earliestTodayISO()) return null;
  if (date < trip.start || date > trip.end) return null;

  let zones;
  try {
    zones = readExcludeZones(username);
  } catch {
    // Fail closed, same as `deriveTripTrack`'s own reasoning in docs/gps.md:
    // an unreadable exclusion list must not risk naming somebody's front
    // door rather than simply saying nothing.
    return null;
  }

  const from = Date.parse(`${date}T00:00:00Z`);
  const to = Date.parse(`${date}T23:59:59.999Z`);
  const fixes = readRange(username, from, to).filter((fix) => !isExcluded(fix, zones));
  return dwellWeightedPlace(fixes);
}

/**
 * One calendar date later, as a date string — restated from
 * `./enrich.ts`'s own private `nextDate` rather than imported, the same
 * reason `metresBetween` is restated in `./store.ts`: this is the whole of
 * what api.ts needs it for, and importing a function `enrich.ts` never
 * exports would mean exporting it there just for this one caller.
 */
function nextDate(date: string): string {
  const t = Date.parse(`${date}T00:00:00Z`) + 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** One trip date's own local-midnight-to-local-midnight window, in the
 * timezone its own day carries (else UTC) — B2226, the same rule
 * `deriveTrack`'s `windowsFor` applies per date, restated here for the two
 * functions below that need only a single date's window rather than every
 * date's. */
function localWindow(date: string, tz: string | undefined): { from: number; to: number } {
  const zone = tz ?? "UTC";
  return {
    from: zonedTimeToUtc(date, "00:00", zone).getTime(),
    to: zonedTimeToUtc(nextDate(date), "00:00", zone).getTime(),
  };
}

/** One trip's own status for the owner's "Your route" page — B2226. Counts
 *  and a timestamp, never a coordinate: `coverageOf` (above) already answers
 *  "how much of this trip" without reading a single lat/lon back out, and
 *  this is the same read, per trip, with a last-received instant added.
 *  Trips with no fix at all inside their own dates are left out entirely —
 *  there is nothing to show the owner about them. */
export type RecordedTrip = {
  tripId: string;
  title: string;
  start: string;
  end: string;
  daysRecorded: number;
  tripDays: number;
  /** ISO instant of the newest fix inside this trip's dates. */
  lastReceived: string;
};

export function recordedTrips(username: string): RecordedTrip[] {
  const out: RecordedTrip[] = [];
  for (const trip of getTrips(username)) {
    const from = Date.parse(`${trip.start}T00:00:00Z`);
    const to = Date.parse(`${trip.end}T23:59:59.999Z`);
    const rows = readRange(username, from, to);
    if (rows.length === 0) continue;
    const coverage = coverageOf(rows, trip);
    // A loop, not Math.max(...rows): a long, dense trip passes the argument
    // limit and throws (B2226 security review).
    let newest = 0;
    for (const r of rows) if (r.t > newest) newest = r.t;
    const lastReceived = new Date(newest).toISOString();
    out.push({
      tripId: trip.id,
      title: trip.title,
      start: trip.start,
      end: trip.end,
      daysRecorded: coverage.days,
      tripDays: coverage.tripDays,
      lastReceived,
    });
  }
  return out;
}

/** What `ownerTripLine` answers with — a thinned, simplified line, tagged
 *  per date, and nothing else `Track` itself carries (no `generated`
 *  instant, which is a fact about the file on disk and not about the
 *  route). */
export type OwnerTripLine = { segments: { day?: string; points: [number, number][] }[] };

/**
 * The owner's own full, unclipped view of one trip's recorded route —
 * B2226, the second exception to "nothing reads gps/" after `placeForDay`.
 *
 * Unlike `deriveTripTrack` (what every reader, owner included, is served on
 * a trip's public map), this applies **no** private-zone removal, **no**
 * 24-hour recency cap and **no** end-trimming — the owner looking at their
 * own history is not the audience those three exist to protect. It still
 * thins, simplifies (50 m) and breaks at gaps, because a raw ten-day trip is
 * tens of thousands of points and the point of this view is to see the
 * shape of the travel, not to relay the store byte for byte.
 *
 * Reachable only from the studio's own owner-cookie door
 * (`app/api/helper/[user]/gps/line/route.ts`) — never a bearer token, never
 * the admin cookie, and there is deliberately no `/api/v2` twin (the owner's
 * 2026-09-24 decision: no agent door onto the raw line).
 */
export function ownerTripLine(username: string, tripId: string): OwnerTripLine | null {
  const trip = getTrip(tripRef(username, tripId));
  if (!trip) return null;
  const zones = dayTimezones(username, trip);
  // The trip's own bounds, in each end date's own timezone — the same
  // window `trackForTrip` computes internally (`windowsFor`, ./enrich.ts),
  // restated here rather than imported since this reads the store directly
  // rather than through `trackForTrip`: see `test/gps-store.test.ts`'s
  // derived scan, which finds a position-reading export by its own literal
  // call to `readRange`.
  const from = localWindow(trip.start, zones[trip.start]).from;
  const to = localWindow(trip.end, zones[trip.end]).to;
  const track = deriveTrack(readRange(username, from, to), {
    start: trip.start,
    end: trip.end,
    // No private zones — the owner's own history, shown to the owner alone.
    zones: [],
    dayTimezones: zones,
    // No `maxEndMs`, no `trimMetres` — see the doc comment above.
  });
  return { segments: track.segments.map((s) => ({ day: s.day, points: s.points })) };
}

/** What `deleteTripRecording` answers with — counts, and whether the trip's
 *  own `track.json` still exists afterwards. Never a coordinate. */
export type DeleteRecordingResult = {
  removed: number;
  months: string[];
  track: { segments: number; points: number; written: boolean };
};

/**
 * Remove one trip's recorded positions — the whole trip's window, or a
 * single day's — B2226. This is a studio delete, not the standalone
 * month-by-month purge (B1843): it is scoped to exactly the dates a trip or
 * one of its days covers, in that date's own day's timezone when one was
 * written (else UTC), the same window `deriveTrack` itself uses.
 *
 * The trip's `track.json` is re-derived afterwards (`deriveTripTrack`, which
 * already deletes an empty result) — a delete here must be visible on the
 * trip's own map the moment it returns, not after a separate re-derive call.
 *
 * The phone's own upload buffer is untouched: a position already queued on
 * the device before this ran still arrives later. The page says so in
 * words; this function has no way to reach a phone that is offline.
 */
/** `YYYY-MM-DD` that names a real calendar day — `2026-02-30` does not. */
export function isRealDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const d = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
}

export function deleteTripRecording(
  username: string,
  tripId: string,
  date?: string,
): DeleteRecordingResult | null {
  const trip = getTrip(tripRef(username, tripId));
  if (!trip) return null;
  if (date !== undefined && (!isRealDate(date) || date < trip.start || date > trip.end)) return null;

  const zones = dayTimezones(username, trip);
  const window = date
    ? localWindow(date, zones[date])
    : {
        from: localWindow(trip.start, zones[trip.start]).from,
        to: localWindow(trip.end, zones[trip.end]).to,
      };

  // `deleteRange` includes its `to`; the window's `to` is the next local
  // midnight, which belongs to the next day (`deriveTrack` counts `t < to`).
  const { removed, months } = deleteRange(username, window.from, window.to - 1000);
  const derived = deriveTripTrack(username, { id: trip.id, start: trip.start, end: trip.end });
  return {
    removed,
    months,
    track: { segments: derived.segments, points: derived.points, written: derived.written },
  };
}

// Where a v2 trip and its days actually live on disk — B1612 (phase 2 step
// 3, parcel B). B1606: `content/<user>/trips/<id>/trip.json`, one file, and
// `content/<user>/trips/<id>/entries/YYYY-MM-DD-slug.json`, one per day.
//
// Not `lib/trips.ts`/`lib/entries.ts`, though those have since caught up:
// B1598's phase-3 replay landed, and `readTrip` (`lib/trips.ts:641-646`) and
// `readAllEntries` (`lib/entries.ts:294,306`) now read `trip.json` and
// `entries/*.json` directly, the same encoding this module knows. This
// module remains the fs layer the v2 write routes use — it knows the JSON
// encoding (`./documents.ts`) and nothing else.
import "server-only";
import fs from "node:fs";
import path from "node:path";
import { contentRoot } from "../../contentRoot";
import {
  dayFromJson,
  dayToJson,
  tripFromJson,
  tripToJson,
  unknownTripKeys,
  type DayFile,
  type TripFile,
} from "./documents";

/**
 * A journal name, a trip id and a day slug are each ONE path segment — never
 * a path — B1892.
 *
 * Every function in this module builds a filename out of values that came off
 * the wire, and `path.join` collapses `..` without complaint, so
 * `../../victim/trips/paris` reached another journal's days through any door
 * that did not check for itself (the studio's reshape route did not). The
 * guard sits in the two path builders rather than in the routes because this
 * is where every caller passes through, and a caller that forgets is the
 * whole bug.
 *
 * It throws rather than returning null: a separator in a trip id is never a
 * legitimate request, and the reading functions below turn it into their own
 * "no such thing" answer (a 404) by catching it, while a write is stopped
 * loudly rather than silently not happening.
 */
function safeSegment(value: string): string {
  if (/[/\\]/.test(value) || value.includes("\0") || value === "." || value === "..") {
    throw new Error(`unsafe path segment: ${JSON.stringify(value)}`);
  }
  return value;
}

function tripDirFor(user: string, tripId: string): string {
  return path.join(contentRoot(), safeSegment(user), "trips", safeSegment(tripId));
}

function tripJsonPath(user: string, tripId: string): string {
  return path.join(tripDirFor(user, tripId), "trip.json");
}

function entriesDirFor(user: string, tripId: string): string {
  return path.join(tripDirFor(user, tripId), "entries");
}

function dayJsonPath(user: string, tripId: string, slug: string): string {
  return path.join(entriesDirFor(user, tripId), `${safeSegment(slug)}.json`);
}

/** `null` for "no such trip" AND for "the file is there but will not parse" —
 * a route cannot tell those apart usefully from here, and both read as
 * `unknown_trip` to a caller. */
export function readTripFile(user: string, tripId: string): TripFile | null {
  try {
    const file = tripJsonPath(user, tripId);
    if (!fs.existsSync(file)) return null;
    return tripFromJson(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Every key on this trip's `trip.json` that `tripFromJson` has no reading
 * for — B1639. Read-modify-write (a PATCH) rebuilds the whole document from
 * `TripFile`, so a key that got in some other way (a hand edit, a version
 * ahead of this one) would otherwise vanish the next time anything touched
 * the trip, with nothing said: every wire body already refuses an unknown
 * key at the door (every trip schema is a `strictObject`), but that guard
 * never sees a file already sitting on disk. `[]` for no such file, same as
 * "nothing unknown" — a caller that needs to tell those apart already knows
 * whether the trip exists before asking this.
 */
export function tripFileUnknownKeys(user: string, tripId: string): string[] {
  try {
    const file = tripJsonPath(user, tripId);
    if (!fs.existsSync(file)) return [];
    return unknownTripKeys(fs.readFileSync(file, "utf8"));
  } catch {
    return [];
  }
}

export function writeTripFile(user: string, tripId: string, trip: TripFile): void {
  fs.mkdirSync(tripDirFor(user, tripId), { recursive: true });
  fs.writeFileSync(tripJsonPath(user, tripId), tripToJson(trip));
}

/** Every trip id this journal has a readable `trip.json` for. */
export function listTripIds(user: string): string[] {
  let root: string;
  let folders: fs.Dirent[];
  try {
    root = path.join(contentRoot(), safeSegment(user), "trips");
    folders = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return folders
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((id) => fs.existsSync(path.join(root, id, "trip.json")));
}

export function readDayFile(user: string, tripId: string, slug: string): DayFile | null {
  try {
    const file = dayJsonPath(user, tripId, slug);
    if (!fs.existsSync(file)) return null;
    return dayFromJson(slug, fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function writeDayFile(user: string, tripId: string, slug: string, day: DayFile): void {
  fs.mkdirSync(entriesDirFor(user, tripId), { recursive: true });
  fs.writeFileSync(dayJsonPath(user, tripId, slug), dayToJson(day));
}

export function deleteDayFile(user: string, tripId: string, slug: string): void {
  const file = dayJsonPath(user, tripId, slug);
  try {
    fs.rmSync(file);
  } catch {
    // Already gone — deleting twice is not an error worth reporting here;
    // the route already checked the day existed before calling this.
  }
}

/**
 * A slug that might be the bare, app-facing form (`entrySlugFromFile`,
 * lib/entries.ts — what `EditDay.tsx` and every owner page actually hold,
 * since that is what `Entry.slug` is) → the full on-disk stem this store's
 * own functions address a day by. Found live, while fixing B1831/B1832:
 * `EditDay`'s Save sent `entry.slug` (bare) straight to
 * `/api/web/{user}/trips/{trip}/days/{slug}`, which called `readDayFile`
 * with it unresolved — `entries/into-italy.json` rather than the real
 * `entries/2024-09-14-into-italy.json` — and 404'd on every real day whose
 * date differs from nothing being in its own filename (i.e. every real day
 * ever created; only hand-built test fixtures that pass the full stem
 * directly happened to hide it). `/api/v2/...` is unaffected — an agent's
 * bearer-authenticated caller already sends the full stem, the documented
 * v2 convention — so only the web (cookie) doors that feed a bare
 * `Entry.slug` back to this store need this resolution at all.
 *
 * Returns the slug unchanged when it already matches a file exactly (so an
 * already-correct caller costs nothing extra), then falls back to a
 * directory scan. `null` when nothing matches either way.
 */
export function resolveDayStem(user: string, tripId: string, slug: string): string | null {
  const stems = listDaySlugs(user, tripId);
  if (stems.includes(slug)) return slug;
  return stems.find((stem) => stem.replace(/^\d{4}-\d{2}-\d{2}-/, "") === slug) ?? null;
}

/** Every slug this trip has a readable day file for, sorted (oldest first —
 * the slug's own date prefix sorts lexicographically). */
export function listDaySlugs(user: string, tripId: string): string[] {
  let files: string[];
  try {
    // Throws on an unsafe id (`safeSegment`) — caught here, so a traversal
    // attempt reads as a trip with no days rather than a crash.
    files = fs.readdirSync(entriesDirFor(user, tripId));
  } catch {
    return [];
  }
  return files
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -".json".length))
    .sort();
}

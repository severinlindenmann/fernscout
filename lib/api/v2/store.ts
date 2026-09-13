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
import { dayFromJson, dayToJson, tripFromJson, tripToJson, type DayFile, type TripFile } from "./documents";

function tripDirFor(user: string, tripId: string): string {
  return path.join(contentRoot(), user, "trips", tripId);
}

function tripJsonPath(user: string, tripId: string): string {
  return path.join(tripDirFor(user, tripId), "trip.json");
}

function entriesDirFor(user: string, tripId: string): string {
  return path.join(tripDirFor(user, tripId), "entries");
}

function dayJsonPath(user: string, tripId: string, slug: string): string {
  return path.join(entriesDirFor(user, tripId), `${slug}.json`);
}

/** `null` for "no such trip" AND for "the file is there but will not parse" —
 * a route cannot tell those apart usefully from here, and both read as
 * `unknown_trip` to a caller. */
export function readTripFile(user: string, tripId: string): TripFile | null {
  const file = tripJsonPath(user, tripId);
  if (!fs.existsSync(file)) return null;
  try {
    return tripFromJson(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function writeTripFile(user: string, tripId: string, trip: TripFile): void {
  fs.mkdirSync(tripDirFor(user, tripId), { recursive: true });
  fs.writeFileSync(tripJsonPath(user, tripId), tripToJson(trip));
}

/** Every trip id this journal has a readable `trip.json` for. */
export function listTripIds(user: string): string[] {
  const root = path.join(contentRoot(), user, "trips");
  let folders: fs.Dirent[];
  try {
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
  const file = dayJsonPath(user, tripId, slug);
  if (!fs.existsSync(file)) return null;
  try {
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

/** Every slug this trip has a readable day file for, sorted (oldest first —
 * the slug's own date prefix sorts lexicographically). */
export function listDaySlugs(user: string, tripId: string): string[] {
  let files: string[];
  try {
    files = fs.readdirSync(entriesDirFor(user, tripId));
  } catch {
    return [];
  }
  return files
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -".json".length))
    .sort();
}

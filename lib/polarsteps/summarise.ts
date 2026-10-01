/**
 * Finding the trips inside a Polarsteps `user_data.zip` from its already-read
 * entry list — the one piece of discovery logic the studio's import flow
 * (`components/studio/import/PolarstepsImportFlow.tsx`, B2662) and the public
 * `/switch` preview (B2663) both need. Framework-free: nothing here imports
 * React, `@/components/*` or `@/lib/i18n`, so a marketing page can use it with
 * no studio code riding along.
 *
 * Reads only `trip.json` (capped, same limit the import door accepts) and,
 * when asked, each trip's `locations.json` (capped at the same size the
 * studio's gps-import step reads) — never anything else in the zip, and
 * never anything leaves the browser.
 */
import { readZipEntryText, ZipError, type ZipEntry } from "@/lib/zip/readZip";
import { parsePolarstepsTrip, type PolarstepsTrip } from "@/importers/trips/polarsteps";
import { JSON_BODY_MAX_BYTES } from "@/lib/api/jsonBody";

const TRIP_JSON = /^trip\/([^/]+)\/trip\.json$/;
export const TRIP_JSON_MAX_BYTES = JSON_BODY_MAX_BYTES;
export const LOCATIONS_JSON_MAX_BYTES = 50 * 1024 * 1024;

export type DiscoveredTrip = {
  folder: string;
  entry: ZipEntry;
  trip: PolarstepsTrip;
  photos: number;
  videos: number;
  locationsEntry?: ZipEntry;
  /** Only set when `opts.countGps` asked for it. */
  gpsPoints?: number;
};

export type DiscoverResult = {
  trips: DiscoveredTrip[];
  /** A trip.json entry existed but could not be read safely (oversized or
   * malformed) — said once, even if several were refused. */
  anyUnreadable: boolean;
};

/** The earliest and latest step date a trip's own `all_steps` give it, for
 * a trip whose `start_date`/`end_date` are absent — a confirmed real-export
 * quirk (B2432). Returns `null` when the trip has no steps with a time. */
export function tripDateRange(trip: PolarstepsTrip): { start: string; end: string } | null {
  // The importer's own local dates, so the preview names exactly the days
  // the import will write — never the UTC date of an evening step.
  const days = parsePolarstepsTrip(trip).days;
  if (days.length === 0) return null;
  return { start: days[0].date, end: days[days.length - 1].date };
}

/** Every trip a zip's entry index names, with its photo/video counts and
 * (optionally) its GPS point count. Never reads a second time what the
 * caller already read once — `readLocationsCount` is a seam the import flow
 * does not need (it reads `locations.json` itself, later, for the real
 * import) and the preview does (it has nothing else to show numbers from). */
export async function discoverPolarstepsTrips(
  file: Blob,
  entries: ZipEntry[],
  opts: { countGps?: boolean } = {},
): Promise<DiscoverResult> {
  const trips: DiscoveredTrip[] = [];
  let anyUnreadable = false;

  for (const entry of entries) {
    const match = TRIP_JSON.exec(entry.name);
    if (!match) continue;
    const folder = match[1];
    let trip: PolarstepsTrip;
    try {
      const text = await readZipEntryText(file, entry, { maxBytes: TRIP_JSON_MAX_BYTES });
      trip = JSON.parse(text) as PolarstepsTrip;
    } catch (err) {
      if (err instanceof ZipError) anyUnreadable = true;
      continue; // an unparseable trip.json is skipped; the others still import
    }

    const prefix = `trip/${folder}/`;
    let photos = 0;
    let videos = 0;
    for (const e of entries) {
      if (!e.name.startsWith(prefix)) continue;
      if (e.name.includes("/photos/")) photos++;
      else if (e.name.includes("/videos/")) videos++;
    }
    const locationsEntry = entries.find((e) => e.name === `${prefix}locations.json`);

    let gpsPoints: number | undefined;
    if (opts.countGps && locationsEntry) {
      try {
        const text = await readZipEntryText(file, locationsEntry, { maxBytes: LOCATIONS_JSON_MAX_BYTES });
        const parsed = JSON.parse(text) as { locations?: unknown[] };
        gpsPoints = Array.isArray(parsed.locations) ? parsed.locations.length : 0;
      } catch {
        gpsPoints = 0; // a locations.json that cannot be read safely counts as none, never guessed
      }
    }

    trips.push({ folder, entry, trip, photos, videos, locationsEntry, gpsPoints });
  }

  return { trips, anyUnreadable };
}

/**
 * A Polarsteps trip export — `trip.json`, confirmed 2026-10-01 from a real
 * trimmed export (itay-raveh/wanderbound `fixtures/demo`, AGPL — read for
 * the shape only, nothing copied here) and niekvleeuwen/polarsteps-data-
 * parser (MIT). See `docs/tasks/in-development/B2432-…md`'s "Design
 * 2026-10-01" for the full account of what is and is not in the file.
 *
 * This is the row/document type for the `trips/` kind, the same role
 * `gps/schema.ts` and `contacts/schema.ts` play for theirs — plain types and
 * nothing that reaches a network, a disk or a journal.
 */

export type PolarstepsLocation = {
  /** A place name, or null — a step taken at sea often has neither. */
  name: string | null;
  /** The country's name, or null. Never a code; `country_code` is that. */
  detail: string | null;
  /** ISO 3166-1 alpha-2, or the literal `"00"` Polarsteps writes for a step
   *  taken at sea — never a real country and never uppercased into one. */
  country_code: string;
  lat: number;
  lon: number;
};

export type PolarstepsStep = {
  id: number;
  /** Almost always null in practice; `display_name` is what Polarsteps
   *  itself shows and is what this importer keeps. */
  name?: string | null;
  display_name: string;
  display_slug: string;
  description?: string | null;
  /** Unix seconds, UTC, as a float — Polarsteps' own export writes
   *  sub-second precision that this importer does not need. */
  start_time: number;
  /** IANA zone — the step's own local time is this, applied to
   *  `start_time`, never the trip's or the reader's zone. */
  timezone_id: string;
  location: PolarstepsLocation;
  /** Absent on most steps in a real export; present on some. Never
   *  invented when absent — see `checkWeatherData` in
   *  `lib/validate/entry.ts` for why a reading needs its source named. */
  weather_condition?: string;
  weather_temperature?: number;
};

export type PolarstepsTrip = {
  id: number;
  slug: string;
  name: string;
  summary?: string | null;
  step_count?: number;
  /** Absent in a real export — the trip's own span is derived from its
   *  steps instead, never trusted from here. */
  start_date?: string;
  end_date?: string;
  /** Arrives unsorted — Polarsteps writes it in whatever order the app's
   *  own sync happened to produce. */
  all_steps: PolarstepsStep[];
};

/** A day's worth of steps, grouped by the **local** date `start_time` falls
 * on in each step's own `timezone_id` — never UTC, never the trip's. */
export type PolarstepsDay = {
  date: string;
  steps: PolarstepsStep[];
};

export type ParsedPolarstepsTrip = {
  sourceId: number;
  title: string;
  tagline?: string;
  /** Sorted by date, ascending. Only dates that actually have a step — a
   *  gap in the trip is a gap, not a blank day. */
  days: PolarstepsDay[];
  /** The first and last local date among `days` — `""` for a trip with no
   *  steps at all, which `checkPolarstepsTrip` below flags. */
  start: string;
  end: string;
};

/**
 * **Run this against your own parse.** Same contract as `gps/`'s
 * `checkGpsImporter`: bring the shape above, call this, fix what it lists.
 */
export function checkPolarstepsTrip(parsed: ParsedPolarstepsTrip): string[] {
  const problems: string[] = [];
  if (!parsed.title.trim()) problems.push("the trip has no name");
  if (parsed.days.length === 0) {
    problems.push("no steps at all — every step was skipped, or the export holds none");
  }
  for (let i = 1; i < parsed.days.length; i++) {
    if (parsed.days[i].date <= parsed.days[i - 1].date) {
      problems.push(`days are not sorted or contain a duplicate date at index ${i}`);
      break;
    }
  }
  return problems;
}

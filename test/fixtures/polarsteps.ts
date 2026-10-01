/**
 * A synthetic Polarsteps export — B2432/B2662. Severin has no Polarsteps
 * account (owner decision 2026-10-01), so this is built from the confirmed
 * format rather than a real download: two trips, every quirk the ticket
 * names, nothing copied from any third-party fixture.
 *
 * Quirks covered, one per trip where it fits naturally:
 * - a step at 23:30 America/New_York (trip A, step A3)
 * - a step crossing UTC midnight in Asia/Tokyo (trip B, step B1)
 * - null `name`/`description` (trip A, step A1)
 * - country `"00"` at sea (trip A, step A1)
 * - `all_steps` and `locations.json` arrive unsorted (both trips)
 * - a `.jpg.jpg` photo filename (trip A, step A1)
 * - one video (trip B, step B1)
 * - a step with no media at all (trip A, step A3; trip B, step B2)
 * - weather on some steps, absent on others (trip A step A2 has it, A1/A3
 *   do not; trip B step B2 has it, B1 does not)
 * - no `start_date`/`end_date` on either trip
 */
import type { PolarstepsStep, PolarstepsTrip } from "@/importers/trips/polarsteps";

const SEC = (y: number, m: number, d: number, h: number, min: number, s = 0) =>
  Date.UTC(y, m - 1, d, h, min, s) / 1000;

export const TRIP_A_ID = 5001;
export const TRIP_B_ID = 5002;

const stepA1: PolarstepsStep = {
  id: 11,
  name: null,
  display_name: "Ferry at dawn",
  display_slug: "ferry-at-dawn",
  description: null,
  start_time: SEC(2026, 4, 15, 10, 0),
  timezone_id: "UTC",
  location: { name: null, detail: null, country_code: "00", lat: 60.1, lon: 5.1 },
};
const stepA2: PolarstepsStep = {
  id: 12,
  display_name: "Bergen harbour",
  display_slug: "bergen-harbour",
  description: "Walked along the quay.",
  start_time: SEC(2026, 4, 16, 9, 0),
  timezone_id: "Europe/Oslo",
  location: { name: "Bergen", detail: "Norway", country_code: "NO", lat: 60.39, lon: 5.32 },
  weather_condition: "clear-day",
  weather_temperature: 14,
};
/** Local 2026-05-01 23:30 America/New_York — 2026-05-02T03:30:00Z. The
 * acceptance line this step exists for: it must land on 2026-05-01, not
 * the UTC date (2026-05-02). */
const stepA3: PolarstepsStep = {
  id: 13,
  name: null,
  display_name: "Late arrival",
  display_slug: "late-arrival",
  description: "",
  start_time: SEC(2026, 5, 2, 3, 30),
  timezone_id: "America/New_York",
  location: { name: "New York", detail: "United States", country_code: "US", lat: 40.7, lon: -74.0 },
};

export const tripA: PolarstepsTrip = {
  id: TRIP_A_ID,
  slug: "alpine-loop",
  name: "Alpine Loop",
  summary: "Mountains and fjords.",
  step_count: 3,
  // Deliberately unsorted — A3, A1, A2 — and no start_date/end_date, both
  // confirmed quirks of a real export.
  all_steps: [stepA3, stepA1, stepA2],
};

/** Local 2026-07-11 05:00 Asia/Tokyo — 2026-07-10T20:00:00Z. The UTC date
 * (2026-07-10) and the local date (2026-07-11) disagree, which is the case
 * this step exists to exercise. */
const stepB1: PolarstepsStep = {
  id: 21,
  display_name: "Shibuya crossing",
  display_slug: "shibuya-crossing",
  description: "So many people.",
  start_time: SEC(2026, 7, 10, 20, 0),
  timezone_id: "Asia/Tokyo",
  location: { name: "Tokyo", detail: "Japan", country_code: "JP", lat: 35.66, lon: 139.7 },
};
const stepB2: PolarstepsStep = {
  id: 22,
  display_name: "Ramen shop",
  display_slug: "ramen-shop",
  description: "Tonkotsu, extra noodles.",
  start_time: SEC(2026, 7, 11, 23, 0),
  timezone_id: "Asia/Tokyo",
  location: { name: "Tokyo", detail: "Japan", country_code: "JP", lat: 35.68, lon: 139.76 },
  weather_condition: "clear-day",
  weather_temperature: 29,
};

export const tripB: PolarstepsTrip = {
  id: TRIP_B_ID,
  slug: "tokyo-nights",
  name: "Tokyo Nights",
  summary: null,
  step_count: 2,
  all_steps: [stepB2, stepB1],
};

/** `locations.json` for one trip — unsorted, `time` as a float unix
 * seconds, same as a real export. */
export function locationsJsonFor(trip: "a" | "b"): string {
  const points =
    trip === "a"
      ? [
          { lat: 60.1, lon: 5.1, time: SEC(2026, 4, 15, 10, 5) + 0.25 },
          { lat: 60.39, lon: 5.32, time: SEC(2026, 4, 16, 9, 2) + 0.75 },
          { lat: 60.2, lon: 5.2, time: SEC(2026, 4, 15, 10, 2) },
        ]
      : [
          { lat: 35.66, lon: 139.7, time: SEC(2026, 7, 10, 20, 1) + 0.5 },
          { lat: 35.68, lon: 139.76, time: SEC(2026, 7, 11, 23, 1) },
        ];
  return JSON.stringify({ locations: points });
}

/** A step's media — filenames only, relative to its own folder, exactly
 * where a real export puts them (`<display_slug>_<id>/photos|videos/…`). */
export function mediaFor(step: PolarstepsStep): { photos: string[]; videos: string[] } {
  if (step.id === stepA1.id) return { photos: ["aaaa1111-0000-0000-0000-000000000001_bbbb2222-0000-0000-0000-000000000002.jpg.jpg"], videos: [] };
  if (step.id === stepA2.id) return { photos: ["cccc3333-0000-0000-0000-000000000003_dddd4444-0000-0000-0000-000000000004.jpg"], videos: [] };
  if (step.id === stepB1.id) return { photos: [], videos: ["clip.mp4"] };
  // A3 and B2 have no media folder at all — the confirmed quirk.
  return { photos: [], videos: [] };
}

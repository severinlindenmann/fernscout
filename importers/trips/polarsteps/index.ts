import type { ParsedPolarstepsTrip, PolarstepsStep, PolarstepsTrip } from "./schema";

export type { ParsedPolarstepsTrip, PolarstepsStep, PolarstepsTrip } from "./schema";

/** `step.start_time`'s own local calendar date, in `step.timezone_id` —
 * never UTC. `Intl` resolves the real historical offset for the zone at
 * that instant, which is the only correct source (a stored UTC offset is
 * not a constant). A step at 23:30 America/New_York lands on that evening's
 * date; a step at 00:05 in Asia/Tokyo that is still "yesterday" in UTC lands
 * on today. Falls back to UTC for a zone `Intl` does not recognise, rather
 * than throwing: one broken timezone_id must not cost the whole trip. */
function localDate(startTimeSeconds: number, timezoneId: string): string {
  const instant = new Date(startTimeSeconds * 1000);
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezoneId,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(instant);
  } catch {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(instant);
  }
}

/**
 * `trip.json` → one Polarsteps trip, its steps sorted into time order and
 * grouped onto their own local dates — the whole of what this importer
 * does. No disk, no network, no idea what a Fernscout trip or day is;
 * everything downstream (writing a draft trip, a draft day per date, the
 * media each step carries) is `lib/polarsteps/api.ts`'s job, same as every
 * other importer here.
 */
export function parsePolarstepsTrip(trip: PolarstepsTrip): ParsedPolarstepsTrip {
  // all_steps arrives unsorted (confirmed 2026-10-01) — sort once, here,
  // so every caller downstream sees time order without re-deriving it.
  const steps = [...trip.all_steps].sort((a, b) => a.start_time - b.start_time);

  const byDate = new Map<string, PolarstepsStep[]>();
  for (const step of steps) {
    const date = localDate(step.start_time, step.timezone_id || "UTC");
    const list = byDate.get(date);
    if (list) list.push(step);
    else byDate.set(date, [step]);
  }

  const dates = [...byDate.keys()].sort();
  const days = dates.map((date) => ({ date, steps: byDate.get(date)! }));

  return {
    sourceId: trip.id,
    title: trip.name,
    tagline: trip.summary ?? undefined,
    days,
    start: dates[0] ?? "",
    end: dates[dates.length - 1] ?? "",
  };
}

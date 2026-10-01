import "server-only";
import { polarstepsTripSchema } from "@/lib/api/v2/schemas/polarsteps";
import { parsePolarstepsTrip, type ParsedPolarstepsTrip, type PolarstepsStep } from "@/importers/trips/polarsteps";
import { createDraft } from "@/lib/api/entries";
import { createTrip } from "@/lib/tripWrite";
import { tripRef } from "@/lib/trips";
import { slugify } from "@/lib/tripId";
import { NO_PROSE } from "@/lib/helper/draft";
import type { DayWeather } from "@/lib/weather";

/**
 * What an API route may reach for a Polarsteps import — B2432. Same rule as
 * `lib/gps/api.ts`'s own module doc: a route authenticates, finds the
 * bytes and answers; everything about what the import kind *means* lives
 * here.
 *
 * **Not in the export, and not written by this function either**: comments,
 * followers, buddies, full-resolution photographs (Polarsteps re-encodes
 * before export) and `user/user.json`. `notImported` on the outcome says so
 * explicitly, so the studio screen (B2662) can show it without the reader
 * ever wondering whether it was missed by accident.
 */

const POLARSTEPS_NOT_IMPORTED = [
  "comments",
  "followers",
  "buddies",
  "full-resolution photographs — Polarsteps' own export re-encodes them",
] as const;

type PolarstepsDayOutcome = {
  date: string;
  steps: number;
  /** Present only on a real run — the day this date's steps were written
   *  to, so the caller (B2662's browser flow) knows where each step's media
   *  belongs. */
  slug?: string;
};

export type PolarstepsImportOutcome = {
  kind: "polarsteps";
  tripId?: string;
  title: string;
  tagline?: string;
  start: string;
  end: string;
  days: PolarstepsDayOutcome[];
  /** Every step id → the day slug it landed on. Present only on a real
   *  run — the exact map B2662's browser flow needs to upload each step's
   *  own photographs and videos to the right day. */
  stepDays?: Record<string, string>;
  notImported: readonly string[];
  dryRun: boolean;
};

/** Each maps straight onto an existing v2 error code at the route — see
 * `app/api/v2/[user]/import/route.ts`'s own `polarsteps` branch: `contract`
 * → `unreadable` (same as a gps/contacts parse failure), `duplicate` →
 * `trip_exists` (this is exactly that refusal, reached through the import
 * door rather than `createTrip` directly), `day_write_failed` →
 * `invalid_entry`. */
export type PolarstepsImportRefusal = {
  refusal: "contract" | "duplicate" | "day_write_failed";
  message: string;
  problems?: string[];
};

export function isPolarstepsRefusal(
  result: PolarstepsImportOutcome | PolarstepsImportRefusal,
): result is PolarstepsImportRefusal {
  return "refusal" in result;
}

/** The Fernscout trip id this Polarsteps trip always maps to —
 * deterministic from its own numeric id, never from anything that could
 * change between two exports of the same trip. This is also the whole of
 * how re-importing the same trip is refused: `createTrip` already refuses
 * a trip id that exists (`trip_exists`), so a second import of the same
 * Polarsteps trip collides with the first one's folder without this module
 * tracking anything of its own. */
function fernscoutTripId(parsed: ParsedPolarstepsTrip): string {
  const base = slugify(parsed.title) || "trip";
  return `${base}-ps${parsed.sourceId}`;
}

/** A step's text, verbatim, never invented — both fields may be null/empty,
 * and a step with neither contributes nothing rather than a placeholder. */
function stepText(step: PolarstepsStep): string {
  const parts = [step.display_name?.trim(), step.description?.trim()].filter(
    (s): s is string => !!s,
  );
  // display_name repeated as the description verbatim (common in a real
  // export) is kept once, not twice.
  return [...new Set(parts)].join("\n\n");
}

/** The day's place — the first step that actually names one. A step at sea
 * (`country_code: "00"`) never contributes a country; its coordinates are
 * real but "00" is not a country code and nothing downstream reads it as
 * one. */
function dayPlace(steps: PolarstepsStep[]): { location?: string; country?: string; countryCode?: string } {
  const location = steps.find((s) => s.location.name)?.location.name ?? undefined;
  const withCountry = steps.find((s) => s.location.detail && s.location.country_code !== "00");
  return {
    location,
    country: withCountry?.location.detail ?? undefined,
    countryCode: withCountry?.location.country_code,
  };
}

/** The day's weather, only when at least one step actually carries a
 * reading — most steps in a real export carry none at all. A single point
 * reading stands in for both `tempMin` and `tempMax`; that is the whole of
 * what a one-sample measurement can honestly say, never a guessed range.
 * ponytail: a day with several steps each reporting a different
 * temperature keeps only the first — a daily high/low would need more than
 * one point, and nothing here invents the rest. */
function dayWeather(steps: PolarstepsStep[]): DayWeather | undefined {
  const withWeather = steps.find((s) => typeof s.weather_temperature === "number");
  if (!withWeather) return undefined;
  return {
    tempMax: withWeather.weather_temperature,
    source: "polarsteps",
    recordedAt: new Date(withWeather.start_time * 1000).toISOString(),
  };
}

function previewPolarsteps(parsed: ParsedPolarstepsTrip): PolarstepsImportOutcome {
  return {
    kind: "polarsteps",
    title: parsed.title,
    tagline: parsed.tagline,
    start: parsed.start,
    end: parsed.end,
    days: parsed.days.map((d) => ({ date: d.date, steps: d.steps.length })),
    notImported: POLARSTEPS_NOT_IMPORTED,
    dryRun: true,
  };
}

/**
 * The real run: a draft trip, one draft day per local date, every step's
 * text verbatim in time order. Nothing is published — `createTrip` and
 * `createDraft` both only ever write `status: "draft"` content, same as
 * every other door onto this journal.
 */
function writePolarstepsTrip(username: string, parsed: ParsedPolarstepsTrip): PolarstepsImportOutcome | PolarstepsImportRefusal {
  const tripId = fernscoutTripId(parsed);

  const created = createTrip(username, {
    id: tripId,
    title: parsed.title,
    tagline: parsed.tagline,
    start: parsed.start,
    end: parsed.end,
  });
  if (!created.ok) {
    if (created.error === "trip_exists") {
      return {
        refusal: "duplicate",
        message:
          `This Polarsteps trip was already imported, as "${tripId}". Re-importing the same ` +
          "export does not duplicate it; open the existing trip in the studio instead.",
      };
    }
    return { refusal: "contract", message: created.message };
  }

  const ref = tripRef(username, tripId);
  const days: PolarstepsDayOutcome[] = [];
  const stepDays: Record<string, string> = {};

  for (const day of parsed.days) {
    const place = dayPlace(day.steps);
    const text = day.steps.map(stepText).filter(Boolean).join("\n\n");
    const result = createDraft(ref, {
      date: day.date,
      content: text || NO_PROSE,
      location: place.location,
      country: place.country,
      countryCode: place.countryCode,
      weatherData: dayWeather(day.steps),
    });
    if (!result.ok) {
      return {
        refusal: "day_write_failed",
        message: `Writing the day for ${day.date} failed: ${result.error}. The trip "${tripId}" was already created and keeps whatever days wrote before this one.`,
      };
    }
    days.push({ date: day.date, steps: day.steps.length, slug: result.slug });
    for (const step of day.steps) stepDays[String(step.id)] = result.slug;
  }

  return {
    kind: "polarsteps",
    tripId,
    title: parsed.title,
    tagline: parsed.tagline,
    start: parsed.start,
    end: parsed.end,
    days,
    stepDays,
    notImported: POLARSTEPS_NOT_IMPORTED,
    dryRun: false,
  };
}

/** The one entry point a route reaches for — parses, validates, and either
 * previews or writes, exactly the shape `importGps` plays for the `gps`
 * kind. */
export function importPolarsteps(
  username: string,
  text: string,
  opts: { dryRun: boolean },
): PolarstepsImportOutcome | PolarstepsImportRefusal {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { refusal: "contract", message: "Not valid JSON — this import expects one trip.json file, not a whole export ZIP." };
  }

  const parsedBody = polarstepsTripSchema.safeParse(raw);
  if (!parsedBody.success) {
    return {
      refusal: "contract",
      message: "This does not look like a Polarsteps trip.json export.",
      problems: parsedBody.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    };
  }

  const parsed = parsePolarstepsTrip(parsedBody.data);
  if (opts.dryRun) return previewPolarsteps(parsed);
  return writePolarstepsTrip(username, parsed);
}

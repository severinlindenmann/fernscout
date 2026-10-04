// Countries visited without a trip — B2914. /api/v2/{user}/visited.
//
// A person who tracks the countries they have been to can record an old one
// without writing a trip for it: the country, and optionally a few words, a
// month and year, one photograph and a note. One document per country (the
// country is the id), so a second add for the same country lands on the first.
import { z } from "zod";
import worldCountries from "../../../worldCountries.json";
import { VISIBILITIES } from "../../../tripWrite";

/** Every code the map can draw — the same list the trips page frames from. */
const COUNTRY_CODE_SET = new Set<string>((worldCountries as { code: string }[]).map((c) => c.code));

export function isCountryCode(code: string): boolean {
  return COUNTRY_CODE_SET.has(code);
}

const VISITED_PLACES_MAX = 200;
const VISITED_NOTE_MAX = 1000;
const VISITED_YEAR_MIN = 1900;
const VISITED_BATCH_MAX = 300;
export const VISITED_DEFAULT_VISIBILITY = "guest" as const;

/** ISO 3166-1 alpha-2 and one the world map knows. Lowercase is accepted and
 * folded to uppercase by the store, so `no` and `NO` name one country. */
export const countryCode = z
  .string()
  .trim()
  .length(2)
  .refine((s) => isCountryCode(s.toUpperCase()), "must be a two-letter ISO 3166-1 country code the map knows, e.g. NO");

const currentYear = () => new Date().getUTCFullYear();

const places = z.string().trim().min(1).max(VISITED_PLACES_MAX);
const year = z.number().int().min(VISITED_YEAR_MIN).refine((y) => y <= currentYear(), "cannot be in the future");
const month = z.number().int().min(1).max(12);
const note = z.string().trim().min(1).max(VISITED_NOTE_MAX);
const visibility = z.enum(VISIBILITIES);

const monthNeedsYear = (v: { year?: number | null; month?: number | null }) =>
  v.month === undefined || v.month === null || (v.year !== undefined && v.year !== null);
const MONTH_NEEDS_YEAR = { message: "a month needs a year", path: ["month"] };

export const visitedCreate = z
  .strictObject({
    country: countryCode,
    places: places.optional(),
    year: year.optional(),
    month: month.optional(),
    note: note.optional(),
    visibility: visibility.optional(),
  })
  .refine(monthNeedsYear, MONTH_NEEDS_YEAR);

/** Adding countries in bulk — the checklist. Each entry is a `visitedCreate`. */
export const visitedBatch = z.strictObject({
  entries: z.array(visitedCreate).min(1).max(VISITED_BATCH_MAX),
});

/** `null` clears a field. The country is the id and cannot change. The photo
 * has its own door (`PUT/DELETE .../visited/{code}/photo`). */
export const visitedPatch = z
  .strictObject({
    places: places.nullable().optional(),
    year: year.nullable().optional(),
    month: month.nullable().optional(),
    note: note.nullable().optional(),
    visibility: visibility.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "send at least one field to change");

export const visitedDoc = z.strictObject({
  country: z.string(),
  places: z.string().optional(),
  year: z.number().int().optional(),
  month: z.number().int().optional(),
  note: z.string().optional(),
  /** The one photograph, when there is one: `src` is its file name, `url` the
   * address it is served at (gated by this entry's own visibility). */
  photo: z.strictObject({ src: z.string(), url: z.string() }).optional(),
  visibility: z.enum(VISIBILITIES),
  created: z.string(),
  updated: z.string(),
});

export type VisitedCreate = z.infer<typeof visitedCreate>;
export type VisitedPatch = z.infer<typeof visitedPatch>;
export type VisitedDoc = z.infer<typeof visitedDoc>;

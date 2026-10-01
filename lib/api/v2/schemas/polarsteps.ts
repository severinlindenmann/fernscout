import { z } from "zod";

/**
 * The wire shape of one Polarsteps `trip.json`, for the `kind: "polarsteps"`
 * door on `POST /api/v2/{user}/import` (B2432). Structurally the same
 * document `importers/trips/polarsteps/schema.ts` names — that file is the
 * MIT-licensed parser's own contract and knows nothing of zod or of this
 * repository's API layer; this is the API boundary's own check of the same
 * shape, so a caller gets a real validation error rather than a parser
 * throwing on a field it did not expect.
 *
 * `z.strictObject` everywhere: an extra field on a real export is more
 * likely something this importer has not learned yet than something to
 * silently ignore, and a strict schema makes that a visible gap rather than
 * a silent drop — see B2432's acceptance that the OpenAPI document tells the
 * truth about what this door reads.
 */
const polarstepsLocation = z.strictObject({
  name: z.string().nullable(),
  detail: z.string().nullable(),
  country_code: z.string().min(1).max(4),
  lat: z.number(),
  lon: z.number(),
});

const polarstepsStep = z.strictObject({
  id: z.number().int(),
  name: z.string().nullable().optional(),
  display_name: z.string(),
  display_slug: z.string(),
  description: z.string().nullable().optional(),
  start_time: z.number(),
  timezone_id: z.string().min(1),
  location: polarstepsLocation,
  weather_condition: z.string().optional(),
  weather_temperature: z.number().optional(),
});

export const polarstepsTripSchema = z.strictObject({
  id: z.number().int(),
  slug: z.string(),
  name: z.string().min(1),
  summary: z.string().nullable().optional(),
  cover_photo_path: z.string().optional(),
  step_count: z.number().int().optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  all_steps: z.array(polarstepsStep).min(1),
});

export type PolarstepsTripBody = z.infer<typeof polarstepsTripSchema>;

// POST /api/v2/geocode — B1608, phase 2 step 3. Not part of the original
// golden-contract review round (`00-decisions.md`'s field-level list has no
// geocode entry); this is new work the parcel names outright, so it is a new
// schema rather than a change to one, and carries no `06-contract-deltas.md`
// row — that file tracks deviations from what was already reviewed and
// frozen, not the shape of a schema that never existed to deviate from.
//
// Mirrors v1's `/api/v1/geocode` body and response
// (`app/api/v1/geocode/route.ts`, `lib/addressLookup.ts`'s `GeocodeCandidate`)
// — a place name in, a ranked shortlist of candidate coordinates out, never
// one silent guess.
import { z } from "zod";

export const geocodeRequest = z.strictObject({
  query: z.string().trim().min(1),
  countryHint: z.string().trim().optional(),
  regionHint: z.string().trim().optional(),
  contextCoordinates: z
    .array(
      z.strictObject({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
      }),
    )
    .optional(),
});
export type GeocodeRequest = z.infer<typeof geocodeRequest>;

export const geocodeCandidate = z.strictObject({
  displayName: z.string(),
  country: z.string(),
  countryCode: z.string().optional(),
  adminRegion: z.string().optional(),
  lat: z.number(),
  lon: z.number(),
  type: z.string().optional(),
});

export const geocodeResponse = z.strictObject({
  results: z.array(geocodeCandidate),
});

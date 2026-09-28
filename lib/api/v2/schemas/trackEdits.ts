// GET/PUT /api/v2/{user}/trips/{trip}/track-edits — B2539, D8 C.
//
// A hidden spot, a hidden stretch and a named stretch, all scoped to one
// trip. Domain logic lives in `lib/gps/api.ts` (`listTrackEdits`,
// `writeTrackEdits`) and `lib/gps/edits.ts` (the file itself); this route
// parses, authenticates and echoes, the same division `gps/zones` keeps.
//
// Owner only (`requireJournalOwner` — a trip-scoped token is refused even
// for its own trip, the same as `gps/zones`): hiding a spot changes what
// every reader of this trip is shown, which is a bigger authority than
// writing to the trip itself.
import { z } from "zod";
import { EDIT_LIMITS } from "@/lib/gps/api";

const isoInstant = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), { message: "must be a valid ISO instant" });

/** `id` is optional on the way in — assigned server-side
 * (`writeTrackEdits`) for anything the owner just added, echoed back so the
 * next `PUT` can keep it. Required on the way out (`trackEditsDoc`). */
export const hiddenSpotWrite = z.strictObject({
  id: z.string().min(1).optional(),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  radiusM: z.number().min(EDIT_LIMITS.minRadiusM).max(EDIT_LIMITS.maxRadiusM),
});
export const hiddenStretchWrite = z.strictObject({
  id: z.string().min(1).optional(),
  from: isoInstant,
  to: isoInstant,
});
export const namedStretchWrite = z.strictObject({
  id: z.string().min(1).optional(),
  from: isoInstant,
  to: isoInstant,
  label: z.string().trim().min(1).max(EDIT_LIMITS.labelMax),
});

export const trackEditsWrite = z.strictObject({
  hiddenSpots: z.array(hiddenSpotWrite).max(EDIT_LIMITS.maxSpots),
  hiddenStretches: z.array(hiddenStretchWrite).max(EDIT_LIMITS.maxStretches),
  namedStretches: z.array(namedStretchWrite).max(EDIT_LIMITS.maxNamed),
});
export type TrackEditsWrite = z.infer<typeof trackEditsWrite>;

const hiddenSpotDoc = z.strictObject({
  id: z.string(),
  lat: z.number(),
  lon: z.number(),
  radiusM: z.number(),
});
const hiddenStretchDoc = z.strictObject({ id: z.string(), from: z.string(), to: z.string() });
const namedStretchDoc = z.strictObject({ id: z.string(), from: z.string(), to: z.string(), label: z.string() });

export const trackEditsDoc = z.strictObject({
  hiddenSpots: z.array(hiddenSpotDoc),
  hiddenStretches: z.array(hiddenStretchDoc),
  namedStretches: z.array(namedStretchDoc),
  limits: z.strictObject({
    maxSpots: z.number(),
    maxStretches: z.number(),
    maxNamed: z.number(),
    radiusM: z.strictObject({ min: z.number(), max: z.number() }),
    labelMax: z.number(),
  }),
});
export type TrackEditsDoc = z.infer<typeof trackEditsDoc>;

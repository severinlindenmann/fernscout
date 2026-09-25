// GET/PUT /api/v2/{user}/gps/zones — B2203.
//
// `exclude.json` (docs/gps.md's "Private zones") used to be something only a
// shell could write; a hosted owner has no shell on the machine this runs
// on, and neither does an agent. This is the door.
//
// Owner only (`requireJournalOwner` — a trip-scoped, guest or narrower
// token, such as the recorder's own `write:gps` one B2204 adds, is refused):
// a private zone is journal-wide, not one trip's.
//
// Returning the owner's OWN zones to the owner over `GET` is not the
// coordinate leak `lib/gps/store.ts`'s module doc warns about — a zone is
// what the owner typed in (a label, a place, a radius), never a recorded
// position read out of the store. See `docs/gps.md`'s own note.
import { z } from "zod";
import { ZONE_LIMITS } from "@/lib/gps/api";

export const gpsZone = z.strictObject({
  /** Free text — "home", "the office", "my parents' place". Nothing reads
   * it but the owner. */
  label: z.string().trim().min(1).max(80),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  radiusM: z.number().min(ZONE_LIMITS.minRadiusM).max(ZONE_LIMITS.maxRadiusM),
});
export type GpsZone = z.infer<typeof gpsZone>;

export const gpsZonesWrite = z.strictObject({
  zones: z.array(gpsZone).max(ZONE_LIMITS.maxZones),
  /** Absent leaves the stored decline exactly as it was — a `PUT` that sends
   * only `zones` must not silently undo an earlier "no home zone, and I mean
   * it". Present, it replaces it. */
  homeDeclined: z.boolean().optional(),
});
export type GpsZonesWrite = z.infer<typeof gpsZonesWrite>;

export const gpsZonesDoc = z.strictObject({
  zones: z.array(gpsZone),
  homeDeclined: z.boolean(),
  limits: z.strictObject({
    maxZones: z.number(),
    radiusM: z.strictObject({ min: z.number(), max: z.number() }),
  }),
});
export type GpsZonesDoc = z.infer<typeof gpsZonesDoc>;

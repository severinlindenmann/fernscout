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

/**
 * A stretch's own wall clock, not an instant — security review, 2026-09-28.
 * The first cut of this took a raw ISO instant, built in the *browser's*
 * own time zone before it ever reached the server; editing a Tokyo trip from
 * Zürich silently hid the wrong seven hours while the studio's own list
 * echoed the typed times back as though nothing had moved. `date` +
 * `from`/`to` names a wall clock local to the day it is about, which is
 * unambiguous however it is read — resolved to an absolute instant once, at
 * derivation time, against that date's own day `timezone`
 * (`resolvedHiddenStretches`/`resolvedNamedStretches`, `lib/gps/api.ts`),
 * the same "local to the day, resolved fresh" rule `deriveTrack`'s own
 * per-date window already uses. A stretch does not cross midnight — the
 * studio's own picker asks for one day at a time, and two adjoining
 * stretches say the same thing a single one spanning both would.
 */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");
const wallTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "must be HH:MM, 24-hour");

/** `id` is optional on the way in — assigned server-side
 * (`writeTrackEdits`) for anything the owner just added, echoed back so the
 * next `PUT` can keep it. Never client-chosen: `writeTrackEdits` ignores any
 * id here that does not already belong to an entry this document already
 * held, so sending one is only ever a way to *keep* an id, never to set
 * one. Bounded and charset-restricted so a malformed one is a clear 400
 * rather than something the write layer has to make sense of. Required on
 * the way out (`trackEditsDoc`). */
const editId = z
  .string()
  .min(1)
  .max(EDIT_LIMITS.maxIdLength)
  .regex(/^[A-Za-z0-9_-]+$/, "must be letters, digits, - or _ only")
  .optional();

const hiddenSpotWrite = z.strictObject({
  id: editId,
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  radiusM: z.number().min(EDIT_LIMITS.minRadiusM).max(EDIT_LIMITS.maxRadiusM),
});
const hiddenStretchWrite = z.strictObject({ id: editId, date: isoDate, from: wallTime, to: wallTime }).refine(
  (v) => v.from < v.to,
  { message: "from must be before to, both on the same date", path: ["to"] },
);
const namedStretchWrite = z
  .strictObject({
    id: editId,
    date: isoDate,
    from: wallTime,
    to: wallTime,
    label: z.string().trim().min(1).max(EDIT_LIMITS.labelMax),
  })
  .refine((v) => v.from < v.to, { message: "from must be before to, both on the same date", path: ["to"] });

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
const hiddenStretchDoc = z.strictObject({ id: z.string(), date: z.string(), from: z.string(), to: z.string() });
const namedStretchDoc = z.strictObject({
  id: z.string(),
  date: z.string(),
  from: z.string(),
  to: z.string(),
  label: z.string(),
});

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

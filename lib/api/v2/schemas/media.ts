// The single binary door — B1587, phase 0.
//
// One upload route for every kind of bytes: what today is /media + /inbox +
// /import. The bytes ride multipart under `file`; this schema is the `intent`
// part beside them, which says what the bytes are. A file with no trip says
// why it has none — the same required-or-declined rule, one level down.
import { z } from "zod";
import { declineReason, tripId } from "./shared";

/** What the bytes are decides where they land and what happens next:
 * photo → a gallery (or the inbox if no day yet); bank_export → a report a
 * person agrees category by category, never written directly; gps_history →
 * the store no route reads back; document → the inbox files/ shelf. */
export const MEDIA_KINDS = ["photo", "bank_export", "gps_history", "document"] as const;

export const mediaIntent = z
  .strictObject({
    kind: z.enum(MEDIA_KINDS),
    /** Which trip this belongs to. Optional-with-a-reason, not just optional. */
    trip: tripId.optional(),
    /** Which day a photo belongs on, when known. Without it a photo lands in
     * the inbox and is attached later. */
    day: z.string().optional(),
    caption: z.string().optional(),
    /** For bank_export / gps_history: the importer format, when the default
     * detection is not enough (see importers/). */
    format: z.string().optional(),
    declined: z.strictObject({ trip: declineReason }).optional(),
  })
  .superRefine((intent, ctx) => {
    if (intent.trip === undefined && intent.declined?.trip === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["trip"],
        message:
          "name the trip this belongs to, or decline it with a reason (e.g. a year-wide bank statement spans several trips)",
        params: { v2: "missing", toDecline: "declined.trip: <reason>" },
      });
    }
    if (intent.trip !== undefined && intent.declined?.trip !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["trip"],
        message: "both a trip and a declined.trip — remove one",
        params: { v2: "conflict" },
      });
    }
  });

/**
 * Every upload answers with the stored item. `src` is the stable id a day
 * references; the original bytes are kept whole as the print master, and
 * duplicates are detected by bytes (a re-send answers the existing item).
 */
export const mediaItem = z.strictObject({
  src: z.string(),
  kind: z.enum(MEDIA_KINDS),
  trip: z.string().optional(),
  day: z.string().optional(),
  caption: z.string().optional(),
  bytes: z.number().int().nonnegative(),
  /** Where the browser-served derivative lives (photos only). */
  url: z.string().optional(),
  duplicateOf: z.string().optional(),
});

export type MediaIntent = z.infer<typeof mediaIntent>;

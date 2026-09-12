// The single binary door — B1587, phase 0. /api/v2/{user}/media.
//
// One upload route for every kind of bytes: what today is /media + /inbox +
// /import. The bytes ride multipart under `file`; this schema is the `intent`
// beside them, which says what the bytes are. The questions asked depend on
// the kind — a bank statement has no caption, a photograph has no importer
// format — and a question that does not apply to the kind is refused rather
// than ignored, so a stray field fails loudly.
import { z } from "zod";
import { declinedMap, type Declinable } from "./shared";

/** What the bytes are decides where they land and what happens next:
 * photo → a day's gallery (or the inbox if no day yet); bank_export → a
 * report a person agrees category by category, never written directly;
 * gps_history → the store no route reads back; document → the inbox files/
 * shelf, reachable by nothing yet. */
export const MEDIA_KINDS = ["photo", "bank_export", "gps_history", "document"] as const;

/** Which questions each kind is asked. `trip` is asked of everything. */
const ASKED: Record<(typeof MEDIA_KINDS)[number], readonly Declinable[]> = {
  photo: [
    { field: "trip", whyRequired: "which trip this photograph belongs to, or why none" },
    { field: "day", whyRequired: "which day it belongs on (its slug), or a decline — without one it lands in the inbox to be attached later" },
    { field: "caption", whyRequired: "a caption, or a decline" },
  ],
  bank_export: [
    { field: "trip", whyRequired: "which trip this statement mostly covers, or why none (e.g. it spans the whole year)" },
    { field: "format", whyRequired: "which importer reads this export (see /status capabilities), or a decline to let the server detect it" },
  ],
  gps_history: [
    { field: "trip", whyRequired: "which trip this history is for, or why none (a whole-archive import)" },
    { field: "format", whyRequired: "which importer reads this export, or a decline to let the server detect it" },
  ],
  document: [
    { field: "trip", whyRequired: "which trip this document belongs to, or why none" },
    { field: "caption", whyRequired: "what this document is, or a decline" },
  ],
};

export const mediaIntent = z
  .strictObject({
    kind: z.enum(MEDIA_KINDS),
    trip: z.string().min(1).optional(),
    day: z.string().min(1).optional(),
    caption: z.string().min(1).optional(),
    format: z.string().min(1).optional(),
    declined: declinedMap(["trip", "day", "caption", "format"]).optional(),
  })
  .superRefine((intent, ctx) => {
    const asked = ASKED[intent.kind];
    const askedFields = new Set(asked.map((a) => a.field));
    for (const a of asked) {
      const brought = intent[a.field as "trip" | "day" | "caption" | "format"] !== undefined;
      const declined = intent.declined?.[a.field as "trip"] !== undefined;
      if (brought && declined) {
        ctx.addIssue({ code: "custom", path: [a.field], message: "both provided and declined — remove one", params: { v2: "conflict" } });
      }
      if (!brought && !declined) {
        ctx.addIssue({ code: "custom", path: [a.field], message: a.whyRequired, params: { v2: "missing", toDecline: `declined.${a.field}: <reason>` } });
      }
    }
    // A question the kind is not asked is refused, not ignored.
    for (const field of ["day", "caption", "format"] as const) {
      if (askedFields.has(field)) continue;
      if (intent[field] !== undefined || intent.declined?.[field] !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: `a ${intent.kind} upload is not asked for ${field} — remove it`,
          params: { v2: "conflict" },
        });
      }
    }
  });

/**
 * Every upload answers with the stored item. `src` is the one id in v2 the
 * CLIENT does not choose: it is derived from the bytes themselves (a hash,
 * the same naming the inbox uses), which is what makes a blind retry safe
 * and a duplicate detectable — the same bytes always have the same id, so a
 * re-send answers the existing item via `duplicateOf`. The original bytes
 * are kept whole as the print master.
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

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
 *
 * **Sending back what this server answered with is also a re-send** (B1790).
 * A derivative does not hash to the bytes it was derived from, so a folder
 * that mirrors what the site serves — and then publishes — used to store the
 * same photograph a second time under a second id. An upload whose bytes are
 * exactly a photograph already stored in that place answers with **that
 * photograph's** `src`, which is therefore not always the id the sent bytes
 * would hash to.
 */
/**
 * `SidecarSource` in `lib/sidecar.ts`, restated here because that module is
 * `server-only` and a schema file may not import a runtime array from one
 * (the same constraint `PURCHASE_STATUSES` in ./money.ts is under). Keep the
 * two matching.
 */
const MEDIA_SOURCES = ["web", "api", "helper", "whatsapp", "import", "sync"] as const;

export const mediaItem = z.strictObject({
  src: z.string(),
  kind: z.enum(MEDIA_KINDS),
  trip: z.string().optional(),
  /** Which day this belongs to, once one does. Set at upload (`intent.day`)
   * for a day-named photograph, or by `POST .../days/{slug}/media` for one
   * attached later — either way this answers from the day document that
   * names the `src`, **never** from where the bytes physically sit (B1976):
   * attaching a day-less upload to a day re-points the record rather than
   * moving the file, so a photograph's folder and its reported `day` are not
   * guaranteed to agree, and the day document is what this reads. */
  day: z.string().optional(),
  /** What the upload said at the door, until a day names this photograph —
   * once it does, this is that day's own `media[].caption`, kept current by
   * the day `PATCH`/`EditDay` (B1868). One door answers per photograph: the
   * day's, when it has one; the upload's own caption, when no day does. */
  caption: z.string().optional(),
  /** What the photograph shows, for a reader who cannot see it; written by
   * the journal's helper once, **never accepted from a caller**. Absent for
   * anything nothing has described. */
  alt: z.string().optional(),
  bytes: z.number().int().nonnegative(),
  /** Where the browser-served derivative lives (photos only). */
  url: z.string().optional(),
  duplicateOf: z.string().optional(),
  /** Whom the upload resolved to at the door it came through. **Recorded by
   * the server, never accepted from a caller** — it is one of the two facts
   * about an upload that cannot be read back off the file afterwards. Absent
   * for a photograph stored before this was recorded, or through a door that
   * resolved no identity. */
  uploadedBy: z.string().optional(),
  /** Which door the bytes came through. **Recorded by the server, never
   * accepted from a caller.** Absent on anything stored before it was. */
  source: z.enum(MEDIA_SOURCES).optional(),
  /** The served derivative's pixels, measured at upload. **Recorded by the
   * server, never accepted from a caller.** Absent for a photograph nothing
   * has measured — a video, or anything stored before this was recorded. */
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  /** When the camera says this was captured, off the photograph's own EXIF
   * (or a clip's container tags) — never the upload time, and never a
   * guess. Absent when nothing measured it (WhatsApp strips EXIF from a
   * photo sent as a photo) or a person never said it — B1842. */
  takenAt: z.string().optional(),
  lat: z.number().optional(),
  lon: z.number().optional(),
  /** `"exif"`/`"probe"` says `takenAt`/`lat`/`lon` were measured, not
   * typed — the one named exception to "nothing here is inferred"
   * (`lib/sidecar.ts`). Absent when a person supplied them instead, or when
   * the server holds none at all. */
  measuredFrom: z.enum(["exif", "probe"]).optional(),
});

export type MediaIntent = z.infer<typeof mediaIntent>;

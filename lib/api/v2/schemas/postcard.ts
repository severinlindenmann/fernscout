// PUT/GET /api/v2/{user}/postcards/orders/{id} — B1624, phase 2 step 4.
//
// docs/plans/2026-09-12-api-v2/print.md §2.1. No `declined` map here (unlike
// every document-shaped resource elsewhere in v2): every field is either
// genuinely required (source, message, from, recipients — there is no honest
// way to guess who a card is to or what it says) or a plain optional riding a
// sensible default, which rule 2 explicitly carves out.
import { z } from "zod";

const crop = z.strictObject({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  zoom: z.number().min(1).optional(),
});

/** A photograph already on a trip, or one staged in the inbox — v1's four
 * loose fields (`trip`/`day`/`photo` given together or not at all) replaced
 * by a discriminated union so a caller cannot send half of one shape. */
export const postcardSource = z.union([
  z.strictObject({
    trip: z.string().trim().min(1),
    day: z.string().trim().min(1),
    photo: z.string().trim().min(1),
  }),
  z.strictObject({ inbox: z.string().trim().min(1) }),
]);

export const postcardOrderWrite = z.strictObject({
  source: postcardSource,
  message: z.string().trim().min(1).max(600),
  from: z.string().trim().min(1).max(120),
  /** Contact ids, never addresses — see AGENTS.md. Deduplicated by the route,
   * not here, since the route is what has to report the duplicate. */
  recipients: z.array(z.string().trim().min(1)).min(1).max(25),
  /** Defaults to the journal's own default locale — asserted by the route,
   * never inspected. */
  locale: z.string().trim().min(1).optional(),
  /** An agent has no way to see the rendered card, so this stays optional and
   * realistically never sent by one — kept because it rides the same
   * document the owner's own edit door writes into (rule 4). */
  crop: crop.optional(),
  /** Absent means on. Only an explicit `false` turns it off — see
   * `OrderPayload.figures` in lib/postcard/orders.ts. */
  figures: z.boolean().optional(),
});

const postcardOrderResult = z.strictObject({
  contactId: z.string(),
  ok: z.boolean(),
  error: z.string().optional(),
  providerStatus: z.string().optional(),
});

/** The edit shape plus what the server owns. */
export const postcardOrderDoc = z.object({
  ...postcardOrderWrite.shape,
  id: z.string(),
  status: z.enum(["draft", "expired", "submitted", "built", "failed"]),
  /** `/{user}/postcards/{id}` — where the owner looks and presses Send. */
  url: z.string(),
  credits: z.strictObject({
    each: z.number(),
    total: z.number(),
    balance: z.number().nullable(),
  }),
  expiresAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Present only once sent. */
  results: z.array(postcardOrderResult).optional(),
});

export type PostcardOrderWrite = z.infer<typeof postcardOrderWrite>;
export type PostcardOrderDoc = z.infer<typeof postcardOrderDoc>;

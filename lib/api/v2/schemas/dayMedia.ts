// B1656 — attaching an already-stored photograph to a day's own gallery, and
// taking one back off, without re-opening the other 13 questions a day's
// full write (`dayWrite`) asks. See D20, 06-contract-deltas.md, for why this
// is its own narrow door rather than a `PATCH .../days/{slug}` call.
//
// The item shape is the same three fields `dayWrite`'s own `media` array
// entry carries (`src`/`caption`/`visibility`, ./day.ts) — duplicated rather
// than imported because that shape is not exported there, and this ticket
// may add a new schema file but may not edit an existing one (the rule this
// file exists under). Two copies of three fields is a smaller risk than the
// edit this rule forbids.
import { z } from "zod";

const dayMediaAttachItem = z.strictObject({
  /** The `src` an earlier `POST /api/v2/{user}/media` (or a trip's own day-
   * scoped upload) already answered with — this door places bytes nowhere;
   * it only lets a day's own document point at bytes that already exist. */
  src: z.string().min(1),
  caption: z.string().optional(),
  /** Narrows only, on top of the trip's own gate — no `public` (B596). */
  visibility: z.enum(["guest", "private"]).optional(),
});

export const dayMediaAttachRequest = z.strictObject({
  items: z.array(dayMediaAttachItem).min(1),
});

export const dayMediaDetachRequest = z.strictObject({
  /** Exactly as the day's own `media[].src` already reads back — the same
   * rule `expected_src`/`unknown_media` already state for the trip-level
   * media door. */
  srcs: z.array(z.string().min(1)).min(1),
});

export type DayMediaAttachRequest = z.infer<typeof dayMediaAttachRequest>;
export type DayMediaDetachRequest = z.infer<typeof dayMediaDetachRequest>;

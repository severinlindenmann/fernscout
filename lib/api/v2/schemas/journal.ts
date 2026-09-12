// The journal document — B1587, phase 0.
//
// Only what is genuinely the journal's. The `features` block is gone from
// journal config in v2 (decided 2026-09-12): every flag in it answered "is
// the plumbing configured", which is the operator's fact, reported read-only
// by /api/health and /status. A `features` block in an existing config.json
// parses and is ignored; nothing writes one back.
import { z } from "zod";

export const journalDoc = z.strictObject({
  title: z.string().trim().min(1).max(200),
  tagline: z.string().optional(),
  owner: z.strictObject({
    name: z.string().trim().min(1),
    email: z.email(),
  }),
  /** UI languages this journal maintains; the first is the default. */
  locales: z.array(z.string()).min(1),
  baseCurrency: z.string().length(3),
  /** Whether this instance advertises the journal (landing page, sitemap,
   * documentation.txt). guest = unlisted, not locked — who may read a trip is
   * still the trip's own gate. Absent reads as public. */
  visibility: z.enum(["public", "guest"]).optional(),
});

/** PATCH is a merge: send only what changes. Owner only. */
export const journalPatch = journalDoc.partial();

export type JournalDoc = z.infer<typeof journalDoc>;

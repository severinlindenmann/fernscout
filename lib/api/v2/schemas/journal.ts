// The journal document — B1587, phase 0.
//
// Only what is genuinely the journal's. Deliberately absent (owner review,
// 2026-09-12):
// - `features` — instance-only; every flag answered "is the plumbing
//   configured", the operator's fact, reported read-only by /api/health and
//   /status. A block in an existing config.json parses and is ignored.
// - `startLocation` — stored and editable in v1, rendered and computed by
//   nothing. v1 keeps parsing it from old files; it joins v2 if a feature
//   ever wants it.
import { z } from "zod";
import { checkRequiredOrDeclined, declinedMap, type Declinable } from "./shared";

const JOURNAL_DECLINABLES: readonly Declinable[] = [
  {
    field: "tagline",
    whyRequired: "the line under the journal's title on its landing page, or a reason it has none",
  },
  {
    field: "manualRates",
    whyRequired:
      "rates for any currency the ECB does not publish (units per 1 EUR, e.g. {\"VND\": 30500}), or a decline (every currency this journal uses is ECB-published)",
  },
] as const;

const base = z.strictObject({
  title: z.string().trim().min(1).max(200),
  owner: z.strictObject({
    name: z.string().trim().min(1),
    email: z.email(),
  }),
  /** UI languages this journal maintains; the first is the default. */
  locales: z.array(z.string()).min(1),
  baseCurrency: z.string().length(3),
  /** The currencies cost figures are offered in, alongside conversion.
   * Must include baseCurrency — the journal's own money is always shown. */
  displayCurrencies: z.array(z.string().length(3)).min(1),
  /** How measurements render. Required and explicit — no guessed default. */
  units: z.enum(["metric", "imperial"]),
  /** Whether this instance advertises the journal (landing page, sitemap,
   * documentation.txt). guest = unlisted, not locked — who may read a trip
   * is still the trip's own gate. Required and explicit in v2. */
  visibility: z.enum(["public", "guest"]),
  tagline: z.string().optional(),
  /** Rates for anything the ECB does not publish, and overrides for anything
   * it does. Same convention as the ECB table: units per 1 EUR. */
  manualRates: z.record(z.string().length(3), z.number().positive()).optional(),
  declined: declinedMap(["tagline", "manualRates"]).optional(),
  /** This journal's own media allowance — narrows the instance ceiling,
   * never widens it (the person paying for the disk decides its size; the
   * server clamps anything larger). Plain optional: absent means the
   * instance's numbers, which is the normal case. */
  media: z
    .strictObject({
      imageBytes: z.number().int().positive().optional(),
      imageEdge: z.number().int().positive().optional(),
      videoBytes: z.number().int().positive().optional(),
      videoSeconds: z.number().int().positive().optional(),
      itemsPerDay: z.number().int().positive().optional(),
      perUserBytes: z.number().int().positive().optional(),
      photobookOrdersPerUser: z.number().int().positive().optional(),
    })
    .optional(),
});

export const journalDoc = base.superRefine((doc, ctx) => {
  checkRequiredOrDeclined(doc, JOURNAL_DECLINABLES, ctx);
  if (!doc.displayCurrencies.includes(doc.baseCurrency)) {
    ctx.addIssue({
      code: "custom",
      path: ["displayCurrencies"],
      message: `displayCurrencies must include baseCurrency ("${doc.baseCurrency}")`,
    });
  }
});

/** PATCH is a merge: send only what changes. Owner only. */
export const journalPatch = base.partial();

export type JournalDoc = z.infer<typeof journalDoc>;

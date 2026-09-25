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
import { journalFigures } from "./figures";
import { checkRequiredOrDeclined, declinedMap, type Declinable } from "./shared";

/** Exported for the shared write path (`lib/api/v2/write.ts`) — B1608, D5 in
 * `docs/v2-migration/06-contract-deltas.md`. T6 decline retraction needs the
 * list of field names a document's `declined` map may name, and a second,
 * hand-typed copy of `["tagline", "figures"]` there is a list that
 * disagrees with this one within a month, the same reasoning D1 already
 * applied to `costItem`. */
export const JOURNAL_DECLINABLES: readonly Declinable[] = [
  {
    field: "tagline",
    whyRequired: "the line under the journal's title on its landing page, or a reason it has none",
  },
  {
    field: "figures",
    whyRequired:
      'the journal\'s default walking figures: {mode: "off"}, or {mode: "set", figures: [ids]} pointing into /figures — create them there first',
  },
] as const;

const base = z.strictObject({
  title: z.string().trim().min(1).max(200),
  owner: z.strictObject({
    name: z.string().trim().min(1),
    /** The short form the site actually calls them — `lib/site.ts`'s byline
     * reaches for this before `name`, and `lib/config.ts` refuses a journal
     * whose config has no `owner.nickname` at all. It is required here for
     * that reason and not as v1 drag: a journal document that omitted it
     * could not be written to disk as a valid config, so the contract would
     * have been promising a write it cannot perform. Never derived from
     * `name` — "the first word of your name" is a guess about what somebody
     * is called (lib/journals.ts). */
    nickname: z.string().trim().min(1),
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
  /** The default figure set trips inherit (figures: {mode: "journal"}). */
  figures: journalFigures.optional(),
  declined: declinedMap(["tagline", "figures"]).optional(),
});

/** What the owner (or their agent) may edit. */
export const journalWrite = base.superRefine((doc, ctx) => {
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

/**
 * What every GET answers: the editable document plus the server-owned
 * identity. The live numbers — storage, drafts, trips, credits — live on
 * GET /{user}/status, so one fact has one address.
 */
export const journalDoc = z.object({
  ...base.def.shape,
  // ── server-owned ──
  username: z.string(),
});

export type JournalDoc = z.infer<typeof journalDoc>;

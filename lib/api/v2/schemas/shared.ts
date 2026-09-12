// The shared vocabulary of the v2 contract — B1587, phase 0.
//
// These files ARE the spec: the validator, the TypeScript type and (in a
// later ticket) the generated /v2/openapi.json all come from here, so a field
// missing here is a field that does not exist. Nothing in this folder invents
// vocabulary — every enum is imported from the constant the v1 validator
// uses, and every ceiling repeats the one the v1 door already enforces.
import { z } from "zod";
import { ERROR_CODES } from "../../errorCodes";
import { ID_RE, DATE_RE } from "../../../tripWrite";

/** Client-chosen ids everywhere — a retried create answers 409 with the
 * stored document, so no write needs idempotency machinery. */
export const tripId = z.string().regex(ID_RE, "lowercase words joined by hyphens, e.g. alps-2026");
export const isoDate = z.string().regex(DATE_RE, "YYYY-MM-DD");
export const isoInstant = z.iso.datetime({ message: "an ISO instant, e.g. 2026-09-12T14:00:00Z" });

/**
 * A decline is a message to the next reader — an agent months later, or the
 * owner — not a checkbox. Free text on purpose (reasons are read, not
 * branched on), with a floor so "n/a" cannot satisfy it.
 */
export const declineReason = z
  .string()
  .trim()
  .min(10, "a decline carries a real reason the next reader can act on (at least 10 characters)");

/**
 * The `declined` map on a document: which declinable sections were
 * consciously left out, and why. Persisted in frontmatter and returned on
 * every GET, so the next agent knows not to nag.
 */
export function declinedMap<const K extends readonly [string, ...string[]]>(keys: K) {
  return z.partialRecord(z.enum(keys), declineReason);
}

/** What a declinable section says about itself, for the 422 body. */
export type Declinable = {
  field: string;
  whyRequired: string;
};

/**
 * The required-or-declined rule, applied in one place per document schema:
 * every declinable section is either present, or named in `declined` — never
 * both, never neither. Silent omission is the thing v2 exists to refuse.
 */
export function checkRequiredOrDeclined(
  doc: Record<string, unknown>,
  declinables: readonly Declinable[],
  ctx: z.core.$RefinementCtx,
): void {
  const declined = (doc.declined ?? {}) as Record<string, string>;
  for (const d of declinables) {
    const brought = doc[d.field] !== undefined;
    const wasDeclined = declined[d.field] !== undefined;
    if (brought && wasDeclined) {
      ctx.addIssue({
        code: "custom",
        path: [d.field],
        message: `both provided and declined — remove one. A section cannot be there and consciously absent at once.`,
        params: { v2: "conflict" },
      });
    }
    if (!brought && !wasDeclined) {
      ctx.addIssue({
        code: "custom",
        path: [d.field],
        message: d.whyRequired,
        params: { v2: "missing", toDecline: `declined.${d.field}: <reason>` },
      });
    }
  }
}

/**
 * The patch half of the asked-or-declined rule (V2/T6). A patch answers only
 * the questions it raises: nothing is required, but a field brought and
 * declined in the same patch is a contradiction, and — the T6 invariant,
 * enforced in the write path — a patch that supplies what was previously
 * declined clears the stored decline.
 */
export function checkPatchConflicts(
  doc: Record<string, unknown>,
  keys: readonly string[],
  ctx: z.core.$RefinementCtx,
): void {
  const declined = (doc.declined ?? {}) as Record<string, string>;
  for (const key of keys) {
    if (doc[key] !== undefined && declined[key] !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: [key],
        message: "both provided and declined in one patch — remove one",
        params: { v2: "conflict" },
      });
    }
  }
}

/**
 * The one error envelope — every v2 refusal is this shape. `error` comes from
 * the single published vocabulary (lib/api/errorCodes.ts), `message` is the
 * human sentence, `details` is per-code structure (for `incomplete`, the
 * `missing` list below).
 */
export const errorEnvelope = z.strictObject({
  error: z.enum(Object.keys(ERROR_CODES) as [string, ...string[]]),
  message: z.string(),
  details: z.unknown().optional(),
});

/**
 * The 422 `incomplete` body: the missing half of the documentation, delivered
 * when it is needed. One row per silently-omitted declinable section.
 */
export const incompleteDetails = z.strictObject({
  missing: z.array(
    z.strictObject({
      field: z.string(),
      why_required: z.string(),
      /** A JSON-schema excerpt of what to send, generated from the section's
       * own Zod schema — never prose typed beside it. */
      to_provide: z.unknown(),
      to_decline: z.string(),
    }),
  ),
});

export type ErrorEnvelope = z.infer<typeof errorEnvelope>;

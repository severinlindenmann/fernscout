// Proving a NEW owner.email before it takes over the journal — B1733, D20.
//
// `owner.email` IS ownership: `lib/api/auth.ts`'s `mayActAsOwner` resolves
// an owner by comparing a session's address against this field, so a bare
// `PATCH` moving it — the shape `JOURNAL_IMMUTABLE_FIELDS` in
// `lib/api/v2/write.ts` refuses outright, unchanged, per the owner's review
// — would hand the journal to whichever address an owner token could write
// there, with nothing sent to prove it belonged to anybody in particular.
//
// This is the exception: `app/api/v2/[user]/route.ts`'s `PATCH` notices a
// CHANGED `owner.email` before the immutable-field refusal ever fires, and
// answers `ownerEmailPending` instead of writing — the same "prove it, like
// tel" shape `lib/api/v2/schemas/ownerTel.ts` already documents. The code
// only completes at `.../owner/email/redeem`, with `ownerEmailRedeem`.
import { z } from "zod";

export const ownerEmailPending = z.strictObject({
  pending: z.literal("owner_email"),
  /** Opaque — hand it back, with the code, to `.../owner/email/redeem`. */
  id: z.string(),
  next: z.string(),
});
export type OwnerEmailPending = z.infer<typeof ownerEmailPending>;

export const ownerEmailRedeem = z.strictObject({
  id: z.string().min(1),
  /** The passcode the NEW address received. Proof of possession, not of
   * anything else — this is the whole reason the field can be trusted. */
  code: z.string().trim().min(1),
});
export type OwnerEmailRedeem = z.infer<typeof ownerEmailRedeem>;

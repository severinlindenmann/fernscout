// The owner's own telephone number — B1654, D20.
//
// A new file rather than a field on `journal.ts`'s `owner` block: the golden
// contract review froze that file with `email`/`name`/`nickname` and no
// `tel`, and `email` in particular must never become writable (changing it
// is taking over the journal). `owner.tel` is not an ownership claim at
// all — it is a notification channel, stored centrally rather than in
// `config.json` (see `lib/ownerTel.ts`) — so it gets its own small resource
// instead of bending the frozen one to fit.
//
// **There is no direct write schema.** The owner's review of the first draft
// of this ticket found that `PATCH .../config` (v1) let an agent holding an
// owner token point a journal's WhatsApp copies at a number of its own
// choosing, with nothing checking that the number belonged to anybody in
// particular — an exfiltration path, not an oversight. So the only way onto
// this field is proving the number with a passcode: `ownerTelVerifyRequest`
// starts that proof and `ownerTelVerifyRedeem` completes it. Nothing here
// accepts a bare `{"tel": …}` and writes it.
import { z } from "zod";
import { OWNER_TEL_PROVEN_METHODS } from "../../../ownerTel";
import { isoInstant } from "./shared";

export const ownerTelDoc = z.strictObject({
  /** `null` when there is no number on file at all. */
  tel: z.string().nullable(),
  provenAt: isoInstant.nullable(),
  provenMethod: z.enum(OWNER_TEL_PROVEN_METHODS).nullable(),
});
export type OwnerTelDoc = z.infer<typeof ownerTelDoc>;

export const ownerTelVerifyRequest = z.strictObject({
  /** Any of the forms a person types — `+41 76 000 00 00`, `0041 76 000 00 00`,
   * `41760000000`. Normalised to E.164 by the route with `toE164`, which
   * refuses a national number outright rather than guessing a country. */
  tel: z.string().trim().min(1),
});
export type OwnerTelVerifyRequest = z.infer<typeof ownerTelVerifyRequest>;

export const ownerTelVerifyStarted = z.strictObject({
  /** Opaque — hand it back, with the code, to `.../verify/redeem`. */
  id: z.string(),
});
export type OwnerTelVerifyStarted = z.infer<typeof ownerTelVerifyStarted>;

export const ownerTelVerifyRedeem = z.strictObject({
  id: z.string().min(1),
  /** The passcode the number itself received. Proof of possession, not of
   * anything else — this is the whole reason the field can be trusted. */
  code: z.string().trim().min(1),
});
export type OwnerTelVerifyRedeem = z.infer<typeof ownerTelVerifyRedeem>;

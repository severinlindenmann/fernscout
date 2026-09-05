import type { TranslationKey } from "../i18n";

/**
 * What a `/api/contacts/redeem` response means for the reader in front of the
 * form — B406.
 *
 * The route answers plainly (see its own doc comment: *"a redemption form
 * that appeared to work and did nothing leaves somebody waiting for a reply
 * that was never coming"*), but `InviteRedeem` used to read only the two
 * outcomes its own happy path produces (`code`, `in`, `waiting`) and let every
 * refusal — `mail_disabled`, the `400`s, and the `202 {"status":"expired"}`
 * branches for a dead, revoked, mismatched-kind or deleted-trip link — fall
 * through to nothing shown at all. One function rather than a growing
 * `if`-chain in the component, the same fix `codeConfirmErrorKey` was for the
 * six-digit step, and testable without a DOM.
 */
export type RedeemOutcome =
  | { kind: "error"; error: TranslationKey }
  | { kind: "step"; step: "code" | "in" | "waiting" };

export function redeemOutcome(
  response: { ok: boolean; status: number },
  body: { error?: string; status?: string },
): RedeemOutcome {
  if (response.status === 429) return { kind: "error", error: "contact.tooMany" };
  if (!response.ok) {
    if (body.error === "invalid_email") return { kind: "error", error: "contact.needEmail" };
    if (body.error === "invalid_name") return { kind: "error", error: "contact.needName" };
    if (body.error === "invalid_address") return { kind: "error", error: "contact.needAddress" };
    // The server cannot send the code this needs (B205). Said in words rather
    // than as "something went wrong", because there is nothing the reader can
    // do differently and waiting for a mail that is not coming is what the
    // old answer left them doing.
    if (body.error === "mail_disabled") return { kind: "error", error: "invite.noMail" };
    return { kind: "error", error: "contact.error" };
  }
  // A dead, revoked, mismatched-kind or deleted-trip link — the route's own
  // uniform `202 {"status":"expired"}` for all four. The page copy already
  // exists (`invite.expired`); it only had to be shown.
  if (body.status === "expired") return { kind: "error", error: "invite.expired" };
  if (body.status === "in") return { kind: "step", step: "in" };
  if (body.status === "waiting") return { kind: "step", step: "waiting" };
  return { kind: "step", step: "code" };
}

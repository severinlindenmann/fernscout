import "server-only";
import { refund } from "../credits";
import { postcardCandidates } from "./contacts";
import type { CancelledCard } from "./orders";
import { sendPostcardCardCancelled } from "./receipt";

/**
 * What a card Stannp cancels after accepting it costs an owner, put right —
 * B1532, the postcard counterpart of `lib/photobook/reconcile.ts`'s
 * `settleRefusedPrint`.
 *
 * `lib/postcard/orders.ts`'s `recordProviderCancellation` (the webhook) and
 * `refreshProviderStatuses` (the page's own on-view poll, B1548) are the two
 * places a cancellation is ever observed, and both hand this a `CancelledCard`
 * only when *they* were the call that atomically claimed the transition —
 * never on a retried webhook delivery or a page opened twice, and never for a
 * card somebody else's call is already settling. That claim is what makes
 * this safe to call exactly once per real cancellation: `refund()` itself is
 * unconditional, so the guarantee lives entirely in never being handed the
 * same claim twice.
 *
 * One credit's worth per card, keyed on the card's own provider ref rather
 * than the order id — an order can hold several cards, each cancelled
 * independently, and a second cancelled card on the same order must not be
 * mistaken for the first one settling again.
 */
export async function settleCancelledCard(claim: CancelledCard): Promise<void> {
  await refund(claim.owner, claim.creditsEach, claim.ref);
  const name = (await postcardCandidates(claim.owner)).find((c) => c.contactId === claim.contactId)?.name ?? null;
  await sendPostcardCardCancelled({
    owner: claim.owner,
    orderId: claim.orderId,
    name,
    creditsRefunded: claim.creditsEach,
  });
  console.warn(
    `[postcard] ${claim.orderId} card ${claim.ref} cancelled by the printer — ${claim.creditsEach} credits returned to ${claim.owner}`,
  );
}

import "server-only";
import fs from "node:fs";
import path from "node:path";
import { contentRoot } from "../contentRoot";
import { isEnabled } from "../capabilities";
import { balanceOf, refund, spend } from "../credits";
import { resolveMediaFile } from "../media";
import { parseTripRef } from "../trips";
import { addressesFor } from "./contacts";
import { recipientBases } from "./filename";
import {
  claimForSend,
  getOrder,
  isExpired,
  recordResults,
  releaseClaim,
  type PostcardOrder,
  type RecipientResult,
} from "./orders";
import { renderPostcard, type PostalAddress, type PostcardWarning } from "./render";
import { sendPostcardReceipt } from "./receipt";

/**
 * Turning an order into paper — B434, and the only place in this codebase
 * where pressing a button spends somebody's money on a physical object.
 *
 * ## The order of operations, and why it is that order
 *
 * 1. **Claim** the row (`draft → submitted`), on rows-affected.
 * 2. **Spend** the credits, all of them, for the whole list.
 * 3. **Print**, and refund the cards that did not make it.
 *
 * Claiming first is what makes a double press cost one set of cards. If the
 * spend came first, two presses arriving together would both find a healthy
 * balance, both debit it, and the second would then discover the order was
 * already claimed — leaving the owner correctly charged twice for one set of
 * postcards, which is the worst of the available failures because it is the
 * one that looks fine in the logs.
 *
 * Spending before printing is `lib/credits.ts`'s all-or-nothing rule, for the
 * reason stated there: nobody wants to work out which four of their seven
 * friends got a card. A balance one credit short sends nothing at all.
 *
 * Refunding afterwards is the other half of the same rule. A card the printer
 * refused bought nothing, so its credits go back; a card that was printed is
 * spent whatever happens to it in the post, because the money left.
 *
 * ## There is no route to this function that an agent can reach
 *
 * `sendOrder` is called from the owner's own page and from nowhere else. That
 * is the whole enforcement of "the agent never sends": not a scope check that
 * a later refactor can invert, but the absence of a door. If you are adding an
 * API route that calls this, the answer is no — see `lib/postcard/orders.ts`.
 */

export type SendFailure =
  | "unknown_order"
  | "postcards_off"
  | "contacts_off"
  | "already_sent"
  | "expired"
  | "no_recipients"
  | "photo_missing"
  | "provider_unavailable"
  | "no_credits";

export type SendOutcome =
  | {
      ok: true;
      /** Cards the printer accepted. */
      sent: number;
      /** Cards it refused. Their credits have been given back. */
      failed: number;
      /** Recipients on the order who are no longer eligible — they withdrew
       * consent or lost their address between the preview and the button — and
       * were therefore neither charged for nor posted to. */
      skipped: number;
      charged: number;
      warnings: PostcardWarning[];
    }
  | { ok: false; reason: SendFailure; needed?: number; balance?: number | null };

/** Where a dry-run send leaves its files. Gitignored, under the journal that
 * sent them, because every one of them carries somebody's home address. */
function orderDir(owner: string, id: string): string {
  return path.join(contentRoot(), owner, "postcards", id);
}

/**
 * Read the photograph an order names.
 *
 * Through `resolveMediaFile`, which refuses anything escaping the trip's media
 * directory and answers null rather than throwing. The payload is written by
 * an API call, so this string is attacker-controlled in principle and the
 * traversal guard is not decorative.
 */
export function orderPhotoFile(order: PostcardOrder): string | null {
  const parsed = parseTripRef(order.payload.trip);
  if (!parsed) return null;
  return resolveMediaFile(parsed.username, [
    parsed.tripId,
    ...order.payload.photo.split("/").filter(Boolean),
  ]);
}

function readPhoto(order: PostcardOrder): Uint8Array | null {
  const file = orderPhotoFile(order);
  if (!file) return null;
  try {
    return new Uint8Array(fs.readFileSync(file));
  } catch {
    return null;
  }
}

/**
 * Hand one card to a printer.
 *
 * Only `dry-run` exists today: it writes the print-ready files and calls
 * nobody, which is the whole pipeline minus the account and is what lets this
 * flow be developed and tested on a fresh clone. A real provider is B435, and
 * until one is wired an instance configured for one fails closed here rather
 * than quietly writing files and reporting a send.
 */
async function handToProvider(
  provider: string,
  owner: string,
  orderId: string,
  base: string,
  front: Uint8Array,
  back: Uint8Array,
  both: Uint8Array,
): Promise<{ ok: boolean; ref?: string; error?: string }> {
  if (provider !== "dry-run") {
    return { ok: false, error: `provider "${provider}" is not wired up yet (B435)` };
  }
  const dir = orderDir(owner, orderId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${base}.pdf`), both);
  fs.writeFileSync(path.join(dir, `${base}-front.pdf`), front);
  fs.writeFileSync(path.join(dir, `${base}-back.pdf`), back);
  // Not the recipient's name: this string ends up in the ledger and in an API
  // response, and neither is a place to put somebody's name and town.
  return { ok: true, ref: `dry-run:${orderId}:${base}` };
}

export async function sendOrder(owner: string, id: string): Promise<SendOutcome> {
  if (!isEnabled("postcards", owner)) return { ok: false, reason: "postcards_off" };
  if (!isEnabled("contacts", owner)) return { ok: false, reason: "contacts_off" };

  const order = await getOrder(owner, id);
  if (!order) return { ok: false, reason: "unknown_order" };
  if (order.status !== "draft") return { ok: false, reason: "already_sent" };
  if (isExpired(order)) return { ok: false, reason: "expired" };

  // Resolved before the claim so that an order nobody can be posted to is
  // refused without touching the row — and, more importantly, so the charge
  // below is for the cards that will actually be printed rather than for the
  // list as it stood a week ago.
  const addresses = await addressesFor(owner, order.payload.recipients);
  const recipients = order.payload.recipients
    .map((contactId) => ({ contactId, to: addresses.get(contactId) }))
    .filter((r): r is { contactId: string; to: PostalAddress } => Boolean(r.to));
  const skipped = order.payload.recipients.length - recipients.length;
  if (recipients.length === 0) return { ok: false, reason: "no_recipients" };

  const photo = readPhoto(order);
  if (!photo) return { ok: false, reason: "photo_missing" };

  if (!(await claimForSend(owner, id))) return { ok: false, reason: "already_sent" };

  const charge = order.payload.creditsEach * recipients.length;
  if (!(await spend(owner, charge, "postcard", id))) {
    // Sendable again once they have bought credits. An order stuck in
    // `submitted` because a balance was short would be the feature telling
    // somebody to start over for having run out of money.
    await releaseClaim(owner, id);
    return { ok: false, reason: "no_credits", needed: charge, balance: await balanceOf(owner) };
  }

  const bases = recipientBases(recipients.map((r) => r.to.name));
  const warnings: PostcardWarning[] = [];
  const results: RecipientResult[] = [];
  // The first card, kept for the receipt — B467. One, not all: the design is
  // identical on every card, and attaching five would put five households'
  // addresses in one inbox to prove one photograph.
  let firstCard: Uint8Array | undefined;

  for (const [index, { contactId, to }] of recipients.entries()) {
    const common = { photo, message: order.payload.message, from: order.payload.from, to };
    const both = renderPostcard(common);
    // One card's warnings stand for the order: the photograph and the message
    // are the same on every one of them, so repeating them per recipient would
    // be the same sentence four times.
    if (index === 0) {
      warnings.push(...both.warnings);
      firstCard = both.pdf;
    }
    const front = renderPostcard({ ...common, sides: "front" }).pdf;
    const back = renderPostcard({ ...common, sides: "back" }).pdf;

    const outcome = await handToProvider(
      order.provider,
      owner,
      id,
      bases[index].base,
      front,
      back,
      both.pdf,
    );
    results.push({ contactId, ...outcome });
  }

  const failed = results.filter((r) => !r.ok).length;
  if (failed > 0) await refund(owner, failed * order.payload.creditsEach, id);
  await recordResults(owner, id, order.payload, results);

  const sent = results.length - failed;
  if (sent > 0) {
    // Best effort, and never awaited into the outcome: the cards are already
    // at the printer, so a dead SMTP host must not turn a send that happened
    // into a send that reports failure. `sendPostcardReceipt` swallows its own
    // errors; this catch is the belt to that braces.
    await sendPostcardReceipt({
      owner,
      orderId: id,
      day: order.payload.day,
      // Names only. Never an address in a mail — the rule
      // `lib/contacts/mail.ts` states for its own letters.
      names: recipients
        .filter((_, i) => results[i]?.ok)
        .map((r) => r.to.name),
      sent,
      creditsSpent: charge - failed * order.payload.creditsEach,
      balance: await balanceOf(owner),
      pdf: firstCard ? Buffer.from(firstCard) : undefined,
    }).catch(() => {});
  }

  return {
    ok: true,
    sent: results.length - failed,
    failed,
    skipped,
    charged: charge - failed * order.payload.creditsEach,
    warnings,
  };
}

import "server-only";
import fs from "node:fs";
import path from "node:path";
import { contentRoot } from "../contentRoot";
import { isEnabled } from "../capabilities";
import { loadServerConfig } from "../config";
import { balanceOf, refund, spend } from "../credits";
import { resolveMediaFile } from "../media";
import { getTrip, parseTripRef } from "../trips";
import type { Figure } from "../travellers/vocabulary";
import { addressesFor } from "./contacts";
import { travellerPartyFor } from "./entry";
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
import { printSourceFor } from "../photobook/source";
import { sendPostcard as sendViaStannp } from "./stannp";
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

type SendFailure =
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

/**
 * Which copy of that photograph actually goes on the card — B1010.
 *
 * The one above is the *web* copy: ingest writes 2000px on the longest edge
 * and keeps the original beside it, and a card was being printed from the
 * derivative. On a 154 × 111 mm card with bleed a 4032 × 3024 phone photograph
 * is about 660 dpi and the derivative is about 244, so the page then told the
 * owner their photograph was too small — about a file this product had chosen
 * for them.
 *
 * The photobook has done this since B13 (`printSourceFor`, and its comment
 * about every plate printing at 125 dpi until somebody looked); this is that
 * fix arriving at the other printer. Reused rather than copied: the fallbacks
 * are the interesting part and they are the same ones — no original was kept,
 * or the original is a HEIC or a RAW and the PDF writer can only embed JPEG.
 *
 * **`orderPhotoFile` stays the gate.** `payload.photo` is attacker-controlled
 * in principle, `resolveMediaFile` is what refuses a path escaping the trip,
 * and only once it has passed is a better copy looked for.
 */
export function orderPrintPhoto(
  order: PostcardOrder,
): { absolute: string; size?: { width: number; height: number } } | null {
  const guarded = orderPhotoFile(order);
  if (!guarded) return null;
  const source = printSourceFor(order.payload.trip, order.payload.photo);
  return { absolute: source.absolute, size: source.size };
}

/**
 * The party for this order, or none — B628.
 *
 * Resolved at send rather than stored on the order: the trip's `travellers:`
 * block is the owner's own file and can change between the preview and the
 * button, and a card should print whoever is described *now*, the same
 * reasoning `orderPhotoFile` already applies to the photograph.
 */
function figuresFor(order: PostcardOrder): Figure[] {
  // Absent means on — see `OrderPayload.figures`. Only an explicit `false`,
  // which is the owner having unticked the box, prints a bare back.
  if (order.payload.figures === false) return [];
  const trip = getTrip(order.payload.trip);
  if (!trip) return [];
  return travellerPartyFor(trip);
}

function readPhoto(order: PostcardOrder): Uint8Array | null {
  const file = orderPrintPhoto(order)?.absolute;
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
 * `dry-run` writes the print-ready files and calls nobody, which is the whole
 * pipeline minus the account and is what lets this flow be developed and
 * tested on a fresh clone with no key. `stannp` really posts — subject to
 * `features.postcards.live`, which is off unless an operator said otherwise
 * and which makes every request a free sample render (see ./stannp.ts).
 *
 * Anything else fails closed rather than quietly writing files and reporting a
 * send, which is the failure that looks fine in the logs.
 */
/**
 * Stannp's `cost` is a decimal string ("0.79") in the account's own
 * currency — B1347. Minor units or nothing: a figure that does not parse is
 * absent, never zero, because zero is a claim about money.
 */
function costToMinor(cost: string | undefined): number | undefined {
  if (!cost) return undefined;
  const value = Number.parseFloat(cost);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return Math.round(value * 100);
}

/**
 * The currency Stannp's per-card `cost` figures are in. Their API names no
 * currency — it bills in the account's own — so the operator says it once in
 * `features.postcards.currency`. Unset, the summed cost is still stored and
 * /admin reports it as unconvertible rather than guessing.
 */
function providerCurrency(): string | null {
  const feature = loadServerConfig().features.postcards as Record<string, unknown>;
  const currency = feature.currency;
  return typeof currency === "string" && /^[A-Za-z]{3}$/.test(currency.trim())
    ? currency.trim().toUpperCase()
    : null;
}

async function handToProvider(
  provider: string,
  owner: string,
  orderId: string,
  base: string,
  to: PostalAddress,
  front: Uint8Array,
  back: Uint8Array,
  both: Uint8Array,
): Promise<{ ok: boolean; ref?: string; costMinor?: number; error?: string }> {
  if (provider === "stannp") {
    const result = await sendViaStannp({ to, front, back, paymentRef: orderId });
    return result.ok
      ? { ok: true, ref: result.ref, costMinor: costToMinor(result.cost) }
      : { ok: false, error: result.error };
  }
  if (provider !== "dry-run") {
    return { ok: false, error: `provider "${provider}" is not wired up` };
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
  const figures = figuresFor(order);

  for (const [index, { contactId, to }] of recipients.entries()) {
    const common = {
      photo,
      message: order.payload.message,
      from: order.payload.from,
      figures,
      to,
      crop: order.payload.crop,
    };
    const both = renderPostcard(common);
    // One card's warnings stand for the order: the photograph and the message
    // are the same on every one of them, so repeating them per recipient would
    // be the same sentence four times.
    if (index === 0) {
      warnings.push(...both.warnings);
      firstCard = both.pdf;
    }
    // What the printer gets carries no address and no stamp box — B982.
    // Stannp is handed the recipient as fields and lays its own address and
    // postal indicia over the back; a back with ours already on it came out
    // with the two overprinted, one name across the other. `both` above keeps
    // drawing them, because that copy is the owner's proof and the receipt
    // attachment, and there the question being answered is "who is this going
    // to" rather than "what does the press receive".
    const forPrinter = { ...common, address: "printer" as const };
    const front = renderPostcard({ ...forPrinter, sides: "front" }).pdf;
    const back = renderPostcard({ ...forPrinter, sides: "back" }).pdf;

    const outcome = await handToProvider(
      order.provider,
      owner,
      id,
      bases[index].base,
      to,
      front,
      back,
      both.pdf,
    );
    results.push({ contactId, ...outcome });
  }

  const failed = results.filter((r) => !r.ok).length;
  if (failed > 0) await refund(owner, failed * order.payload.creditsEach, id);
  await recordResults(owner, id, order.payload, results, providerCurrency());

  const sent = results.length - failed;
  // Nothing printed is not a send, and reporting it as one is the failure that
  // looks fine in the logs. This returned `ok: true, sent: 0` and the page duly
  // headed it "sent" over a banner reading "the cards are at the printer",
  // above an order whose every card the provider had refused and whose credits
  // had already been given back. `provider_unavailable` was declared in
  // `SendFailure` and mapped on the page from the start and returned by
  // nothing; this is the case it was written for.
  if (sent === 0) {
    return { ok: false, reason: "provider_unavailable" };
  }
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

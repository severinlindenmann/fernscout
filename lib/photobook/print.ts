import "server-only";
import { refund, spend } from "../credits";
import { BASE_RAPPEN_PER_CREDIT } from "../credits/pricing";
import { getUser } from "../users";
import { serverSite } from "../site";
import { signFileLink } from "./fileLink";
import { quoteBook, submitBookPrint, type QuoteResult } from "./gelato";
import {
  claimForPrint,
  getPhotobookOrder,
  markPrintFailed,
  recordPrint,
  type PhotobookPayload,
} from "./orders";
import { bookAddressFor } from "./recipients";
import { BOOK_SIZES } from "./spec";

/**
 * Turning a *built* book into a printed one — the photobook counterpart of
 * `lib/postcard/send.ts`, following its reasoning exactly.
 *
 * ## The order of operations, and why it is that order
 *
 * 1. **Claim** the row (`printed → print_submitted`), on rows-affected.
 * 2. **Spend** the credits.
 * 3. **Submit**, and refund what Gelato refused.
 *
 * Claiming first is what makes a double press cost one book. If the spend
 * came first, two presses arriving together would both find a healthy
 * balance, both debit it, and the second would then discover the order was
 * already claimed — leaving the owner correctly charged twice for one book,
 * which is the worst available failure because it looks fine in the logs.
 *
 * The quote is re-checked *before* either of those two, and refuses without
 * touching the row or the balance when it has moved: the price a person saw
 * is the only price they agreed to spend.
 *
 * ## There is no route to this function that an agent can reach
 *
 * `printOrder` is called from the owner's own page and from nowhere else —
 * `test/photobook-print.test.ts` asserts that nothing under `app/api` imports
 * it or `submitBookPrint`. If you are adding an API route that calls this,
 * the answer is no — see `lib/photobook/recipients.ts` for what an agent may
 * do instead: propose, never press.
 */

export type PrintFailure =
  | "unknown_order"
  | "not_built"
  | "already_printing"
  | "no_recipient"
  | "no_credits"
  | "stale_quote"
  | "provider_unavailable"
  | "refused";

export type PrintOutcome =
  | { ok: true; providerRef: string; charged: number }
  | { ok: false; reason: PrintFailure };

/**
 * A live quote, in credits — the same rounding `lib/credits/pricing.ts` uses
 * to turn money into a number a person spends, ceilinged so the ledger never
 * takes less than what was actually quoted.
 *
 * Always quoted to Switzerland. Pricing anywhere else needs a live quote to
 * the actual destination, which is left for a capture (see the plan's
 * self-review notes) — every book ordered through this path ships from and,
 * for now, is priced as though it were also read to, Zurich.
 */
const QUOTE_COUNTRY = "CH";
const QUOTE_CURRENCY = "CHF";

function creditsFor(quote: QuoteResult): number {
  return Math.ceil((quote.printMinor + quote.shipMinor) / BASE_RAPPEN_PER_CREDIT);
}

export async function printOrder(owner: string, id: string, quotedCredits: number): Promise<PrintOutcome> {
  const order = await getPhotobookOrder(owner, id);
  if (!order) return { ok: false, reason: "unknown_order" };
  if (order.status !== "printed") return { ok: false, reason: "not_built" };

  const print = order.payload.print;
  if (!print?.contactId) return { ok: false, reason: "no_recipient" };

  const size = BOOK_SIZES[order.payload.options.size];
  if (!size) return { ok: false, reason: "no_recipient" };

  const quote = await quoteBook({
    productUid: size.productUid,
    pageCount: order.payload.pages,
    country: QUOTE_COUNTRY,
    currency: QUOTE_CURRENCY,
  });
  if ("error" in quote) return { ok: false, reason: "provider_unavailable" };
  if (creditsFor(quote) !== quotedCredits) return { ok: false, reason: "stale_quote" };

  const to = await bookAddressFor(owner, print.contactId);
  if (!to) return { ok: false, reason: "no_recipient" };

  if (!(await claimForPrint(owner, id))) return { ok: false, reason: "already_printing" };

  if (!(await spend(owner, quotedCredits, "photobook_print", id))) {
    // Same shape as `sendOrder`: sendable again once there are credits, so a
    // short balance is not a row stuck forever.
    await markPrintFailed(owner, id, order.payload, "no_credits");
    return { ok: false, reason: "no_credits" };
  }

  const email = getUser(owner)?.owner.email ?? "";
  const base = serverSite().url;
  const files = order.payload.files ?? [];
  const interior = files.find((f) => f.endsWith("-interior.pdf")) ?? "book-interior.pdf";
  const cover = files.find((f) => f.endsWith("-cover.pdf")) ?? "book-cover.pdf";
  const fileUrl = (file: string) =>
    `${base}/${encodeURIComponent(owner)}/photobooks/${encodeURIComponent(id)}/${file}${signFileLink(owner, id, file)}`;

  const result = await submitBookPrint({
    reference: id,
    title: order.payload.trip,
    interiorUrl: fileUrl(interior),
    coverUrl: fileUrl(cover),
    pageCount: order.payload.pages,
    trimWidthMm: size.trimWidthMm,
    trimHeightMm: size.trimHeightMm,
    copies: 1,
    to: {
      name: to.name,
      line1: to.line1,
      line2: to.line2,
      postcode: to.postcode,
      city: to.city,
      country: to.country ?? "",
      email,
    },
    test: true,
    productUid: size.productUid,
    shipmentMethodUid: quote.shipmentMethodUid,
    paymentRef: id,
  });

  if ("error" in result) {
    await refund(owner, quotedCredits, id);
    await markPrintFailed(owner, id, order.payload, "refused");
    return { ok: false, reason: "refused" };
  }

  const payload: PhotobookPayload = { ...order.payload, print: { ...print, providerRef: result.providerRef } };
  await recordPrint(owner, id, payload, result.providerRef);
  return { ok: true, providerRef: result.providerRef, charged: quotedCredits };
}

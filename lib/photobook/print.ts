import "server-only";
import { refund, spend } from "../credits";
import { photobookPrintCredits } from "../credits/pricing";
import { getUser } from "../users";
import { serverSite } from "../site";
import { isoCountry } from "./country";
import { signFileLink } from "./fileLink";
import { quoteBook, submitBookPrint } from "./gelato";
import {
  claimForPrint,
  getPhotobookOrder,
  markPrintFailed,
  recordPrint,
  type PhotobookPayload,
} from "./orders";
import { bookAddressFor } from "./recipients";
import { BOOK_SIZES, productUidFor } from "./spec";

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

type PrintFailure =
  | "unknown_order"
  | "not_built"
  | "already_printing"
  | "no_recipient"
  | "no_credits"
  | "stale_quote"
  /** The address has a country Gelato cannot be asked about. */
  | "unknown_country"
  | "provider_unavailable"
  | "refused";

export type PrintOutcome =
  | { ok: true; providerRef: string; charged: number }
  | { ok: false; reason: PrintFailure };

/**
 * Every state `app/[user]/photobooks/[id]/print/route.ts`'s redirect can
 * carry back to the order page, as a `?print=` query — B484's own reasoning,
 * applied here. `PrintFailure` above is every way `printOrder` can refuse,
 * plus the two the redirect adds that are not refusals of *it*: `"printed"`
 * is the one success, and `"forbidden"` is the redirect's own refusal when
 * the presser is not the owner, before `printOrder` is ever called.
 *
 * The order page's own message table is declared as an exact `Record` over
 * this union rather than `Record<string, …>`, so a state added here without
 * a matching entry there fails the typecheck instead of rendering a blank
 * page at somebody who has often just paid.
 */
export const PHOTOBOOK_PRINT_OUTCOME_STATES = [
  "printed",
  "forbidden",
  "unknown_order",
  "not_built",
  "already_printing",
  "no_recipient",
  "no_credits",
  "stale_quote",
  "unknown_country",
  "provider_unavailable",
  "refused",
] as const;
export type PrintOutcomeState = (typeof PHOTOBOOK_PRINT_OUTCOME_STATES)[number];

/**
 * A live quote, in credits — the same rounding `lib/credits/pricing.ts` uses
 * to turn money into a number a person spends, ceilinged so the ledger never
 * takes less than what was actually quoted.
 *
 * Quoted to wherever the book is actually going.
 *
 * Postage is most of the difference between a cheap book and an expensive
 * one — CHF 8.52 inside Switzerland, several times that to another continent
 * — so a price quoted to Zurich for a book going to Sydney is a price the
 * owner is not paying and we are. The recipient is resolved before the quote
 * for that reason, which is the one departure from `sendOrder`'s order of
 * operations: nothing is claimed or spent either way, and knowing the
 * destination is a precondition of knowing the price.
 */
const QUOTE_CURRENCY = "CHF";

export async function printOrder(owner: string, id: string, quotedCredits: number): Promise<PrintOutcome> {
  const order = await getPhotobookOrder(owner, id);
  if (!order) return { ok: false, reason: "unknown_order" };
  if (order.status !== "printed") return { ok: false, reason: "not_built" };

  const print = order.payload.print;
  if (!print?.contactId) return { ok: false, reason: "no_recipient" };

  // A stored order can name a size, or a size-and-cover pair, that this
  // server no longer prints — Gelato's catalogue is not ours to freeze. That
  // is "not_built" rather than a missing recipient, which is what it used to
  // claim: the book cannot be made, and nothing about the address is wrong.
  const size = BOOK_SIZES[order.payload.options.size];
  const productUid = size ? productUidFor(size.id, order.payload.options.coverType) : null;
  if (!size || !productUid) return { ok: false, reason: "not_built" };

  const to = await bookAddressFor(owner, print.contactId);
  if (!to) return { ok: false, reason: "no_recipient" };

  const country = isoCountry(to.country);
  if (!country) return { ok: false, reason: "unknown_country" };

  const quote = await quoteBook({
    productUid,
    pageCount: order.payload.pages,
    country,
    currency: QUOTE_CURRENCY,
  });
  if ("error" in quote) return { ok: false, reason: "provider_unavailable" };
  if (photobookPrintCredits(quote.printMinor, quote.shipMinor) !== quotedCredits) {
    return { ok: false, reason: "stale_quote" };
  }

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
      // B1126. The ISO code resolved above, never the stored country name.
      // `ShippingAddress.country` is documented as ISO 3166-1 alpha-2 and two
      // of the four provider builders call the field `countryCode` outright,
      // so a contact whose address says "Switzerland" — which is how people
      // write addresses — was refused by Gelato as
      // `shippingAddress.country: This value is not a valid country`. It
      // refused *after* the credits were spent, and only the refund path made
      // that survivable. `country` cannot be null here: `isoCountry` is
      // checked above and returns `unknown_country` when it cannot resolve
      // one.
      country,
      email,
    },
    test: true,
    productUid,
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

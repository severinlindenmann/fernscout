import "server-only";
import { photobookPrintCredits } from "../credits/pricing";
import { nowIso } from "../db";
import { isoCountry } from "./country";
import { quoteBook } from "./gelato";
import { getPhotobookOrder, proposePrint, type PhotobookPayload } from "./orders";
import { bookAddressFor, bookRecipients } from "./recipients";
import { BOOK_SIZES, productUidFor } from "./spec";

/**
 * Naming who a built book is for, and freezing what that will cost — the step
 * between building and printing.
 *
 * **This charges nothing and prints nothing.** It writes `payload.print` and
 * stops; `printOrder` is the only thing that spends credits or reaches
 * Gelato, and it re-quotes before it does.
 *
 * It lives here rather than in either route because there are now two doors
 * onto it and the rule about who may receive a book must not be able to
 * differ between them:
 *
 * - `app/api/v1/[user]/photobooks/[id]/print/route.ts` — an agent proposing,
 *   which is B434's "propose, never press".
 * - `app/[user]/photobooks/[id]/print/route.ts` — the owner choosing on their
 *   own order page and pressing in the same motion (B1093). Before that,
 *   there was no way to address a book from a browser at all: an agent had to
 *   have proposed one first, so an owner with a finished book and a willing
 *   contact had no route to a printed one.
 *
 * The refusals are a closed union rather than sentences, because the two
 * callers say them differently — the agent gets JSON with an explanation, the
 * owner gets a redirect back to a page that already has a message for each
 * state. `PrintFailure` in ./print.ts names four of these five for the same
 * reasons; `unknown_contact` is this step's own, and cannot arise once a
 * recipient is on the order.
 */
type ProposeFailure =
  | "unknown_order"
  | "not_built"
  | "unknown_contact"
  | "unknown_country"
  | "provider_unavailable";

export type ProposeResult =
  | { ok: true; quotedCredits: number }
  | { ok: false; reason: ProposeFailure };

const QUOTE_CURRENCY = "CHF";

export async function proposeBookPrint(
  owner: string,
  id: string,
  contactId: string,
): Promise<ProposeResult> {
  const order = await getPhotobookOrder(owner, id);
  if (!order) return { ok: false, reason: "unknown_order" };
  if (order.status !== "printed") return { ok: false, reason: "not_built" };

  // The whole of "who may receive a book": an approved contact of this
  // journal with a postable address. An id that is not on that list is
  // refused rather than looked up, so neither door can address a book to
  // somebody who never asked this journal for post.
  const recipients = await bookRecipients(owner);
  if (!recipients.some((r) => r.id === contactId)) {
    return { ok: false, reason: "unknown_contact" };
  }

  const size = BOOK_SIZES[order.payload.options.size];
  const productUid = size ? productUidFor(size.id, order.payload.options.coverType) : null;
  const to = size ? await bookAddressFor(owner, contactId) : null;
  if (!size || !productUid || !to) return { ok: false, reason: "not_built" };

  const country = isoCountry(to.country);
  if (!country) return { ok: false, reason: "unknown_country" };

  const quote = await quoteBook({
    productUid,
    pageCount: order.payload.pages,
    country,
    currency: QUOTE_CURRENCY,
  });
  if ("error" in quote) return { ok: false, reason: "provider_unavailable" };

  const quotedCredits = photobookPrintCredits(quote.printMinor, quote.shipMinor);
  const payload: PhotobookPayload = {
    ...order.payload,
    print: {
      contactId,
      quotedCredits,
      quotedAt: nowIso(),
      shipmentMethodUid: quote.shipmentMethodUid,
      quotedMinor: quote.printMinor + quote.shipMinor,
      quotedCurrency: quote.currency,
    },
  };
  // A conditional update on the row's status, so an order that changed under
  // us — built again, already printing — is not quietly re-addressed.
  if (!(await proposePrint(owner, id, payload))) return { ok: false, reason: "not_built" };

  return { ok: true, quotedCredits };
}

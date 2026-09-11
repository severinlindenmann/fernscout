import "server-only";
import { photobookPrintCredits } from "../credits/pricing";
import { priceOf } from "./build";
import type { Photobook } from "./plan";
import { isoCountry } from "./country";
import { quoteBook, type GelatoFailure } from "./gelato";
import { bookAddressFor, bookRecipients } from "./recipients";
import { productUidFor } from "./spec";
import type { BookOptions } from "./options";

/**
 * What one book, posted to one person, costs — B1157.
 *
 * **One product, one price.** Building the PDF and printing the object are two
 * costs and one purchase: the owner sees a total, presses once, and the files
 * arrive with the book rather than instead of it. There is deliberately no
 * files-only price, because there is no files-only product.
 *
 * It lives here, and not in either caller, because both of them need the same
 * number for different reasons and a disagreement between them is a wrong
 * charge:
 *
 * - `app/[user]/photobook/preview/route.ts` quotes it onto the page.
 * - `app/[user]/photobook/order/route.ts` re-derives it at the press and holds
 *   B595's stale-price check against it, refusing rather than charging a
 *   number nobody was shown.
 *
 * The page count comes from the *plan*, not from a built book, which is what
 * makes an honest price possible before the money moves — the same planner
 * produces both. `order/route.ts` re-plans and re-quotes at press time, so a
 * trip that changed in between is caught there rather than trusted here.
 */
export type BookQuote = {
  /** Rendering the PDF. */
  buildCredits: number;
  /** Print and postage, with the resale margin, as one number. */
  printCredits: number;
  /** What the button says. */
  totalCredits: number;
  /** The postage the quote was taken for, echoed so the order submits it. */
  shipmentMethodUid: string;
  /** ISO 3166-1 alpha-2, resolved from the recipient's own address. */
  country: string;
  /** Gelato's own figure — print plus shipping in minor units, and its
   * currency — kept beside the credit prices so the order can record what
   * the print actually cost (B1347). */
  quotedMinor: number;
  quotedCurrency: string;
};

export type QuoteFailure =
  /** Not a contact this journal may post a book to. */
  | "unknown_contact"
  /** Their address names a country the printer cannot be asked about. */
  | "unknown_country"
  /** This size and cover is not one this server prints. */
  | "unknown_product"
  /** Gelato could not be reached, or refused to quote. */
  | "provider_unavailable";

const QUOTE_CURRENCY = "CHF";

export async function quoteBookFor(
  owner: string,
  book: Photobook,
  options: BookOptions,
  contactId: string,
): Promise<BookQuote | { error: QuoteFailure; kind?: GelatoFailure }> {
  // The same gate `proposeBookPrint` applies, for the same reason: a book can
  // only ever be addressed to somebody who asked this journal for post.
  const recipients = await bookRecipients(owner);
  if (!recipients.some((r) => r.id === contactId)) return { error: "unknown_contact" };

  const to = await bookAddressFor(owner, contactId);
  if (!to) return { error: "unknown_contact" };

  const country = isoCountry(to.country);
  if (!country) return { error: "unknown_country" };

  const productUid = productUidFor(options.size, options.coverType);
  if (!productUid) return { error: "unknown_product" };

  const pageCount = book.volumes.reduce((n, v) => n + v.interiorPages, 0);
  const quote = await quoteBook({ productUid, pageCount, country, currency: QUOTE_CURRENCY });
  // `kind` carries which GelatoFailure this was — B1148 — so a caller can
  // tell "the printer refused this server's account" from "the printer could
  // not be reached" without the wire error itself growing a second code.
  if ("error" in quote) return { error: "provider_unavailable", kind: quote.error };

  const buildCredits = priceOf(book);
  const printCredits = photobookPrintCredits(quote.printMinor, quote.shipMinor);
  return {
    buildCredits,
    printCredits,
    totalCredits: buildCredits + printCredits,
    shipmentMethodUid: quote.shipmentMethodUid,
    country,
    quotedMinor: quote.printMinor + quote.shipMinor,
    quotedCurrency: quote.currency,
  };
}

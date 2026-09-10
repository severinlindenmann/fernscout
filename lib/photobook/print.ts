import "server-only";
import { refund, spend } from "../credits";
import { photobookPrintCredits } from "../credits/pricing";
import { getUser } from "../users";
import { serverSite } from "../site";
import { isoCountry } from "./country";
import { signFileLink } from "./fileLink";
import { fetchOrderStatus, quoteBook, submitBookPrint } from "./gelato";
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
  /** Bought printed already — B1164. Nothing to charge for a second time. */
  | "already_paid"
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
  "already_paid",
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

/**
 * Sending a book that has **already been paid for in full** to the printer —
 * B1157, and the half of `printOrder` that is not about money.
 *
 * The one-press flow charges build and print together before this runs, so
 * there is nothing to claim a price against and nothing to spend: the order
 * arrives here built, paid and addressed, and this either gets it to Gelato or
 * gives the whole amount back.
 *
 * **The whole amount, not the print half.** What was sold is a printed book;
 * the PDFs are what comes with it. When the printer refuses, the owner has
 * nothing they bought, so the render is ours to absorb rather than theirs to
 * pay for. The files stay on disk either way — they cost nothing to keep and
 * are occasionally what somebody wants after all.
 *
 * `printOrder` below is unchanged and still owns the other shape: the button
 * on the order page, which quotes and spends the print portion itself. Books
 * built before B1157 still go that way.
 */
export async function submitBuiltBook(owner: string, id: string): Promise<PrintOutcome> {
  const order = await getPhotobookOrder(owner, id);
  if (!order) return { ok: false, reason: "unknown_order" };
  if (order.status !== "printed") return { ok: false, reason: "not_built" };

  const print = order.payload.print;
  if (!print?.contactId) return { ok: false, reason: "no_recipient" };

  const size = BOOK_SIZES[order.payload.options.size];
  const productUid = size ? productUidFor(size.id, order.payload.options.coverType) : null;
  if (!size || !productUid) return { ok: false, reason: "not_built" };

  const to = await bookAddressFor(owner, print.contactId);
  if (!to) return { ok: false, reason: "no_recipient" };

  const country = isoCountry(to.country);
  if (!country) return { ok: false, reason: "unknown_country" };

  // Same conditional update the button uses, so two routes to the printer
  // cannot both submit one order.
  if (!(await claimForPrint(owner, id))) return { ok: false, reason: "already_printing" };

  const result = await submitBookPrint(
    bookOrderFor(owner, id, order.payload, to, size, productUid, print.shipmentMethodUid, country),
  );

  if ("error" in result) {
    // Everything back. `payload.credits` is what the owner actually pressed —
    // build and print together — not just the print portion.
    await refund(owner, order.payload.credits, id);
    await markPrintFailed(owner, id, order.payload, "refused");
    return { ok: false, reason: "refused" };
  }

  const payload: PhotobookPayload = { ...order.payload, print: { ...print, providerRef: result.providerRef } };
  await recordPrint(owner, id, payload, result.providerRef);

  /**
   * Accepting an order is not the same as taking it — B1333.
   *
   * `submitBookPrint` answers with a provider reference the moment Gelato
   * accepts the *create*. Whether the order is actually going to be printed is
   * decided seconds later and separately, and nothing here used to look again:
   * an order with no payment method behind it came back with a reference, was
   * recorded as printing, charged 203 credits, mailed a receipt with the PDFs
   * — and was `fulfilmentStatus: failed, financialStatus: refused` at Gelato
   * before the owner had finished reading it.
   *
   * So the settlement is waited for, briefly. A terminal failure inside the
   * window is treated exactly like a refusal at the door: everything back, the
   * order marked failed, and the caller told. Anything still pending is left
   * alone and reported as success, which is the ordinary case — a real order
   * sits in `created` or `passed` for far longer than anyone can be kept
   * waiting on a button.
   *
   * This closes the case that is reproducible today and **not** the general
   * one: an order that fails an hour later is still nobody's news. That needs
   * Gelato's webhook or a sweep, and is the rest of B1333.
   */
  const settled = await settlementFailure(result.providerRef);
  if (settled) {
    await refund(owner, order.payload.credits, id);
    await markPrintFailed(owner, id, order.payload, settled);
    return { ok: false, reason: "refused" };
  }

  return { ok: true, providerRef: result.providerRef, charged: order.payload.credits };
}

/** How long to wait for the printer to make up its mind, and how often to ask. */
const SETTLE_WINDOW_MS = 20_000;
const SETTLE_POLL_MS = 4_000;

/**
 * The statuses that mean this order is never going to be printed. Anything
 * else — `created`, `passed`, `in_production`, `printed`, or a word Gelato
 * adds tomorrow — is not a failure and must not trigger a refund.
 */
const TERMINAL_FAILURES = new Set(["failed", "canceled", "cancelled"]);

/**
 * Whether the printer refused this order within the settlement window, and
 * what it called it. `null` means it did not — either it is still deciding, or
 * it accepted.
 */
async function settlementFailure(providerRef: string): Promise<string | null> {
  const deadline = Date.now() + SETTLE_WINDOW_MS;
  for (;;) {
    const status = await fetchOrderStatus(providerRef);
    if (status && TERMINAL_FAILURES.has(status.toLowerCase())) return status;
    if (Date.now() + SETTLE_POLL_MS >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, SETTLE_POLL_MS));
  }
}

/**
 * The request Gelato is given for one built book. Shared by both routes to the
 * printer so a change to what is submitted cannot reach one and miss the
 * other.
 */
function bookOrderFor(
  owner: string,
  id: string,
  payload: PhotobookPayload,
  to: { name: string; line1: string; line2?: string; postcode: string; city: string; country?: string },
  size: { trimWidthMm: number; trimHeightMm: number },
  productUid: string,
  shipmentMethodUid: string,
  country: string,
) {
  const email = getUser(owner)?.owner.email ?? "";
  const base = serverSite().url;
  const files = payload.files ?? [];
  const interior = files.find((f) => f.endsWith("-interior.pdf")) ?? "book-interior.pdf";
  const cover = files.find((f) => f.endsWith("-cover.pdf")) ?? "book-cover.pdf";
  const fileUrl = (file: string) =>
    `${base}/${encodeURIComponent(owner)}/photobooks/${encodeURIComponent(id)}/${file}${signFileLink(owner, id, file)}`;

  return {
    reference: id,
    title: payload.trip,
    interiorUrl: fileUrl(interior),
    coverUrl: fileUrl(cover),
    pageCount: payload.pages,
    trimWidthMm: size.trimWidthMm,
    trimHeightMm: size.trimHeightMm,
    copies: 1,
    to: {
      name: to.name,
      line1: to.line1,
      line2: to.line2,
      postcode: to.postcode,
      city: to.city,
      // B1126. The ISO code, never the stored country name.
      country,
      email,
    },
    test: true,
    productUid,
    shipmentMethodUid,
    paymentRef: id,
  };
}

export async function printOrder(owner: string, id: string, quotedCredits: number): Promise<PrintOutcome> {
  const order = await getPhotobookOrder(owner, id);
  if (!order) return { ok: false, reason: "unknown_order" };
  if (order.status !== "printed") return { ok: false, reason: "not_built" };

  const print = order.payload.print;
  if (!print?.contactId) return { ok: false, reason: "no_recipient" };

  // B1164. This function quotes and spends the *print portion*, which is right
  // for a book bought before B1157 — those paid for the build alone. A book
  // bought printed has already paid for all of it, and charging again here is
  // a second, smaller charge for the same object: 165 against the 205 that had
  // been paid. Refused at the route rather than only hidden on the page,
  // because the page is not the only way to reach this.
  if (print.paid) return { ok: false, reason: "already_paid" };

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

  const result = await submitBookPrint(
    bookOrderFor(owner, id, order.payload, to, size, productUid, quote.shipmentMethodUid, country),
  );

  if ("error" in result) {
    await refund(owner, quotedCredits, id);
    await markPrintFailed(owner, id, order.payload, "refused");
    return { ok: false, reason: "refused" };
  }

  const payload: PhotobookPayload = { ...order.payload, print: { ...print, providerRef: result.providerRef } };
  await recordPrint(owner, id, payload, result.providerRef);
  return { ok: true, providerRef: result.providerRef, charged: quotedCredits };
}

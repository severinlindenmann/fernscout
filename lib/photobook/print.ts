import "server-only";
import { adminEmail } from "../admin";
import { refund } from "../credits";
import { serverSite } from "../site";
import { isoCountry } from "./country";
import { signFileLink } from "./fileLink";
import { fetchOrderStatus, submitBookPrint, type GelatoFailure } from "./gelato";
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
 * B1157 unified buying and printing into one press (`order/route.ts`): the
 * price is agreed, the book is built and the credits are spent before this
 * runs, so `submitBuiltBook` neither quotes nor charges — it either gets the
 * paid-for order to Gelato or gives the whole amount back.
 *
 * The pre-B1157 door — a book bought for its build alone, addressed and
 * charged separately afterwards, with its own quote-and-spend function and
 * the failure states that guarded it — was deleted whole by B1428: nothing
 * but the demo journal had ever used it, and the print button's own outcome
 * table went with it.
 *
 * ## There is no route to this function that an agent can reach
 *
 * `submitBuiltBook` is called from the owner's own order route and from
 * nowhere else — `test/photobook-print.test.ts` asserts that nothing under
 * `app/api` imports it or `submitBookPrint`. If you are adding an API route
 * that calls this, the answer is no.
 */

type PrintFailure =
  | "unknown_order"
  | "not_built"
  | "already_printing"
  | "no_recipient"
  /** The address has a country Gelato cannot be asked about. */
  | "unknown_country"
  | "provider_unavailable"
  | "refused";

export type PrintOutcome =
  | { ok: true; providerRef: string; charged: number }
  | { ok: false; reason: PrintFailure };

/**
 * `no_key` and `refused` are the printer answering — or refusing to be
 * asked — because this server's own account is rejected; nothing an owner
 * does fixes that. `unreachable` is weather. B1148: the owner-facing reason
 * forks on this, not on the raw `GelatoFailure`, so there are two messages
 * rather than three.
 */
function isOperatorFault(kind: GelatoFailure): boolean {
  return kind !== "unreachable";
}

/**
 * Sending a book that has **already been paid for in full** to the printer —
 * B1157.
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
 * This is the only door onto Gelato left in this codebase — B1428 deleted the
 * pre-B1157 one, which quoted and spent a "print portion" against a book
 * bought for its build alone.
 */
export async function submitBuiltBook(owner: string, id: string): Promise<PrintOutcome> {
  const order = await getPhotobookOrder(owner, id);
  if (!order) return { ok: false, reason: "unknown_order" };
  if (order.status !== "built") return { ok: false, reason: "not_built" };

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
    // build and print together — not just the print portion. The stored
    // failure is the real GelatoFailure, not a fixed word, so /admin (B1165)
    // can eventually show what actually happened.
    await refund(owner, order.payload.credits, id);
    await markPrintFailed(owner, id, order.payload, result.error, result.message);
    return { ok: false, reason: isOperatorFault(result.error) ? "refused" : "provider_unavailable" };
  }

  const payload: PhotobookPayload = { ...order.payload, print: { ...print, providerRef: result.providerRef } };
  await recordPrint(
    owner,
    id,
    payload,
    result.providerRef,
    // The figure frozen when the book was bought printed; a pre-B1347 order
    // has none, and its cost stays honestly unrecorded.
    print.quotedMinor && print.quotedCurrency
      ? { minor: print.quotedMinor, currency: print.quotedCurrency }
      : undefined,
  );

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
  // Never the journal owner's address (B1439). Buying a book here is not a
  // decision to enter a relationship with the printer, and every word about
  // an order should come from Fernscout, not from Gelato mailing the owner
  // directly. `site/config.json` has no site-wide contact address to fall
  // back to, so an instance with no admin address set posts none at all —
  // a configuration gap an operator can read and fix, rather than silently
  // reinstating the leak.
  const email = adminEmail() ?? "";
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

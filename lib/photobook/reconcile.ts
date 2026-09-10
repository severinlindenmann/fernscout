import "server-only";
import { refund } from "../credits";
import { getTrip } from "../trips";
import { fetchOrderStatus } from "./gelato";
import { listSubmittedPrints, markPrintFailed, getPhotobookOrder } from "./orders";
import { sendPhotobookRefused } from "./receipt";

/**
 * Asking the printer what actually became of the orders it took — B1336.
 *
 * A print is accepted and then decided on, and the two can be minutes apart.
 * `submitBuiltBook` waits twenty seconds for the answer, which catches the
 * refusal that comes back immediately and nothing else; the live case that
 * prompted this took longer than that and left the order sitting in
 * `print_submitted` with the credits gone and the owner told it was being
 * printed.
 *
 * So this closes the loop from the other end: every in-flight order, once, and
 * anything the printer has finally refused is settled the way a refusal at the
 * door already is — money back, order marked failed, the owner told by mail
 * with no download links (B1330).
 *
 * **Terminal failures only.** `created`, `passed`, `in_production`, `printed`
 * and any word Gelato adds next year are not failures: an order still being
 * decided must be left exactly where it is and asked again next time.
 *
 * Idempotent by construction. `markPrintFailed` moves the row out of
 * `print_submitted`, so a settled order is not in the next sweep's list and
 * cannot be refunded twice — the same rows-affected reasoning
 * `claimForPrint` uses.
 */

/** What is never coming back. */
const TERMINAL_FAILURES = new Set(["failed", "canceled", "cancelled"]);

export type ReconcileResult = {
  checked: number;
  settled: number;
  /** Orders asked about whose status could not be read — left for next time. */
  unreachable: number;
};

export async function reconcileSubmittedPrints(): Promise<ReconcileResult> {
  const inFlight = await listSubmittedPrints();
  let settled = 0;
  let unreachable = 0;

  for (const order of inFlight) {
    const status = await fetchOrderStatus(order.providerRef);
    if (status === null) {
      // No key, no network, or a reference Gelato does not know. Never a
      // reason to refund — an unanswered question is not a refusal.
      unreachable += 1;
      continue;
    }
    if (!TERMINAL_FAILURES.has(status.toLowerCase())) continue;

    // Re-read rather than trusting the listing: this loop can take a while,
    // and the twenty-second check inside `submitBuiltBook` may have settled
    // the same order in between.
    const current = await getPhotobookOrder(order.owner, order.id);
    if (!current || current.status !== "print_submitted") continue;

    await refund(order.owner, order.credits, order.id);
    await markPrintFailed(order.owner, order.id, current.payload, status);
    await sendPhotobookRefused({
      owner: order.owner,
      orderId: order.id,
      tripTitle: getTrip(order.trip)?.title ?? order.trip,
      creditsRefunded: order.credits,
    });
    settled += 1;
    console.warn(
      `[photobook] ${order.id} settled as ${status} — ${order.credits} credits returned to ${order.owner}`,
    );
  }

  return { checked: inFlight.length, settled, unreachable };
}

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

/** Whether this is a status the order will never recover from. */
export function isTerminalFailure(status: string): boolean {
  return TERMINAL_FAILURES.has(status.trim().toLowerCase());
}

/**
 * Settle one order the printer has finally refused — the whole of what that
 * means, in one place, because two things now do it.
 *
 * The sweep finds these by asking; the webhook is told (B1345). Neither may
 * have its own idea of what settling is: money back, order marked failed,
 * owner told by mail with no download links.
 *
 * **Idempotent, and that is load-bearing.** The webhook and the sweep can
 * arrive at the same order seconds apart, and Gelato retries a webhook it
 * thinks failed. The status is re-read here and the order is only settled out
 * of `print_submitted`, which `markPrintFailed` then leaves — so the second
 * caller finds nothing to do and refunds nothing. Returns whether it settled.
 */
export async function settleRefusedPrint(
  owner: string,
  id: string,
  status: string,
): Promise<boolean> {
  const current = await getPhotobookOrder(owner, id);
  if (!current || current.status !== "print_submitted") return false;

  const credits = current.payload.credits;
  await refund(owner, credits, id);
  await markPrintFailed(owner, id, current.payload, status);
  await sendPhotobookRefused({
    owner,
    orderId: id,
    tripTitle: getTrip(current.payload.trip)?.title ?? current.payload.trip,
    creditsRefunded: credits,
  });
  console.warn(
    `[photobook] ${id} settled as ${status} — ${credits} credits returned to ${owner}`,
  );
  return true;
}

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
    if (!isTerminalFailure(status)) continue;

    // `settleRefusedPrint` re-reads the row rather than trusting this listing:
    // the loop takes a while, and the webhook or `submitBuiltBook`'s own check
    // may have settled the same order in between.
    if (await settleRefusedPrint(order.owner, order.id, status)) settled += 1;
  }

  return { checked: inFlight.length, settled, unreachable };
}

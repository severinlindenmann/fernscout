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
 * Settled exactly once, by a claim rather than by a check — B1348.
 * `markPrintFailed` is a conditional update on rows-affected, so of two
 * callers racing for one order only the winner refunds. Reading the status
 * first and trusting it is what this used to do, and both callers passed.
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
 * **Settled once, and that is load-bearing.** The webhook and the sweep can
 * arrive at the same order seconds apart, and Gelato retries a webhook it
 * thinks failed. The claim below is what makes only one of them refund — not
 * the read above it, which both would pass. Returns whether it settled.
 */
export async function settleRefusedPrint(
  owner: string,
  id: string,
  status: string,
): Promise<boolean> {
  const current = await getPhotobookOrder(owner, id);
  if (!current || current.status !== "print_submitted") return false;

  const credits = current.payload.credits;

  /**
   * **Claim before refunding, never after** — B1348.
   *
   * The read above is not the guard it looks like. Two callers reach the same
   * order at the same moment — Gelato's webhook and the five-minute sweep, or
   * a webhook Gelato retries — and both see `print_submitted` before either
   * has changed anything. `refund()` is unconditional and does not
   * deduplicate by ref, so both would credit the owner and the second is money
   * given away.
   *
   * `markPrintFailed` is now a conditional update on rows-affected, so exactly
   * one caller wins it. The loser returns having done nothing, which is what
   * the callers already treat as "somebody else settled this".
   *
   * **This order, and not the other way round**, which is `printOrder`'s own
   * reasoning one step earlier: claiming first means a crash between the two
   * leaves an order marked failed and not yet refunded — visible, and a
   * person can put it right. Refunding first would mean a crash leaves it
   * refundable again, and the failure nobody sees is the one that pays twice.
   */
  if (!(await markPrintFailed(owner, id, current.payload, status))) return false;

  await refund(owner, credits, id);
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

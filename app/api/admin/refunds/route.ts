import { clawBack } from "@/lib/credits";
import { sendRefundNotice } from "@/lib/credits/receipt";
import { isInstanceAdmin } from "@/lib/adminGate";
import { refundPayment } from "@/lib/payments";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/**
 * The operator records a refund — B878.
 *
 * **It acts immediately, unlike `/api/admin/grants` beside it, and the
 * asymmetry is the whole safety argument.** `lib/credits.ts`'s property 1 is
 * that nothing reachable over HTTP *raises* a balance; a refund lowers one, so
 * the mailed single-use link that protects a grant would buy nothing here. The
 * worst an admin cookie can do through this route is take credits off a
 * journal and mark a purchase refunded — recoverable by granting them back,
 * which still costs a trip through the operator's mailbox.
 *
 * **It moves no money.** Stripe is not called; the operator refunds the charge
 * in the dashboard and this is the record of it. That is the same shape as the
 * postcard send route refusing to take an address: the irreversible half stays
 * where a person is already standing.
 *
 * Outside `/api/v1/` and cookie-only, exactly as the grant route is.
 */
export async function POST(request: Request) {
  if (!(await isInstanceAdmin())) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const limit = rateLimitFor("admin-refund", clientIp(request), { max: 20, windowMs: 60 * 1000 });
  if (!limit.ok) {
    return Response.json(
      { error: "too_many_requests", retryAfter: limit.retryAfter },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const username = typeof body.user === "string" ? body.user : "";
  const paymentId = typeof body.payment === "string" ? body.payment : "";
  if (!getUser(username)) return Response.json({ error: "unknown_journal" }, { status: 404 });
  if (!paymentId) return Response.json({ error: "bad_payment" }, { status: 400 });

  const refunded = await refundPayment(username, paymentId);
  if (!refunded.ok) {
    // "Already refunded" and "never paid" are one answer: both mean there is
    // nothing here to give back, and the operator is looking at the row.
    return Response.json(
      {
        error: refunded.reason,
        message:
          refunded.reason === "not_paid"
            ? "That purchase is not in a settled state — it may already be refunded."
            : "No such purchase on that journal.",
      },
      { status: refunded.reason === "unknown" ? 404 : 409 },
    );
  }

  // The row is marked before the credits move, deliberately. If this process
  // dies between the two, the operator sees a refunded purchase whose credits
  // are still there and can take them off by hand; the other order would leave
  // a journal short of credits with nothing on the page saying why.
  const taken = await clawBack(username, refunded.payment.credits, `refund ${paymentId}`);
  const shortfall = refunded.payment.credits - taken;

  await sendRefundNotice(refunded.payment, taken);

  return Response.json({ ok: true, status: "refunded", creditsTaken: taken, shortfall });
}

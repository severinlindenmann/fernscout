// The operator approves a purchase, and that grants the credits — B1622,
// phase 2 step 4 (money.md §2.5), moved from
// app/api/v1/[user]/payments/[id]/approve/route.ts.
//
// **The token travels in the body, not the path** — B1636, and the move to a
// path segment was briefly made and reverted. A URL is written to the access
// log, kept in proxy logs, and sent onward in `Referer`; a body is not. That
// is a poor place for any credential and a worse one for this credential,
// which is single-use and grants credits: an unspent token sitting in a log
// is exactly the window that matters. v1 had this right and the change to a
// path segment was described as cosmetic, which it was not.
//
// The mailed link still carries the token in the *page* URL — pre-existing,
// and B1635 is the ticket for it. This route no longer adds a second copy.
//
// **This is the one HTTP path in the whole codebase that raises a balance**,
// beside the Stripe webhook. `test/credits.test.ts`'s `GRANT_ALLOWED` names
// this exact file; moving it is a path change to an entry already on that
// list, not an addition to it.
import { grant } from "@/lib/credits";
import { sendPurchaseReceipt } from "@/lib/credits/receipt";
import { claimApproval, getPayment } from "@/lib/payments";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/web/[user]/purchases/[id]/approve">,
) {
  const { user, id } = await params;
  const body = (await request.json().catch(() => null)) as { token?: unknown } | null;
  const token = typeof body?.token === "string" ? body.token : "";

  const journal = getUser(user);
  if (!journal) return Response.json({ error: "unknown_payment" }, { status: 404 });

  const limit = rateLimitFor("payment-approve", clientIp(request), { max: 10, windowMs: 60 * 1000 });
  if (!limit.ok) {
    return Response.json(
      { error: "too_many_requests", retryAfter: limit.retryAfter },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  if (!token) return Response.json({ error: "bad_token" }, { status: 400 });

  const claim = await claimApproval(user, id, token);
  if (!claim.ok) {
    if (claim.reason === "unknown") {
      return Response.json({ error: "unknown_payment" }, { status: 404 });
    }
    return Response.json({ error: claim.reason }, { status: 403 });
  }

  await grant(user, claim.credits, `purchase ${id}`);

  const payment = await getPayment(user, id);
  if (payment) await sendPurchaseReceipt(payment);

  return Response.json({ ok: true, status: "paid", creditsGranted: claim.credits });
}

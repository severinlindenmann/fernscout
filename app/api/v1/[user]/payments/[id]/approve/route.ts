import { grant } from "@/lib/credits";
import { formatChf } from "@/lib/credits/pricing";
import { sendTransactional } from "@/lib/mail";
import { renderMail } from "@/lib/mail/template";
import { claimApproval, getPayment } from "@/lib/payments";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/**
 * The operator approves a purchase, and that grants the credits — B425.
 *
 * **This is the one HTTP path in the whole codebase that raises a balance.**
 * B366 kept every request out of `grant`; this route is the deliberate,
 * documented exception, and `test/credits.test.ts` allows exactly this file to
 * import `grant` and fails the build if any other does. It is safe to grant
 * here only because:
 *
 *   1. The approval token was mailed to `site.operatorEmail` and to nobody
 *      else — never the buying journal's owner, who would otherwise approve
 *      their own purchase and mint free credits. This route trusts the token,
 *      not a session, exactly as the manage/delete links do.
 *   2. `claimApproval` is a single atomic conditional UPDATE, so the token can
 *      be spent once. Whatever races or repeats reach here, `grant` runs at
 *      most once per purchase.
 *
 * Between the claim and the `grant` is a crash window: if the process dies
 * after the row is marked paid+granted and before the credits land, the
 * purchase reads as done but the balance did not move. It fails **closed** (no
 * credits), and the recovery is the CLI (`npm run credits -- grant`), the same
 * shape as the publish pre-flight race. It never fails open.
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/v1/[user]/payments/[id]/approve">,
) {
  const { user, id } = await params;

  const journal = getUser(user);
  if (!journal) return Response.json({ error: "unknown_payment" }, { status: 404 });

  const limit = rateLimitFor("payment-approve", clientIp(request), { max: 10, windowMs: 60 * 1000 });
  if (!limit.ok) {
    return Response.json(
      { error: "too_many_requests", retryAfter: limit.retryAfter },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const token = typeof body.token === "string" ? body.token : "";
  if (!token) return Response.json({ error: "bad_token" }, { status: 400 });

  const claim = await claimApproval(user, id, token);
  if (!claim.ok) {
    // Unknown id, foreign id, not-a-request, or wrong/spent token — all one
    // answer, no oracle. A wrong token is the common case; 403 says "not yours
    // to approve" without revealing which of the reasons it was.
    const status = claim.reason === "unknown" ? 404 : 403;
    return Response.json({ error: claim.reason }, { status });
  }

  // The one grant. Recorded in the ledger with the payment id, so an operator
  // reconciling can tie a credit to its purchase.
  await grant(user, claim.credits, `purchase ${id}`);

  // Tell the buyer their credits landed. Best-effort — the grant already
  // happened, so a mail failure must not undo it or fail the approval.
  const payment = await getPayment(user, id);
  if (journal.owner.email && payment) {
    try {
      const mail = renderMail(
        journal.owner.email,
        `${claim.credits} credits added`,
        {
          preheader: `Your purchase was approved`,
          title: "Your credits are ready",
          blocks: [
            {
              kind: "paragraph",
              text: `Your purchase of ${claim.credits} credits (${formatChf(payment.amountRappen)}) has been approved and added to your balance.`,
            },
          ],
          footer: "Sent because a credit purchase on your journal was approved.",
        },
        user,
      );
      await sendTransactional(mail, "credit purchase approved");
    } catch {
      // The credits are added regardless; the receipt is a courtesy.
    }
  }

  return Response.json({ ok: true, status: "paid", creditsGranted: claim.credits });
}

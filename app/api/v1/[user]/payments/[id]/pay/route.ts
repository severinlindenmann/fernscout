import { formatChf } from "@/lib/credits/pricing";
import { sendTransactional } from "@/lib/mail";
import { renderMail } from "@/lib/mail/template";
import { getPayment, isPaymentMethod, markPaid } from "@/lib/payments";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/**
 * The mock "Pay now" button — B405.
 *
 * **It adds no credits, and it must never.** It flips a pending transaction to
 * `paid`, records whether TWINT or a card was chosen, and mails a receipt. That
 * is the whole of it. `grant()` in `lib/credits.ts` is still the only thing that
 * raises a balance, and it is still reachable only from a shell script — this
 * route does not import it, and `test/credits.test.ts` fails the build if any
 * file under `app/` does.
 *
 * When a real provider is wired in, the thing that grants will be a *verified
 * server-to-server webhook* from that provider — signature-checked, not a
 * browser POST — because a browser can claim anything. This route is the
 * browser POST, which is exactly why it is trusted with nothing but "show me a
 * receipt". Do not "finish" it by adding a grant here.
 *
 * **No session.** The transaction id is an unguessable token and is the whole
 * capability, the same shape as the manage and delete links: whoever the owner
 * forwarded the email to can pay it, and paying adds nothing, so there is
 * nothing here worth stealing. The URL's `<user>` must still match the row's
 * owner, so one journal's id cannot be driven under another's path.
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/v1/[user]/payments/[id]/pay">,
) {
  const { user, id } = await params;

  const journal = getUser(user);
  if (!journal) {
    return Response.json({ error: "unknown_payment" }, { status: 404 });
  }

  const limit = rateLimitFor("payment-pay", clientIp(request), {
    max: 10,
    windowMs: 60 * 1000,
  });
  if (!limit.ok) {
    return Response.json(
      { error: "too_many_requests", retryAfter: limit.retryAfter },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const method = body.method;
  if (!isPaymentMethod(method)) {
    return Response.json(
      {
        error: "bad_method",
        message: 'Choose how to pay: "twint" or "card".',
      },
      { status: 400 },
    );
  }

  const result = await markPaid(user, id, method);
  if (!result.ok) {
    // The same answer for an id that never existed as for one that belongs to
    // another journal — `getPayment` scopes by owner, so both arrive here as
    // "unknown", and neither reveals which.
    return Response.json({ error: "unknown_payment" }, { status: 404 });
  }

  // The receipt goes once, on the transition to paid. A re-followed link that
  // was already paid sends no second mail (and, the point, adds nothing).
  if (!result.alreadyPaid && journal.owner.email) {
    const { payment } = result;
    const mail = renderMail(
      journal.owner.email,
      `Payment recorded — ${formatChf(payment.amountRappen)}`,
      {
        preheader: `Transaction ${payment.id}`,
        title: "Payment recorded",
        blocks: [
          {
            kind: "paragraph",
            text: `We recorded a ${formatChf(payment.amountRappen)} payment for ${payment.credits} credits by ${method}. Transaction ${payment.id}.`,
          },
          {
            kind: "paragraph",
            // Never "credits added" — nothing was charged and nothing was
            // credited. This is a preview of the flow, not a purchase.
            text: "This instance is running a preview of the payment flow: no card was charged and no credits have been added to your balance yet.",
          },
        ],
        footer: `Sent because a payment was recorded for ${user}.`,
      },
      user,
    );
    await sendTransactional(mail, "payment receipt");
  }

  return Response.json({
    ok: true,
    status: result.payment.status,
    transactionId: result.payment.id,
    method: result.payment.method,
    alreadyPaid: result.alreadyPaid,
    // Stated in the response too, so no client can render "credits added".
    creditsAdded: 0,
  });
}

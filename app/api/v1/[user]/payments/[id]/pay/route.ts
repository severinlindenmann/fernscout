import { formatChf } from "@/lib/credits/pricing";
import { loadServerConfig } from "@/lib/config";
import { sendTransactional } from "@/lib/mail";
import { renderMail } from "@/lib/mail/template";
import { attachCheckoutSession, getPayment, isBuyerMethod, submitRequest } from "@/lib/payments";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { serverSite } from "@/lib/site";
import { createCheckoutSession, stripe, stripeEnabled } from "@/lib/stripe";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/**
 * "Pay now" — B425, and no longer a preview that records nothing.
 *
 * Since there is no payment provider yet, pressing Pay files a **request**:
 * `submitRequest` moves the transaction to `requested` and mints a single-use
 * approval token, and this route mails that token — as a link — to the
 * **instance operator** (`site.operatorEmail`) and to nobody else. The
 * operator opening the link and accepting is what grants the credits
 * (`.../approve`); this route grants nothing and imports no `grant`.
 *
 * **The recipient is the operator, never the journal owner.** An owner who
 * could approve their own purchase would mint free credits, so the approval
 * mail must never go to the buying journal's address. It goes to the one human
 * who runs the server and reconciles real money.
 *
 * No session: the payment id is the capability, mailed to the owner as the
 * checkout link — the same shape as the manage and delete links. The URL's
 * `<user>` must match the row, which `submitRequest`/`getPayment` enforce.
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/v1/[user]/payments/[id]/pay">,
) {
  const { user, id } = await params;

  const journal = getUser(user);
  if (!journal) return Response.json({ error: "unknown_payment" }, { status: 404 });

  const limit = rateLimitFor("payment-pay", clientIp(request), { max: 10, windowMs: 60 * 1000 });
  if (!limit.ok) {
    return Response.json(
      { error: "too_many_requests", retryAfter: limit.retryAfter },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  // --- The provider path, when one is configured (B792) -------------------
  //
  // Stripe's own page is where the buyer chooses between TWINT, a wallet and a
  // card, so the request's `method` is ignored here and the webhook records
  // what was actually used. No operator mail: nobody is being asked to approve
  // anything, and `.../approve` stays for the operator's own zero-franc grants
  // from /admin.
  //
  // A second press reuses the session the first press opened, if it is still
  // open — B831. Opening a fresh one each time let a distracted buyer end up
  // with two payable sessions for one row and pay both: charged twice,
  // credited once (the row grants at most once). `claimProviderPayment` still
  // backstops the grant, but money must not move twice, so at most one session
  // is payable at a time.
  if (stripeEnabled()) {
    const requested = await submitRequest(user, id, null);
    if (!requested.ok) return Response.json({ error: "unknown_payment" }, { status: 404 });
    const payment = requested.payment ?? (await getPayment(user, id));
    if (!payment) return Response.json({ error: "unknown_payment" }, { status: 404 });

    let url: string | null = null;

    // Reuse the last session if Stripe still says it is open (unpaid, not
    // expired). Any failure to look it up just falls through to a fresh one.
    if (payment.providerRef) {
      try {
        const prior = await stripe().checkout.sessions.retrieve(payment.providerRef);
        if (prior.status === "open" && prior.url) url = prior.url;
      } catch (error) {
        console.warn("[payments] could not reuse prior checkout session", error);
      }
    }

    if (!url) {
      try {
        const session = await createCheckoutSession(
          payment,
          { credits: payment.credits },
          user,
          serverSite().url,
          journal.defaultLocale,
          journal.owner.email || undefined,
          serverSite().name,
        );
        if (session) {
          url = session.url;
          await attachCheckoutSession(user, id, session.id);
        }
      } catch (error) {
        console.error("[payments] stripe checkout session failed", error);
      }
    }

    // A row left at `requested` with no session is the honest outcome of a
    // provider outage: nothing was charged, and pressing Pay again retries.
    if (!url) return Response.json({ error: "provider_unavailable" }, { status: 502 });

    return Response.json({
      ok: true,
      status: "requested",
      transactionId: id,
      url,
      creditsAdded: 0,
    });
  }

  // --- No provider: the operator approves by hand (B425) ------------------
  const method = body.method;
  // isBuyerMethod, not isPaymentMethod: "admin" is a real method but the
  // operator's own, and a buyer naming it would file a zero-franc purchase.
  if (!isBuyerMethod(method)) {
    return Response.json({ error: "bad_method", message: 'Choose "twint" or "card".' }, { status: 400 });
  }

  const result = await submitRequest(user, id, method);
  if (!result.ok) {
    // The same 404 for an unknown id, a foreign id, and a payment already paid
    // — none is a distinguishable oracle.
    return Response.json({ error: "unknown_payment" }, { status: 404 });
  }

  const operator = loadServerConfig().site.operatorEmail;

  // Mail the operator the approval link — but only for a fresh request (not a
  // re-submit of one already in the queue), and only if an operator address is
  // configured. With none, the request is on file and the CLI can fulfil it.
  if (!result.alreadyRequested && operator) {
    const base = serverSite().url;
    const approveUrl = `${base}/${user}/payment/${id}/approve/${result.token}`;
    const price = formatChf(result.payment.amountRappen);
    const mail = renderMail(
      operator,
      `Approve credit purchase — ${user} — ${price}`,
      {
        preheader: `${result.payment.credits} credits for ${user}`,
        title: "A credit purchase is waiting for you to approve",
        blocks: [
          {
            kind: "paragraph",
            text: `${user} asked to buy ${result.payment.credits} credits for ${price} by ${method}. There is no payment provider yet, so you approve it by hand.`,
          },
          {
            kind: "paragraph",
            text: "Open the link below and accept it to add the credits to their balance. The link works once.",
          },
          { kind: "button", text: "Review and approve", href: approveUrl },
        ],
        footer: "You are receiving this because you are the operator of this Fernscout instance.",
      },
      user,
    );
    await sendTransactional(mail, "credit purchase approval request");
  }

  return Response.json({
    ok: true,
    status: "requested",
    transactionId: id,
    // What the buyer is told — never that credits were added.
    approver: operator ?? null,
    creditsAdded: 0,
  });
}

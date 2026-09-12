// "Pay now" — B1622, phase 2 step 4 (money.md §2.4), moved unchanged from
// app/api/v1/[user]/payments/[id]/pay/route.ts. Credential is none: the
// purchase id, mailed as an unguessable link, is the whole capability —
// the same shape the delete-confirmation and handover links already use.
// Outside /api/v2 on purpose: this is not part of the agent contract, it is
// a page a browser opens with no cookie of its own.
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

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/web/[user]/purchases/[id]/pay">,
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
  if (stripeEnabled()) {
    const requested = await submitRequest(user, id, null);
    if (!requested.ok) return Response.json({ error: "unknown_payment" }, { status: 404 });
    const payment = requested.payment ?? (await getPayment(user, id));
    if (!payment) return Response.json({ error: "unknown_payment" }, { status: 404 });

    let url: string | null = null;

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
  if (!isBuyerMethod(method)) {
    return Response.json({ error: "bad_method", message: 'Choose "twint" or "card".' }, { status: 400 });
  }

  const result = await submitRequest(user, id, method);
  if (!result.ok) {
    return Response.json({ error: "unknown_payment" }, { status: 404 });
  }

  const operator = loadServerConfig().site.operatorEmail;

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
    approver: operator ?? null,
    creditsAdded: 0,
  });
}

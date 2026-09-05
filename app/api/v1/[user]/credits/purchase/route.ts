import { creditsEnabled } from "@/lib/credits";
import { createPayment } from "@/lib/payments";
import { formatChf, tierFor } from "@/lib/credits/pricing";
import { isOwner } from "@/lib/contacts/session";
import { sendTransactional } from "@/lib/mail";
import { renderMail } from "@/lib/mail/template";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { serverSite } from "@/lib/site";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/**
 * "Buy credits" — B368, the front half of a purchase with no payment
 * provider behind it yet.
 *
 * **This route grants nothing.** It does not import `grant` from
 * `lib/credits.ts`, does not touch `credits.balance`, and writes no ledger
 * row — `test/credits.test.ts` asserts that nothing under `app/` imports
 * `grant`, and this is the route most likely to have broken that. All it
 * does is record a **pending** transaction (`lib/payments.ts`) and mail the
 * journal's own owner a link to its payment page (`/<user>/payment/<id>`) —
 * B405. Paying there is a mock that adds nothing either; a real provider's
 * verified webhook is the only future thing that will grant.
 *
 * **The recipient is `journal.owner.email`, never a value from the request
 * body.** A request that named a different address would be a way to make
 * this server mail somebody who never asked for anything.
 *
 * Owner-only, by the same `isOwner` gate every other owner-only route in
 * this codebase uses (B240 is open on owner-gate bugs; this does not invent
 * a narrower or wider one). The mail is transactional — it is addressed to
 * the owner about their own account, at their own request — so it goes
 * through `sendTransactional` rather than `sendMail`: it must not be
 * suppressible by a journal's own mail switch, and it must never spend a
 * credit to send.
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/v1/[user]/credits/purchase">,
) {
  const { user } = await params;

  const journal = getUser(user);
  if (!journal || !creditsEnabled()) {
    return Response.json(
      {
        error: "credits_disabled",
        message: "This server does not charge for sends, so there is nothing to buy.",
      },
      { status: 404 },
    );
  }

  if (!(await isOwner(user, request))) {
    return Response.json(
      {
        error: "forbidden",
        message:
          "Only the address that owns this journal may ask for more credits — not a guest, " +
          "and not a token scoped to one of its trips.",
      },
      { status: 403 },
    );
  }

  // Authenticated and owner-only, so this is about a stuck client looping
  // rather than an attacker enumerating anything — one purchase mail a
  // minute is generous. Same bucket shape `/api/auth/request` uses.
  const limit = rateLimitFor("credits-purchase", clientIp(request), {
    max: 5,
    windowMs: 60 * 1000,
  });
  if (!limit.ok) {
    return Response.json(
      { error: "too_many_requests", retryAfter: limit.retryAfter },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const tierId =
    typeof body.tier === "string"
      ? body.tier
      : typeof body.tier === "number"
        ? String(body.tier)
        : "";
  const tier = tierFor(tierId);
  if (!tier) {
    return Response.json(
      {
        error: "unknown_tier",
        message: `"${tierId || "(none)"}" is not one of the tiers this journal offers.`,
      },
      { status: 400 },
    );
  }

  const to = journal.owner.email;
  if (!to) {
    return Response.json({ error: "no_owner_address" }, { status: 409 });
  }

  // Record the pending transaction. Amount and credits are the tier's, never
  // a body value — see `createPayment`.
  const payment = await createPayment(user, tier);
  if (!payment) {
    return Response.json(
      { error: "no_database", message: "This server cannot record a transaction." },
      { status: 503 },
    );
  }

  const base = serverSite().url;
  const payUrl = `${base}/${user}/payment/${payment.id}`;
  const price = formatChf(tier.priceRappen);
  const discount = tier.discount ? ` (${tier.discount} off the per-credit price)` : "";

  // The same link the browser is sent to, so it can be finished from a phone
  // later — the email is the "come back to it" half of the flow.
  const mail = renderMail(
    to,
    `Your credit purchase — ${price}`,
    {
      preheader: `${tier.credits} credits for ${price}${discount}`,
      title: "Finish your credit purchase",
      blocks: [
        {
          kind: "paragraph",
          text: `${tier.credits} credits for ${price}${discount}, started from your own page. Transaction ${payment.id}.`,
        },
        {
          kind: "paragraph",
          text: "Open the link below to choose how to pay. You can do it now or come back to the same link later — it shows where the transaction stands.",
        },
        { kind: "button", text: "Go to payment", href: payUrl },
      ],
      footer: `Sent because ${user}'s own page started this purchase.`,
    },
    user,
  );

  await sendTransactional(mail, "credit purchase inquiry");

  return Response.json({
    ok: true,
    transactionId: payment.id,
    paymentUrl: `/${user}/payment/${payment.id}`,
    tier: tier.id,
    credits: tier.credits,
    priceRappen: tier.priceRappen,
    mailedTo: to,
  });
}

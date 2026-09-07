import type Stripe from "stripe";
import { grant } from "@/lib/credits";
import { sendPurchaseReceipt } from "@/lib/credits/receipt";
import { claimProviderPayment, getPayment } from "@/lib/payments";
import { stripe, stripeEnabled, stripeMode, webhookSecret } from "@/lib/stripe";
import { getUser } from "@/lib/users";

// Stripe's signature is computed over the exact bytes it sent, so nothing may
// re-encode this body — and `constructEvent` needs node crypto.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stripe tells us a purchase was paid — B792.
 *
 * **This is the second HTTP path in the codebase that raises a balance**, and
 * `test/credits.test.ts` names it in `GRANT_ALLOWED` alongside the operator
 * approval route. It earns that the same way the other two do: a credential
 * this server verified, and a claim that can be spent only once.
 *
 *   1. **The signature is the whole authentication.** `constructEvent` checks
 *      an HMAC over the raw bytes against `STRIPE_WEBHOOK_SECRET`, inside a
 *      replay window. There is no session, no bearer token and no owner
 *      argument to trust; a body somebody posts by hand fails here and grants
 *      nothing. This route lives outside `/api/v1` for exactly that reason —
 *      the caller is Stripe, not a person and not an agent.
 *   2. **The row decides the amount, not the event.** The credits come from
 *      our own `payments` row, and `claimProviderPayment` refuses when the
 *      session's total does not match it.
 *   3. **`claimProviderPayment` is one conditional UPDATE.** Stripe delivers
 *      at least once and retries anything that is not a 2xx, so a repeat is
 *      normal traffic rather than an attack — and the claim is what makes it
 *      free.
 *
 * Between the claim and the `grant` is the same crash window the approval
 * route documents: the purchase would read as settled with the balance
 * unmoved. It fails **closed**, and the recovery is `npm run credits -- grant`.
 *
 * A 500 is a request for a retry, so anything that might succeed later (the
 * database being down) answers 500, and anything that never will (an event for
 * a journal that no longer exists) answers 200 — otherwise Stripe retries it
 * for three days.
 */
export async function POST(request: Request) {
  if (!stripeEnabled()) {
    // Nothing here is reachable on an instance with no provider. Not a 404 for
    // secrecy — the endpoint is not a secret — but because there is genuinely
    // no such route on this deployment.
    return new Response("no payment provider is configured", { status: 404 });
  }

  const signature = request.headers.get("stripe-signature");
  const raw = await request.text();
  if (!signature) return new Response("missing signature", { status: 400 });

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(raw, signature, webhookSecret());
  } catch (error) {
    console.warn("[stripe] rejected a webhook:", (error as Error).message);
    return new Response("bad signature", { status: 400 });
  }

  // The event's mode must match the key's — B830. `whsec_…` encodes no mode,
  // so a live key paired with a test webhook secret (or the reverse) passes
  // signature verification while every real event is for the wrong world.
  // That is a deploy slip that otherwise shows up only as buyers charged with
  // no credits, silently, until someone notices — so it is loud, and it is a
  // 400 rather than a swallowed 200, because Stripe retrying is the least of
  // the operator's problems here.
  const expectLive = stripeMode() === "live";
  if (event.livemode !== expectLive) {
    console.error(
      `[stripe] MODE MISMATCH: event.livemode=${event.livemode} but the key is ${expectLive ? "live" : "test"}. ` +
        "The secret key and the webhook signing secret are not the same mode — fix the deployment.",
    );
    return new Response("mode mismatch between key and event", { status: 400 });
  }

  // Everything else Stripe may be configured to send is acknowledged and
  // ignored, so a dashboard endpoint subscribed to more than one event does
  // not accumulate failures.
  if (event.type !== "checkout.session.completed") {
    return Response.json({ ok: true, ignored: event.type });
  }

  const session = event.data.object;
  if (session.payment_status !== "paid") {
    // `checkout.session.completed` also fires for asynchronous methods that
    // have not settled yet. Those arrive again as `async_payment_succeeded`,
    // which this route does not subscribe to — so nothing is granted until
    // somebody adds that case, which is the safe direction to be wrong in.
    return Response.json({ ok: true, ignored: "unpaid" });
  }

  // The amount is checked against the row as a bare integer, so the currency
  // has to be pinned too — B830. Every session this server creates is `chf`
  // (lib/stripe.ts), so a paid session in any other currency is not one of
  // ours to honour: 1000 of a non-rappen minor unit is not CHF 10.00.
  if (session.currency !== "chf") {
    console.warn(`[stripe] ignoring a paid session in ${session.currency}, not chf:`, session.id);
    return Response.json({ ok: true, ignored: "currency" });
  }

  const owner = session.metadata?.owner;
  const paymentId = session.metadata?.paymentId ?? session.client_reference_id;
  if (!owner || !paymentId) {
    console.warn("[stripe] a paid session carried no payment reference:", session.id);
    return Response.json({ ok: true, ignored: "no_reference" });
  }
  if (!getUser(owner)) return Response.json({ ok: true, ignored: "unknown_journal" });

  // What the buyer actually reached for, for the transaction list — B803.
  //
  // Not `session.payment_method_types`: that is what the session *offered*, and
  // we always offer two, so reading it left every purchase with no method at
  // all. The payment intent knows which one was used, and it is the
  // authoritative answer rather than an inference. Best-effort — this is a
  // label on a transaction, and losing it must never cost somebody their
  // credits, so a failed lookup leaves it null and carries on.
  //
  // Still checked against the two we offer rather than the whole vocabulary:
  // "admin" is a real `PaymentMethod` and is the operator's own, so a session
  // must never be able to name it.
  let method: "card" | "twint" | null = null;
  try {
    const full = await stripe().checkout.sessions.retrieve(session.id, {
      expand: ["payment_intent.payment_method"],
    });
    const intent = full.payment_intent;
    const used: string | undefined =
      intent && typeof intent !== "string" && typeof intent.payment_method !== "string"
        ? intent.payment_method?.type
        : undefined;
    if (used === "card" || used === "twint") method = used;
  } catch (error) {
    console.warn("[stripe] could not read the method used on", session.id, error);
  }

  let claim;
  try {
    claim = await claimProviderPayment(owner, paymentId, session.amount_total ?? -1, method);
  } catch (error) {
    // A database that is down is a retry, not a lost purchase.
    console.error("[stripe] could not claim a paid session:", error);
    return new Response("could not record the payment", { status: 500 });
  }

  if (!claim.ok) {
    if (claim.reason === "not_requested") {
      // The row was already settled — a retried delivery, almost always, and
      // then this is nothing. But it is ALSO what a second paid session for the
      // same row looks like: a buyer charged twice, credited once (B831). We
      // cannot tell the two apart from here, so we say so with the session id,
      // at warn, rather than swallowing it — reconciliation happens in the
      // Stripe dashboard, and this is the thread to pull.
      console.warn(
        `[stripe] paid session ${session.id} claimed nothing for payment ${paymentId} (already settled). ` +
          "If this is a distinct session id from the one that granted, the buyer paid twice — reconcile in Stripe.",
      );
    }
    if (claim.reason === "amount_mismatch") {
      // Never retryable, and worth shouting about: a paid session naming one
      // of our rows for a different amount is either a bug in the session we
      // created or somebody's attempt at one.
      console.error(
        `[stripe] session ${session.id} paid ${session.amount_total} against payment ${paymentId}, which is for a different amount`,
      );
    }
    // Already granted, or nothing to grant. Acknowledged: retrying changes
    // nothing.
    return Response.json({ ok: true, ignored: claim.reason });
  }

  try {
    await grant(owner, claim.credits, `purchase ${paymentId} stripe ${session.id}`);
  } catch (error) {
    // The row is already marked paid and granted, so a retry will not grant
    // again — this is the documented fail-closed window, and it needs a human
    // and `npm run credits -- grant`.
    console.error(
      `[stripe] CREDITS NOT GRANTED for ${owner} payment ${paymentId} (${claim.credits} credits) — grant by hand:`,
      error,
    );
    return new Response("could not grant", { status: 500 });
  }

  // What they paid for, in their inbox — B866. After the grant and outside its
  // try: a receipt that could fail the webhook would have Stripe redeliver a
  // session whose credits have already landed.
  const payment = await getPayment(owner, paymentId);
  if (payment) await sendPurchaseReceipt(payment);

  return Response.json({ ok: true, granted: claim.credits });
}

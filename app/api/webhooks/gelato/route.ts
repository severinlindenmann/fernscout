import crypto from "node:crypto";
import { ORDER_ID_RE, findSubmittedPrint } from "@/lib/photobook/orders";
import { isTerminalFailure, settleRefusedPrint } from "@/lib/photobook/reconcile";

export const dynamic = "force-dynamic";

/**
 * `POST /api/webhooks/gelato` — the printer telling us what became of an
 * order, instead of us asking every five minutes — B1345.
 *
 * Gelato accepts a create immediately and decides separately whether it will
 * actually print, and the two were measured 62 seconds apart on this instance
 * (B1336). The sweep closes that gap on a timer; this closes it in the moment,
 * which is the difference between somebody being refunded while they are still
 * looking at the page and being refunded after they have gone to bed.
 *
 * ## Its own security, because Gelato provides none
 *
 * **There is no signature.** Stripe signs its webhooks and
 * `app/api/webhooks/stripe/route.ts` verifies that signature over the raw
 * body; Gelato does not sign at all. What it offers instead is a custom
 * header of your choosing, sent with every delivery — so the header *is* the
 * credential, and everything follows from that:
 *
 * - **No secret, no route.** With `GELATO_WEBHOOK_SECRET` unset this answers
 *   404 for everybody, the way a capability that is off is absent rather than
 *   broken. An open endpoint that refunds orders is not a thing to leave
 *   lying around while somebody gets round to configuring it.
 * - **Compared in constant time**, and length-padded first, because
 *   `timingSafeEqual` throws on a length mismatch and that throw is itself an
 *   oracle for the secret's length.
 * - **404 rather than 401** on a bad secret. A 401 tells whoever is knocking
 *   that they found the right address.
 *
 * ## What it will and will not do
 *
 * It settles **terminal failures only** — an order that is never going to be
 * printed. Every other status Gelato sends, now or in a year, is an
 * acknowledged no-op: `created`, `passed`, `in_production`, `printed`,
 * `shipped`. A webhook is not a licence to act on a word we have not thought
 * about, and refunding on one would be giving money back for a book that is
 * in the post.
 *
 * It is safe to receive twice. Gelato retries what it thinks failed, and the
 * sweep may reach the same order first; `settleRefusedPrint` re-reads the row
 * and only settles one out of `print_submitted`, so the second delivery
 * refunds nothing.
 *
 * **Always 200, once the caller is authentic.** A webhook that answers 500
 * gets retried for hours, and none of the reasons we might not act — an order
 * we do not know, a status we ignore, one already settled — is a reason for
 * Gelato to try again.
 */

/** The header Gelato is configured to send. Named for us, not for them. */
const SECRET_HEADER = "x-fernscout-webhook";

function authentic(request: Request, secret: string): boolean {
  const offered = request.headers.get(SECRET_HEADER) ?? "";
  // Hash both sides to a fixed width first: `timingSafeEqual` requires equal
  // lengths and throws otherwise, which would leak the length of the secret.
  const a = crypto.createHash("sha256").update(offered).digest();
  const b = crypto.createHash("sha256").update(secret).digest();
  return crypto.timingSafeEqual(a, b);
}

type Body = {
  event?: unknown;
  orderReferenceId?: unknown;
  fulfillmentStatus?: unknown;
};

export async function POST(request: Request) {
  const secret = process.env.GELATO_WEBHOOK_SECRET?.trim();
  if (!secret) return new Response("Not found", { status: 404 });
  if (!authentic(request, secret)) return new Response("Not found", { status: 404 });

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    // Malformed and unretryable. Saying so with a 400 is honest; Gelato does
    // not retry these and should not.
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  // Only the order-level event carries the status this acts on. The
  // item-level one (`order_item_status_updated`) describes a line rather than
  // the order, and a one-item photobook order would otherwise be settled
  // twice for the same news.
  if (body.event !== "order_status_updated") {
    return Response.json({ ok: true, ignored: "event" });
  }

  const reference = typeof body.orderReferenceId === "string" ? body.orderReferenceId : "";
  const status = typeof body.fulfillmentStatus === "string" ? body.fulfillmentStatus : "";
  // `ORDER_ID_RE` before the id reaches a query, the same boundary check every
  // other route that takes one applies.
  if (!ORDER_ID_RE.test(reference) || !status) {
    return Response.json({ ok: true, ignored: "reference" });
  }
  if (!isTerminalFailure(status)) {
    return Response.json({ ok: true, ignored: "status", status });
  }

  const found = await findSubmittedPrint(reference);
  // Not ours, already settled, or a postcard: nothing to do and nothing wrong.
  if (!found) return Response.json({ ok: true, ignored: "unknown_order" });

  const settled = await settleRefusedPrint(found.owner, found.id, status);
  return Response.json({ ok: true, settled });
}

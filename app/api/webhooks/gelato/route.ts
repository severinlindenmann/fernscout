import crypto from "node:crypto";
import { ORDER_ID_RE, findSubmittedPrint, recordTracking } from "@/lib/photobook/orders";
import { isTerminalFailure, settleRefusedPrint } from "@/lib/photobook/reconcile";
import { sendPhotobookShipped } from "@/lib/photobook/receipt";
import { getTrip } from "@/lib/trips";

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
 * It settles **terminal failures**, exactly as before — an order that is
 * never going to be printed, money back and the owner told. Since B1440 it
 * also acts on **`shipped`** and on the dedicated tracking-code event: it
 * stores every parcel Gelato reports (an item can ship in more than one) and
 * sends the owner one mail, the first time an order is ever marked shipped.
 * Every other status Gelato sends, now or in a year — `created`, `passed`,
 * `in_production`, `printed` among them — is still an acknowledged no-op: the
 * order page already asks Gelato directly for its current status on every
 * render, so there is nothing here for those words to move. A webhook is not
 * a licence to act on a word we have not thought about, and refunding on one
 * would be giving money back for a book that is in the post.
 *
 * It is safe to receive twice. Gelato retries what it thinks failed, and the
 * sweep may reach the same order first; `settleRefusedPrint` re-reads the row
 * and only settles one out of `print_submitted`, so the second delivery
 * refunds nothing. `recordTracking` does the same for a shipped order — it
 * merges tracking by a compare-and-swap on the stored payload rather than a
 * status transition (`status` deliberately stays `print_submitted` — see
 * B1440), so a retried `shipped` event finds the mail already sent and sends
 * no second one.
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

type Fulfillment = {
  trackingCode?: unknown;
  trackingUrl?: unknown;
  shipmentMethodName?: unknown;
};

type Item = { fulfillments?: Fulfillment[] };

type Body = {
  event?: unknown;
  orderReferenceId?: unknown;
  fulfillmentStatus?: unknown;
  /** `order_status_updated` only — one item, but the real payload carries an
   *  array, and B1440's example has two fulfillments on it. */
  items?: Item[];
  /** `order_item_tracking_code_updated` only — the same three fields, but at
   *  the top level rather than nested under `items[].fulfillments[]`. */
  trackingCode?: unknown;
  trackingUrl?: unknown;
  shipmentMethodName?: unknown;
};

/** A `Fulfillment`, or the top-level tracking fields of a tracking-code
 *  event, turned into the shape `recordTracking` stores — B1440. Skips an
 *  entry with no code: nothing to store and nothing to link to. */
function trackingFrom(entries: Fulfillment[]): { code: string; url?: string; carrier?: string }[] {
  return entries.flatMap((f) => {
    const code = typeof f.trackingCode === "string" ? f.trackingCode : "";
    if (!code) return [];
    const url = typeof f.trackingUrl === "string" ? f.trackingUrl : undefined;
    const carrier = typeof f.shipmentMethodName === "string" ? f.shipmentMethodName : undefined;
    return [{ code, ...(url ? { url } : {}), ...(carrier ? { carrier } : {}) }];
  });
}

export async function POST(request: Request) {
  const secret = process.env.GELATO_WEBHOOK_SECRET?.trim();
  if (!secret) {
    console.warn("[gelato] webhook delivery refused: GELATO_WEBHOOK_SECRET is not set");
    return new Response("Not found", { status: 404 });
  }
  if (!authentic(request, secret)) {
    /**
     * Say so — B1349.
     *
     * A refused delivery and an accepted one are the same line in the request
     * log, so a webhook configured with the wrong header 404s for ever and
     * looks exactly like one that is working. That is the shape of silence
     * this codebase keeps having to fix, and the cost here is that a refused
     * print is settled five minutes late instead of at once, without anybody
     * knowing why.
     *
     * Whether a header arrived at all is the difference between "Gelato is
     * not configured to send one" and "the value is wrong", which are
     * different things to go and fix. Neither the offered value nor the real
     * one is logged: journald is not where a credential belongs.
     */
    const offered = request.headers.get(SECRET_HEADER);
    console.warn(
      `[gelato] webhook delivery refused: ${
        offered === null
          ? `no ${SECRET_HEADER} header — check the authorization settings on the webhook`
          : `${SECRET_HEADER} does not match GELATO_WEBHOOK_SECRET`
      }`,
    );
    return new Response("Not found", { status: 404 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    // Malformed and unretryable. Saying so with a 400 is honest; Gelato does
    // not retry these and should not.
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  /**
   * One line per accepted delivery — B1349.
   *
   * The other half of the same silence. Most deliveries are correctly ignored
   * — a status we do not act on, an order that is not ours — and if only the
   * acted-on ones were logged, a person wiring this up would have no way to
   * see it working short of breaking an order on purpose. This is what turns
   * "did Gelato reach us?" into a question with an answer.
   *
   * The event and the status, and nothing from the body beyond them: the rest
   * is somebody's shipping address.
   */
  console.info(
    `[gelato] webhook accepted: event=${String(body.event)} status=${String(body.fulfillmentStatus ?? "-")}`,
  );

  // The two events this acts on both carry `orderReferenceId`, our own order
  // id. `order_item_status_updated` — the item-level preflight/production
  // step — adds nothing a one-item photobook order does not already say
  // through `order_status_updated`, so it is deliberately never subscribed to
  // rather than merely ignored here (B1440).
  if (body.event !== "order_status_updated" && body.event !== "order_item_tracking_code_updated") {
    return Response.json({ ok: true, ignored: "event" });
  }

  const reference = typeof body.orderReferenceId === "string" ? body.orderReferenceId : "";
  // `ORDER_ID_RE` before the id reaches a query, the same boundary check every
  // other route that takes one applies.
  if (!ORDER_ID_RE.test(reference)) {
    return Response.json({ ok: true, ignored: "reference" });
  }

  if (body.event === "order_item_tracking_code_updated") {
    // The dedicated tracking event — B1440. Stored, never mailed on its own:
    // the one mail this route sends is tied to `shipped`, below, and a retry
    // of this event must not send it twice either, so `shipped` is always
    // `false` here regardless of what `recordTracking` finds already stored.
    const tracking = trackingFrom([
      { trackingCode: body.trackingCode, trackingUrl: body.trackingUrl, shipmentMethodName: body.shipmentMethodName },
    ]);
    if (tracking.length === 0) return Response.json({ ok: true, ignored: "no_tracking" });
    const found = await findSubmittedPrint(reference);
    if (!found) return Response.json({ ok: true, ignored: "unknown_order" });
    const result = await recordTracking(found.owner, found.id, tracking, false);
    return Response.json({ ok: true, stored: result !== null });
  }

  const status = typeof body.fulfillmentStatus === "string" ? body.fulfillmentStatus : "";
  if (!status) return Response.json({ ok: true, ignored: "reference" });

  if (isTerminalFailure(status)) {
    const found = await findSubmittedPrint(reference);
    // Not ours, already settled, or a postcard: nothing to do and nothing wrong.
    if (!found) return Response.json({ ok: true, ignored: "unknown_order" });
    const settled = await settleRefusedPrint(found.owner, found.id, status);
    return Response.json({ ok: true, settled });
  }

  if (status !== "shipped") {
    // `created`, `passed`, `in_production`, `printed`: the order page already
    // asks Gelato directly on every render, so there is nothing to store.
    return Response.json({ ok: true, ignored: "status", status });
  }

  // `shipped` — B1440. Every fulfillment across every item, because a book
  // can ship in more than one parcel (the observed payload has two).
  const tracking = trackingFrom((body.items ?? []).flatMap((item) => item.fulfillments ?? []));
  const found = await findSubmittedPrint(reference);
  if (!found) return Response.json({ ok: true, ignored: "unknown_order" });

  const result = await recordTracking(found.owner, found.id, tracking, true);
  if (result?.sendMail) {
    const tripTitle = getTrip(result.payload.trip)?.title ?? result.payload.trip;
    await sendPhotobookShipped({
      owner: found.owner,
      orderId: found.id,
      tripTitle,
      tracking: result.payload.print?.tracking ?? tracking,
    });
  }
  return Response.json({ ok: true, shipped: result !== null, mailed: Boolean(result?.sendMail) });
}

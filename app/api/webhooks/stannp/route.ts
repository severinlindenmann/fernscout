import crypto from "node:crypto";
import { recordProviderCancellation } from "@/lib/postcard/orders";

export const dynamic = "force-dynamic";

/**
 * `POST /api/webhooks/stannp` — Stannp telling us one card it already
 * accepted will never be posted, instead of this instance never finding out
 * — B1484.
 *
 * Every other print/message provider in this codebase has an inbound
 * webhook (`app/api/webhooks/gelato/route.ts`, `.../stripe`, `.../twilio`,
 * `.../whatsapp`); Stannp did not, and a card cancelled after acceptance —
 * a bad address caught downstream, the same 62-second-later gap Gelato's
 * own webhook closes for photobook — had no way to be known here at all.
 *
 * ## Its own security, unlike Gelato's
 *
 * Stannp *does* sign: `X-Stannp-Signature` is an HMAC-SHA256 of the raw
 * body, keyed on the secret set when the webhook was created in Stannp's own
 * dashboard. (`app/api/webhooks/gelato/route.ts`'s module comment says
 * Gelato provides no signature at all — that document is about Gelato, not
 * a general rule; do not copy its bare-header-compare shape here.)
 *
 * - **No secret, no route.** With `STANNP_WEBHOOK_SECRET` unset this answers
 *   404 for everybody — a capability that is off is absent, not broken.
 * - **Compared in constant time**, both sides hashed to a fixed width first
 *   for the same reason Gelato's route does: `timingSafeEqual` throws on a
 *   length mismatch, and that throw is itself an oracle for the length of
 *   whichever side is shorter.
 * - **404 rather than 401** on a bad signature — a 401 tells whoever is
 *   knocking that they found the right address.
 *
 * ## What it will and will not do
 *
 * It only ever writes `"cancelled"`, and only onto the one matching card's
 * own `RecipientResult.providerStatus` (`lib/postcard/orders.ts`) —
 * additive, never touching `ok` or the order's `built`/`failed` status,
 * both of which still mean exactly what they always have: the printer
 * accepted the card. Every other status Stannp reports (`printing`,
 * `dispatched`, `local_delivery`, `delivered`, `returned`) is acknowledged
 * and dropped, on purpose: `app/api/v1/[user]/postcards/[id]/route.ts`'s own
 * module comment already decided this system will never know whether a card
 * was delivered, and recording delivery status here would quietly
 * contradict that decision instead of extending it.
 *
 * **Not built here:** refunding the credit a cancelled card cost, or
 * telling the owner. See B1532.
 *
 * **Always 200, once the caller is authentic.** A webhook that answers 500
 * gets retried for hours, and neither an order this instance does not know
 * nor a status it deliberately ignores is a reason for Stannp to try again.
 */

const SIGNATURE_HEADER = "x-stannp-signature";

function authentic(rawBody: string, signature: string, secret: string): boolean {
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest();
  const offered = Buffer.from(signature, "hex");
  // Hash both sides to a fixed width first — `timingSafeEqual` requires
  // equal-length buffers and throws otherwise, which would leak whether the
  // offered signature is even the right length before comparing it at all.
  const a = crypto.createHash("sha256").update(expected).digest();
  const b = crypto.createHash("sha256").update(offered).digest();
  return crypto.timingSafeEqual(a, b);
}

type Mailpiece = { id?: unknown; status?: unknown };

type Body = {
  event?: unknown;
  mailpieces?: Mailpiece[];
};

export async function POST(request: Request) {
  const secret = process.env.STANNP_WEBHOOK_SECRET?.trim();
  if (!secret) {
    console.warn("[stannp] webhook delivery refused: STANNP_WEBHOOK_SECRET is not set");
    return new Response("Not found", { status: 404 });
  }

  const raw = await request.text();
  const signature = request.headers.get(SIGNATURE_HEADER);
  if (!signature || !authentic(raw, signature, secret)) {
    console.warn(
      `[stannp] webhook delivery refused: ${
        signature === null
          ? `no ${SIGNATURE_HEADER} header — check the webhook's signing secret in Stannp's dashboard`
          : `${SIGNATURE_HEADER} does not match STANNP_WEBHOOK_SECRET`
      }`,
    );
    return new Response("Not found", { status: 404 });
  }

  let body: Body;
  try {
    body = JSON.parse(raw) as Body;
  } catch {
    // Malformed and unretryable — Stannp does not retry these and should not.
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  if (body.event !== "mailpiece_status") {
    return Response.json({ ok: true, ignored: "event" });
  }

  const mailpieces = Array.isArray(body.mailpieces) ? body.mailpieces : [];
  let cancelled = 0;
  let ignored = 0;
  for (const piece of mailpieces) {
    const status = typeof piece.status === "string" ? piece.status : "";
    if (status !== "cancelled") {
      // `printing`, `dispatched`, `local_delivery`, `delivered`, `returned`:
      // acknowledged, never stored — see the module comment.
      ignored += 1;
      continue;
    }
    const id = typeof piece.id === "number" || typeof piece.id === "string" ? String(piece.id) : "";
    if (!id) {
      ignored += 1;
      continue;
    }
    // Either mode's `ref` — a test render and a live send report the same
    // event shape, and this route has no way to tell which the id belongs
    // to except by trying both.
    const done =
      (await recordProviderCancellation(`stannp:${id}`)) || (await recordProviderCancellation(`stannp-test:${id}`));
    if (done) cancelled += 1;
    else ignored += 1;
  }

  // One line per accepted delivery, the same reasoning
  // `app/api/webhooks/gelato/route.ts` gives its own: most deliveries are
  // correctly ignored, and if only the acted-on ones were logged, wiring
  // this up would have no way to see it working short of cancelling a real
  // card on purpose.
  console.info(`[stannp] webhook accepted: mailpieces=${mailpieces.length} cancelled=${cancelled} ignored=${ignored}`);

  return Response.json({ ok: true, cancelled, ignored });
}

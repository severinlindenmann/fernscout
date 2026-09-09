import { isEnabled } from "@/lib/capabilities";
import { fingerprintOf, idempotencyKey, recall, remember } from "@/lib/idempotency";
import { NO_JOURNAL } from "@/lib/auth";
import { rateLimitFor } from "@/lib/rateLimit";
import { handleInboundMessage } from "@/lib/whatsapp/dispatch";
import { parseInboundMessages, verifyWebhookSignature } from "@/lib/whatsapp/inbound";
import { maskNumber } from "@/lib/whatsapp/index";

// The signature is computed over the exact bytes Meta sent, so nothing may
// re-encode this body before it is checked — the Stripe webhook's own
// discipline (app/api/webhooks/stripe/route.ts), copied here.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Reading WhatsApp — B1057.
 *
 * Until now `lib/whatsapp/` only ever sent. The number this instance owns
 * could be written to by anybody and answered nothing — B386 is the wont-do
 * that recorded the harm: a footer promised "STOPP zum Abbestellen" over a
 * channel where nothing read a reply. This route is what makes that promise
 * true, and everything downstream of it (onboarding by chat, a day from a
 * phone) needs this one route to exist first.
 *
 * Meta expects a prompt 200 and retries what it does not get, "with
 * decreasing frequency for up to seven days" — so this answers fast and does
 * only cheap, synchronous work: verify, dedupe, rate-limit, normalise, hand
 * off. Nothing here calls a model or spends money; see B1058 for what
 * `handleInboundMessage` becomes.
 */

function verifyToken(): string | undefined {
  return process.env.WHATSAPP_VERIFY_TOKEN;
}

function appSecret(): string | undefined {
  return process.env.WHATSAPP_APP_SECRET;
}

/** Meta's `hub.challenge` handshake, made once when a webhook URL is
 * registered in the Meta developer console. */
export async function GET(request: Request) {
  if (!isEnabled("whatsappInbound")) {
    return new Response("this server does not read WhatsApp", { status: 404 });
  }
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode !== "subscribe" || !token || token !== verifyToken() || !challenge) {
    return new Response("verification failed", { status: 403 });
  }
  // Plain text, not JSON-wrapped — Meta reads the raw body as the answer.
  return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
}

/** One event delivery. May carry several messages, from one conversation or
 * several at once. */
export async function POST(request: Request) {
  if (!isEnabled("whatsappInbound")) {
    return new Response("this server does not read WhatsApp", { status: 404 });
  }

  const signature = request.headers.get("x-hub-signature-256");
  // Read before anything parses it — re-serialising the parsed object
  // changes whitespace and key order, and the signature would no longer
  // match. See lib/whatsapp/inbound.ts:verifyWebhookSignature.
  const raw = await request.text();
  const secret = appSecret();
  if (!secret || !verifyWebhookSignature(raw, signature, secret)) {
    return new Response("bad signature", { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    // Malformed JSON from a signed sender should not happen; answer 200 so
    // Meta does not retry something that will never parse.
    return Response.json({ ok: true, ignored: "unparseable" });
  }

  const messages = parseInboundMessages(body);

  for (const message of messages) {
    /**
     * Keyed on the sender's E.164, never on the caller's IP — every webhook
     * arrives from Meta, one IP for the whole world, so an IP-keyed limit
     * would throttle every sender at once the moment traffic is real. This
     * is the single most important line in this route.
     */
    const limit = rateLimitFor("whatsapp-inbound", message.from, {
      max: 30,
      windowMs: 5 * 60 * 1000,
    });
    if (!limit.ok) {
      console.warn(`[whatsapp:inbound] rate-limited ${maskNumber(message.from)}`);
      continue;
    }

    // Meta retries a non-200, and states plainly that retries "can result in
    // duplicate webhook notifications" — the wamid is stable across a retry.
    const key = idempotencyKey(NO_JOURNAL, "whatsapp-webhook", message.id);
    const fingerprint = fingerprintOf({ wamid: message.id });
    const seen = await recall<{ handled: true }>(key, fingerprint);
    if (seen.kind !== "fresh") continue;

    try {
      await handleInboundMessage(message);
      await remember(key, fingerprint, { handled: true });
    } catch (err) {
      // Not remembered on failure — a genuine processing error should be
      // retried by Meta's own backoff, not silently swallowed forever.
      console.error(`[whatsapp:inbound] failed to handle ${message.id}:`, err);
    }
  }

  return Response.json({ ok: true, received: messages.length });
}

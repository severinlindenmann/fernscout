import crypto from "node:crypto";
import { isEnabled } from "@/lib/capabilities";
import { loadServerConfig } from "@/lib/config";
import { rateLimitFor } from "@/lib/rateLimit";
import { recordSms } from "@/lib/sms/store";
import { maskNumber } from "@/lib/whatsapp/index";
import { toE164 } from "@/lib/whatsapp/phone";

// The signature is computed over the exact bytes and parameters Twilio sent,
// so nothing may re-encode this body before it is checked — the WhatsApp and
// Stripe webhooks' own discipline.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Reading SMS — B1316. The instance's number could be written to by anybody
 * and the words landed nowhere; this stores them where /admin's SMS panel
 * reads them, and does nothing else: no dispatch, no model, no reply. An
 * empty TwiML answer is "message received, say nothing back".
 *
 * Twilio signs each delivery with the account's auth token: HMAC-SHA1 over
 * the **public URL as Twilio was given it** plus every POST parameter sorted
 * by name, base64. The URL half is why `site.url` builds the signing base
 * rather than `request.url` — behind the proxy this process sees a
 * localhost URL that was never what Twilio signed.
 *
 * Twilio retries an errored delivery, and the MessageSid is stable across a
 * retry — the UNIQUE constraint on `provider_sid` makes the second insert a
 * no-op (see 031-sms-messages), so a retry is answered 200 without a second
 * row.
 */

function webhookUrl(): string {
  return new URL("/api/webhooks/twilio", loadServerConfig().site.url).toString();
}

function validSignature(params: URLSearchParams, signature: string | null, authToken: string): boolean {
  if (!signature) return false;
  // Twilio's published scheme: the URL, then each POST parameter's name and
  // value concatenated in name order, HMAC-SHA1 with the auth token, base64.
  const sorted = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const base = webhookUrl() + sorted.map(([k, v]) => k + v).join("");
  const expected = crypto.createHmac("sha1", authToken).update(base).digest("base64");
  const bufA = Buffer.from(signature);
  const bufB = Buffer.from(expected);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

/** Empty TwiML — received, and no auto-reply. */
function twimlOk(): Response {
  return new Response('<?xml version="1.0" encoding="UTF-8"?><Response/>', {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

export async function POST(request: Request) {
  if (!isEnabled("smsInbound")) {
    return new Response("this server does not read SMS", { status: 404 });
  }

  const signature = request.headers.get("x-twilio-signature");
  // Read before anything parses it — the signature covers the exact
  // parameters as sent.
  const raw = await request.text();
  const params = new URLSearchParams(raw);

  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken || !validSignature(params, signature, authToken)) {
    return new Response("bad signature", { status: 403 });
  }

  const from = toE164(params.get("From") ?? "") ?? "";
  const to = toE164(params.get("To") ?? "") ?? "";
  const bodyText = params.get("Body") ?? "";
  const sid = params.get("MessageSid") ?? "";
  if (!from || !sid) {
    // Signed but not message-shaped (a status callback pointed here by
    // mistake, say). Answer 200 so Twilio does not retry what will never
    // parse differently.
    return twimlOk();
  }

  /**
   * Keyed on the sender's E.164, never the caller's IP — every delivery
   * arrives from Twilio's own addresses, so an IP-keyed limit would
   * throttle every sender at once. The WhatsApp webhook's most important
   * line, copied.
   */
  const limit = rateLimitFor("sms-inbound", from, { max: 30, windowMs: 5 * 60 * 1000 });
  if (!limit.ok) {
    console.warn(`[sms:inbound] rate-limited ${maskNumber(from)}`);
    return twimlOk();
  }

  try {
    const fresh = await recordSms({
      direction: "in",
      from,
      to,
      body: bodyText.slice(0, 4000),
      providerSid: sid,
    });
    if (fresh) console.log(`[sms:inbound] ${maskNumber(from)} — ${bodyText.length} chars`);
  } catch (err) {
    // A genuine storage failure should be retried by Twilio's own backoff —
    // 500 means "try again", the Stripe webhook's retry semantics.
    console.error(`[sms:inbound] failed to store ${sid}:`, err);
    return new Response("storage failed", { status: 500 });
  }

  return twimlOk();
}

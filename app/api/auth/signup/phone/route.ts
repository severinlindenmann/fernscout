import { NO_JOURNAL, resolveSession } from "@/lib/auth";
import { isEnabled } from "@/lib/capabilities";
import { loadServerConfig } from "@/lib/config";
import { fromAcceptLanguage, pickLocale } from "@/lib/contacts/locale";
import { phoneProofMode, smsFallbackOffered, startVerification } from "@/lib/phoneVerify";
import { createPhoneLink } from "@/lib/phoneVerify/inboundLink";
import { smsPhoneVerify } from "@/lib/phoneVerify/sms";
import { rateLimitFor } from "@/lib/rateLimit";
import { smsUnreachable } from "@/lib/sms";
import { toE164 } from "@/lib/whatsapp/phone";
import { ERROR_CODES } from "@/lib/api/errorCodes";
import { fail, ok } from "@/lib/api/v2/route";

export const dynamic = "force-dynamic";

/**
 * Step two of making a journal: prove the number, after the address —
 * B1065. Inserted between `POST /api/auth/signup/verify` (which proves the
 * address) and `POST /api/v1/journals` (which spends both), and in that
 * order deliberately: a bot has to pass the free email gate before it can
 * cost the operator an SMS.
 *
 * Renamed from `/api/auth/signup/phone/request` for v2
 * (`docs/plans/2026-09-12-api-v2/auth.md` §2.6) to match the
 * `codes`/`codes/redeem` naming the rest of `/api/auth` now uses — the
 * behaviour underneath is unchanged; this stays its own pair rather than
 * folding into `/api/auth/codes` because the shape here is genuinely
 * different (an `id` per attempt, a poll-with-no-code mode for WhatsApp
 * inbound, its own three-tier rate ceiling).
 *
 * A full E.164 number is required, with no default country code — the same
 * rule `owner.tel` itself follows (`lib/config.ts`): this server is not
 * standing in any particular country, so a national number is refused rather
 * than guessed at somebody's expense.
 *
 * Three ceilings, all keyed on something other than the caller's IP — every
 * webhook and every browser share addresses, but a paid SMS is spent once per
 * number and once per address, and `lib/rateLimit.ts`'s default bucketing by
 * IP would let a script behind one address hammer a hundred numbers freely.
 * B1065: 3 per number per day, 5 per address per day, 50 per instance per
 * day. Refuse, never queue — each is consumed on *every* attempt, successful
 * or not, which is the simpler and more conservative reading of "refuse
 * rather than queue" than trying to only count outcomes the way
 * `POST /api/v1/journals` splits `CREATED`/`REFUSED`.
 */
const DAY = 24 * 60 * 60 * 1000;
const PER_NUMBER = { max: 3, windowMs: DAY };
const PER_ADDRESS = { max: 5, windowMs: DAY };
const PER_INSTANCE = { max: 50, windowMs: DAY };

export async function POST(request: Request) {
  if (!isEnabled("signup")) {
    return fail("signup_disabled", ERROR_CODES.signup_disabled, undefined, 404);
  }

  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  const session = match ? await resolveSession(match[1].trim(), "signup") : null;
  if (!session || session.owner !== NO_JOURNAL) {
    return fail(
      "invalid_token",
      "This is step two of signup — prove the address first at POST /api/auth/codes/redeem " +
        '(for: "signup"), then bring that token here.',
      undefined,
      401,
    );
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  /**
   * `channel: "sms"` is the fallback beside inbound mode — B1316: the person
   * with no WhatsApp asks for a code by SMS instead. Only meaningful there;
   * in every code mode the configured backend already decides the delivery,
   * so the field is ignored rather than letting a caller pick a transport
   * the server never offered.
   */
  const smsChannel = body.channel === "sms" && phoneProofMode() === "whatsapp-inbound";
  if (smsChannel && !smsFallbackOffered()) {
    return fail("sms_disabled", "This server cannot send SMS — use the WhatsApp confirmation instead.", undefined, 404);
  }

  /**
   * Inbound mode — B1234 — takes no number at all: the person's own message
   * will carry it. Only the address and instance ceilings apply (there is
   * no number to key on, and nothing paid goes out); the row itself is the
   * only cost.
   */
  if (phoneProofMode() === "whatsapp-inbound" && !smsChannel) {
    const perAddress = rateLimitFor("phone-verify-address", session.email, PER_ADDRESS);
    if (!perAddress.ok) return tooMany("address", perAddress.retryAfter);
    const perInstance = rateLimitFor("phone-verify-instance", "*", PER_INSTANCE);
    if (!perInstance.ok) return tooMany("instance", perInstance.retryAfter);

    const locale = pickLocale(fromAcceptLanguage(request.headers.get("accept-language")));
    const link = await createPhoneLink(session.id, locale);
    if (!link) {
      console.error("[signup] phone proof is whatsapp-inbound but features.whatsapp.number is not set");
      return fail(
        "verification_failed",
        "This server cannot offer the WhatsApp confirmation right now.",
        undefined,
        503,
      );
    }
    return ok(
      {
        status: "accepted",
        mode: "whatsapp-inbound",
        // Whether {"channel": "sms"} on this same route is a way out for a
        // caller with no WhatsApp — B1316.
        smsFallback: smsFallbackOffered(),
        id: link.id,
        link: link.link,
        text: link.text,
        next:
          "Have the person open the link and send the prepared message, then poll " +
          'POST /api/auth/signup/phone/redeem with {"token", "id"} (no code) until the ' +
          'answer stops being {"status": "pending"}.',
      },
      { status: 202 },
    );
  }

  const rawTel = typeof body.tel === "string" ? body.tel : "";
  const tel = toE164(rawTel);
  if (!tel) {
    return fail(
      "invalid_request",
      'tel must be a telephone number with its country code — "+41 76 000 00 00", ' +
        '"0041 76 000 00 00" or "41760000000" — a national number like "076 000 00 00" is ' +
        "refused: this server is not standing in any country.",
      undefined,
      400,
    );
  }

  /**
   * Refused here with the reason, not at Twilio without one — B1316/B1317:
   * the instance's number may only reach some countries (the live one is
   * Swiss and domestic-only), and a person typing +49 must be told to use
   * WhatsApp rather than wait for a code that never comes. Checked before
   * the ceilings so an unreachable number costs nothing.
   */
  const viaSms = smsChannel || loadServerConfig().features.signup.phoneBackend === "sms";
  if (viaSms) {
    const unreachable = smsUnreachable(tel);
    if (unreachable) {
      return fail(
        "sms_unreachable",
        `A code cannot be sent to this number: ${unreachable}.` +
          (smsChannel ? " Use the WhatsApp confirmation instead." : ""),
        undefined,
        400,
      );
    }
  }

  const perNumber = rateLimitFor("phone-verify-number", tel, PER_NUMBER);
  if (!perNumber.ok) return tooMany("number", perNumber.retryAfter);
  const perAddress = rateLimitFor("phone-verify-address", session.email, PER_ADDRESS);
  if (!perAddress.ok) return tooMany("address", perAddress.retryAfter);
  // A generic bucket key, shared by every caller — the whole point of a
  // per-instance ceiling.
  const perInstance = rateLimitFor("phone-verify-instance", "*", PER_INSTANCE);
  if (!perInstance.ok) return tooMany("instance", perInstance.retryAfter);

  const locale = pickLocale(fromAcceptLanguage(request.headers.get("accept-language")));

  try {
    // The fallback names its backend directly: startVerification dispatches
    // on the configured mode, which in inbound mode has no start() to reach.
    const { id } = smsChannel
      ? await smsPhoneVerify.start(tel, locale)
      : await startVerification(tel, locale);
    return ok(
      {
        status: "accepted",
        id,
        next: 'POST /api/auth/signup/phone/redeem with {"token", "id", "code"}.',
      },
      { status: 202 },
    );
  } catch (err) {
    console.error("[signup] could not start a phone verification:", err);
    return fail(
      "verification_failed",
      "The code could not be sent. Try again in a minute, or check the number.",
      undefined,
      503,
    );
  }
}

function tooMany(reason: "number" | "address" | "instance", retryAfter: number) {
  const minutes = Math.max(1, Math.ceil(retryAfter / 60));
  const messages: Record<typeof reason, string> = {
    number: `This number has asked for ${PER_NUMBER.max} codes in the last day, which is the limit.`,
    address: `This address has asked for ${PER_ADDRESS.max} phone codes in the last day, which is the limit.`,
    instance: "This server has sent its daily limit of phone codes. Try again tomorrow.",
  };
  const response = fail(
    "too_many_requests",
    `${messages[reason]} Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
    { reason, retryAfter },
    429,
  );
  response.headers.set("Retry-After", String(retryAfter));
  return response;
}

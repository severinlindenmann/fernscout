import { NO_JOURNAL, resolveSession } from "@/lib/auth";
import { isEnabled } from "@/lib/capabilities";
import { fromAcceptLanguage, pickLocale } from "@/lib/contacts/locale";
import { startVerification } from "@/lib/phoneVerify";
import { rateLimitFor } from "@/lib/rateLimit";
import { toE164 } from "@/lib/whatsapp/phone";

export const dynamic = "force-dynamic";

/**
 * Step two of making a journal: prove the number, after the address —
 * B1065. Inserted between `POST /api/auth/signup/verify` (which proves the
 * address) and `POST /api/v1/journals` (which spends both), and in that
 * order deliberately: a bot has to pass the free email gate before it can
 * cost the operator an SMS.
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
    return Response.json({ error: "signup_disabled" }, { status: 404 });
  }

  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  const session = match ? await resolveSession(match[1].trim(), "signup") : null;
  if (!session || session.owner !== NO_JOURNAL) {
    return Response.json(
      {
        error: "invalid_token",
        message:
          "This is step two of signup — prove the address first at POST /api/auth/signup/verify, " +
          "then bring that token here.",
      },
      { status: 401 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const rawTel = typeof body.tel === "string" ? body.tel : "";
  const tel = toE164(rawTel);
  if (!tel) {
    return Response.json(
      {
        error: "invalid_request",
        message:
          'tel must be a telephone number with its country code — "+41 76 000 00 00", ' +
          '"0041 76 000 00 00" or "41760000000" — a national number like "076 000 00 00" is ' +
          "refused: this server is not standing in any country.",
      },
      { status: 400 },
    );
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
    const { id } = await startVerification(tel, locale);
    return Response.json(
      {
        status: "accepted",
        id,
        next: 'POST /api/auth/signup/phone/verify with {"token", "id", "code"}.',
      },
      { status: 202 },
    );
  } catch (err) {
    console.error("[signup] could not start a phone verification:", err);
    return Response.json(
      {
        error: "verification_failed",
        message: "The code could not be sent. Try again in a minute, or check the number.",
      },
      { status: 503 },
    );
  }
}

function tooMany(reason: "number" | "address" | "instance", retryAfter: number): Response {
  const minutes = Math.max(1, Math.ceil(retryAfter / 60));
  const messages: Record<typeof reason, string> = {
    number: `This number has asked for ${PER_NUMBER.max} codes in the last day, which is the limit.`,
    address: `This address has asked for ${PER_ADDRESS.max} phone codes in the last day, which is the limit.`,
    instance: "This server has sent its daily limit of phone codes. Try again tomorrow.",
  };
  return Response.json(
    {
      error: "too_many_requests",
      reason,
      retryAfter,
      message: `${messages[reason]} Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
    },
    { status: 429, headers: { "Retry-After": String(retryAfter) } },
  );
}

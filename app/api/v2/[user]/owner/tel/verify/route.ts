// POST /api/v2/{user}/owner/tel/verify — B1654, D20.
//
// Step one of the only way to SET the owner's own number: prove it. An agent
// holding an owner token may ask for a passcode to be sent to a number, but
// setting the field still needs that passcode back at `.../verify/redeem` —
// this route on its own writes nothing. Reuses signup's own machinery
// (`lib/phoneVerify`) rather than a second proof flow: the same
// `startVerification`/`checkVerification` pair `POST
// /api/auth/signup/phone` uses before a journal exists, called here for one
// that already does.
import { ownerTelVerifyRequest, ownerTelVerifyStarted } from "@/lib/api/v2/schemas";
import { requireJournalOwner } from "@/lib/api/v2/auth";
import { fail, ok } from "@/lib/api/v2/route";
import { getUser } from "@/lib/users";
import { isEnabled } from "@/lib/capabilities";
import { fromAcceptLanguage, pickLocale } from "@/lib/contacts/locale";
import { phoneProofMode, startVerification } from "@/lib/phoneVerify";
import { smsUnreachable } from "@/lib/sms";
import { rateLimitFor } from "@/lib/rateLimit";
import { toE164 } from "@/lib/whatsapp/phone";

export const dynamic = "force-dynamic";

const DAY = 24 * 60 * 60 * 1000;
const PER_NUMBER = { max: 3, windowMs: DAY };
const PER_OWNER = { max: 5, windowMs: DAY };
const PER_INSTANCE = { max: 50, windowMs: DAY };

export async function POST(request: Request, { params }: RouteContext<"/api/v2/[user]/owner/tel/verify">) {
  const { user } = await params;
  const auth = await requireJournalOwner(request, user);
  if (!auth.ok) return auth.response;
  if (!getUser(user)) return fail("no_such_journal", `No journal called "${user}".`, undefined, 404);
  if (!isEnabled("whatsapp", user)) {
    return fail(
      "capability_unavailable",
      "This journal's WhatsApp channel is switched off — there is nothing this number would be used for.",
      undefined,
      409,
    );
  }

  // This server only knows how to prove a number by sending it a code — the
  // inbound-link mode (`whatsapp-inbound`) is bound to a signup session that
  // does not exist for a journal that already has one, and is not wired up
  // here. `phoneProofMode()` names the same config either way, so this stays
  // in step with whichever mode signup uses without a second setting.
  if (phoneProofMode() !== "code") {
    return fail(
      "capability_unavailable",
      "This server proves a number by an inbound WhatsApp message, which only works during " +
        "signup. There is no way to re-prove an existing journal's number yet.",
      undefined,
      409,
    );
  }

  const parsed = await request.json().catch(() => null);
  const result = ownerTelVerifyRequest.safeParse(parsed);
  if (!result.success) return fail("invalid_request", 'Send {"tel": "+41 76 000 00 00"}.');

  const tel = toE164(result.data.tel);
  if (!tel) {
    return fail(
      "invalid_request",
      `"${result.data.tel}" is not a telephone number this can use. Include the country code — ` +
        "+41 76 000 00 00, 0041 76 000 00 00 or 41760000000. A national number like " +
        "076 000 00 00 is refused: it means a different telephone in every country, and this " +
        "server is not standing in any of them.",
    );
  }
  const unreachable = smsUnreachable(tel);
  if (unreachable) {
    return fail("invalid_request", `A code cannot be sent to this number: ${unreachable}.`);
  }

  const perNumber = rateLimitFor("owner-tel-verify-number", tel, PER_NUMBER);
  if (!perNumber.ok) return tooMany(perNumber.retryAfter, "This number");
  const perOwner = rateLimitFor("owner-tel-verify-owner", user, PER_OWNER);
  if (!perOwner.ok) return tooMany(perOwner.retryAfter, "This journal");
  const perInstance = rateLimitFor("phone-verify-instance", "*", PER_INSTANCE);
  if (!perInstance.ok) return tooMany(perInstance.retryAfter, "This server");

  const locale = pickLocale(fromAcceptLanguage(request.headers.get("accept-language")));
  try {
    const { id } = await startVerification(tel, locale);
    return ok(ownerTelVerifyStarted.parse({ id }), { status: 202 });
  } catch (err) {
    console.error(`[owner-tel] could not start a phone verification for ${user}:`, err);
    return fail("verification_failed", "The code could not be sent. Try again in a minute, or check the number.", undefined, 503);
  }
}

function tooMany(retryAfter: number, who: string) {
  const minutes = Math.max(1, Math.ceil(retryAfter / 60));
  const response = fail(
    "too_many_requests",
    `${who} has asked for too many phone codes today. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
    { retryAfter },
    429,
  );
  response.headers.set("Retry-After", String(retryAfter));
  return response;
}

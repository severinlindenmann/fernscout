import { isEmail, openSignupSession, spendSignupResumeLink } from "@/lib/auth";
import { FOREIGN_ORIGIN_REFUSAL, foreignOrigin } from "@/lib/auth/originCheck";
import { isEnabled } from "@/lib/capabilities";
import { signupAllowed } from "@/lib/inviteList";
import { MAX_JOURNALS_PER_EMAIL, journalsOwnedBy } from "@/lib/journals";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { recordPendingEmail } from "@/lib/signup/pending";
import { ERROR_CODES } from "@/lib/api/errorCodes";
import { fail, ok, readJson } from "@/lib/api/v2/route";
import { signupResumeRequest } from "@/lib/api/v2/schemas/auth";

export const dynamic = "force-dynamic";

/**
 * Spend the "Continue my signup" button of the signup code mail — B2781.
 *
 * The mailed link proves the address exactly as the code beside it does, so
 * pressing it has the code's power and no more: a signup-kind session for
 * that one address, in the body, never a cookie (no identity, guest or
 * session cookie — a press on a shared device must not sign the device in,
 * and the token leaves where every signup token does). It is single use and
 * lives seven days; a forwarded copy works once for whoever presses first,
 * which is also true of the code it sits beside.
 *
 * The gates are the code redeem's: signup on, invite list, journal cap. The
 * link is spent first (the address is only known from its row), so a press
 * that is then refused — not invited, or already keeping a journal — is
 * spent too; the answer says why and the person asks for a new code. The
 * pending row is created when the code was never typed.
 */
export async function POST(request: Request) {
  if (!isEnabled("signup")) return fail("signup_disabled", ERROR_CODES.signup_disabled, undefined, 404);
  if (foreignOrigin(request)) return Response.json(FOREIGN_ORIGIN_REFUSAL, { status: 403 });

  const limit = rateLimitFor("signup-resume", clientIp(request), { max: 20, windowMs: 15 * 60 * 1000 });
  if (!limit.ok) {
    const res = fail("too_many_requests", ERROR_CODES.too_many_requests, { retryAfter: limit.retryAfter }, 429);
    res.headers.set("Retry-After", String(limit.retryAfter));
    return res;
  }

  const read = await readJson(request);
  if (!read.ok) return read.response;
  const body = signupResumeRequest.safeParse(read.value);
  if (!body.success) return fail("invalid_request", ERROR_CODES.invalid_request);

  const spent = await spendSignupResumeLink(body.data.token);
  if (!spent || !isEmail(spent.email)) {
    return fail("invalid_resume_link", ERROR_CODES.invalid_resume_link, undefined, 401);
  }
  const email = spent.email;

  if (!(await signupAllowed(email))) {
    return fail("signup_not_invited", ERROR_CODES.signup_not_invited, undefined, 403);
  }
  if (journalsOwnedBy(email).length >= MAX_JOURNALS_PER_EMAIL) {
    return fail("too_many_journals", ERROR_CODES.too_many_journals, undefined, 409);
  }

  await recordPendingEmail(email);
  const { token, expiresAt } = await openSignupSession(email);
  return ok({ ok: true, token, expires: expiresAt, scope: "signup" as const });
}

import { isEmail, openSignupSession } from "@/lib/auth";
import { resolveIdentity } from "@/lib/auth/handshake";
import { FOREIGN_ORIGIN_REFUSAL, foreignOrigin } from "@/lib/auth/originCheck";
import { isEnabled } from "@/lib/capabilities";
import { signupAllowed } from "@/lib/inviteList";
import { MAX_JOURNALS_PER_EMAIL, journalsOwnedBy } from "@/lib/journals";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { ERROR_CODES } from "@/lib/api/errorCodes";
import { fail, ok } from "@/lib/api/v2/route";

export const dynamic = "force-dynamic";

/**
 * A signup token for the address the browser's identity cookie already
 * proves — B2522. A guest or buddy who is signed in and presses "Start a
 * journal" was sent a second code for the address the cookie had just
 * proved; this is the same token `/api/auth/codes/redeem` (`for: "signup"`)
 * would return, behind the same gates, without the round trip through their
 * inbox.
 *
 * **Identity cookie only.** `resolveIdentity` reads `fs_identity` and nothing
 * else: no bearer token, and no journal `fs_session`, which proves an address
 * only for one journal (see `handshake.ts`). A number-only guest (`+<digits>`
 * subject) has no address to sign up with and is refused, so the wizard sends
 * them the ordinary code.
 *
 * The token leaves in the body, never a cookie, like every signup token
 * (decision 24) — and `foreignOrigin` refuses a cross-site POST even though a
 * foreign page could not read the body anyway.
 */
export async function POST(request: Request) {
  if (!isEnabled("signup")) return fail("signup_disabled", ERROR_CODES.signup_disabled, undefined, 404);
  if (foreignOrigin(request)) return Response.json(FOREIGN_ORIGIN_REFUSAL, { status: 403 });

  const limit = rateLimitFor("signup-identity", clientIp(request), { max: 20, windowMs: 15 * 60 * 1000 });
  if (!limit.ok) {
    const res = fail("too_many_requests", ERROR_CODES.too_many_requests, { retryAfter: limit.retryAfter }, 429);
    res.headers.set("Retry-After", String(limit.retryAfter));
    return res;
  }

  const identity = await resolveIdentity();
  if (!identity || !isEmail(identity.email)) {
    return fail("not_signed_in", ERROR_CODES.not_signed_in, undefined, 401);
  }
  const email = identity.email;

  if (!(await signupAllowed(email))) {
    return fail("signup_not_invited", ERROR_CODES.signup_not_invited, undefined, 403);
  }
  if (journalsOwnedBy(email).length >= MAX_JOURNALS_PER_EMAIL) {
    return fail("too_many_journals", ERROR_CODES.too_many_journals, undefined, 409);
  }

  const { token, expiresAt } = await openSignupSession(email);
  return ok({ ok: true, token, expires: expiresAt, scope: "signup" as const });
}

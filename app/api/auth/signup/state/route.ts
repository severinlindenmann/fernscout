import { NO_JOURNAL, resolveSession } from "@/lib/auth";
import { isEnabled } from "@/lib/capabilities";
import { isAdminEmail } from "@/lib/admin";
import { signupAllowed } from "@/lib/inviteList";
import { phoneProofMode, smsFallbackOffered } from "@/lib/phoneVerify";
import { ERROR_CODES } from "@/lib/api/errorCodes";
import { fail, ok } from "@/lib/api/v2/route";

export const dynamic = "force-dynamic";

/**
 * Where this signup stands — B2804. The wizard asks once it holds a signup
 * token (from a code or from the identity cookie) so it can jump to the step
 * that is still open instead of starting at the email.
 *
 * Bearer signup token only, like every step of signup; the answer describes
 * the token's own session and nothing about any other address. `telMasked`
 * hides all but the last two digits of the proven number. A read: it changes
 * nothing and sends nothing.
 */
export async function GET(request: Request) {
  if (!isEnabled("signup")) {
    return fail("signup_disabled", ERROR_CODES.signup_disabled, undefined, 404);
  }

  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  const session = match ? await resolveSession(match[1].trim(), "signup") : null;
  if (!session || session.owner !== NO_JOURNAL) {
    return fail("invalid_token", ERROR_CODES.invalid_token, undefined, 401);
  }
  if (!(await signupAllowed(session.email))) {
    return fail("signup_not_invited", ERROR_CODES.signup_not_invited, undefined, 403);
  }

  return ok({
    emailProven: true,
    phoneProven: Boolean(session.phone),
    telMasked: session.phone ? `+${"•".repeat(Math.max(0, session.phone.length - 2))}${session.phone.slice(-2)}` : null,
    // The same exemption POST /api/v2/journals applies by address; a `test-`
    // username is exempt too, but no username exists yet.
    phoneRequired: !isAdminEmail(session.email),
    mode: phoneProofMode(),
    smsFallback: smsFallbackOffered(),
  });
}

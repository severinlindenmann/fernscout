import { NO_JOURNAL, isEmail, verifyCode } from "@/lib/auth";
import { isEnabled } from "@/lib/capabilities";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * Step two: the code becomes a token that can create exactly one journal.
 *
 * Returned in the body rather than set as a cookie, for the same reason an
 * agent token is (decision 24): the caller is a program, and a credential in a
 * cookie jar is one a browser will replay.
 */
export async function POST(request: Request) {
  if (!isEnabled("signup")) {
    return Response.json({ error: "signup_disabled" }, { status: 404 });
  }

  const limit = rateLimitFor("auth-signup-verify", clientIp(request), {
    max: 20,
    windowMs: 15 * 60 * 1000,
  });
  if (!limit.ok) {
    return Response.json(
      { error: "too_many_requests", retryAfter: limit.retryAfter },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const email = typeof body.email === "string" ? body.email : "";
  const code = typeof body.code === "string" ? body.code : "";

  if (!isEmail(email) || !code) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  const result = await verifyCode(NO_JOURNAL, email, code, "signup");
  if (!result.ok) {
    // One answer for every failure, as everywhere else here.
    return Response.json({ error: "invalid_code" }, { status: 401 });
  }

  return Response.json({
    ok: true,
    token: result.token,
    expires: result.expiresAt,
    scope: [result.scope],
    next: "POST /api/v1/journals with this token to create your journal.",
  });
}

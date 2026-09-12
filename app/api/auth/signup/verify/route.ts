import { NO_JOURNAL, isEmail, verifyCode } from "@/lib/auth";
import { isEnabled } from "@/lib/capabilities";
import { MAX_JOURNALS_PER_EMAIL, journalsOwnedBy } from "@/lib/journals";
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

  /**
   * An address at the journal cap is told so here, not three steps later —
   * B1568. `createJournal` still enforces the cap (it must — this route is
   * not the only way to a signup token), but the wizard used to reach it
   * only after the journal form and a proven phone number, so the person
   * burned an SMS to learn something knowable at the code step. Checked
   * *after* the code verifies, never before: answered on the address alone,
   * this route would be the "who is on this server" oracle the uniform 202
   * on /api/auth/signup/request exists to prevent. Past the proof it
   * discloses nothing `POST /api/v1/journals` would not disclose to the
   * same caller anyway.
   */
  const owned = journalsOwnedBy(email);
  if (owned.length >= MAX_JOURNALS_PER_EMAIL) {
    return Response.json(
      {
        error: "too_many_journals",
        message:
          owned.length === 1
            ? `This address already owns "${owned[0]}", and one journal per address is the ` +
              `limit on this server.`
            : `This address already owns ${owned.length} journals (${owned.join(", ")}), ` +
              `which is the limit on this server.`,
        next:
          `To write to one of them instead, POST /api/auth/request with ` +
          `{"user": "${owned[0]}", "email": "${email}", "kind": "agent"}, then exchange ` +
          `the code at /api/auth/verify.`,
      },
      { status: 409 },
    );
  }

  return Response.json({
    ok: true,
    token: result.token,
    expires: result.expiresAt,
    scope: [result.scope],
    next: "POST /api/v1/journals with this token to create your journal.",
  });
}

import { NO_JOURNAL, markPhoneProven, resolveSession } from "@/lib/auth";
import { isEnabled } from "@/lib/capabilities";
import { checkVerification } from "@/lib/phoneVerify";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * Step two, part two: the code becomes a proven number on the signup
 * session — B1065. `POST /api/v1/journals` reads it off the session
 * (`phone`/`phoneProvenAt`) rather than trusting a number the create request
 * could simply assert.
 */
export async function POST(request: Request) {
  if (!isEnabled("signup")) {
    return Response.json({ error: "signup_disabled" }, { status: 404 });
  }

  const limit = rateLimitFor("phone-verify-check", clientIp(request), {
    max: 20,
    windowMs: 15 * 60 * 1000,
  });
  if (!limit.ok) {
    return Response.json(
      { error: "too_many_requests", retryAfter: limit.retryAfter },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  const session = match ? await resolveSession(match[1].trim(), "signup") : null;
  if (!session || session.owner !== NO_JOURNAL) {
    return Response.json({ error: "invalid_token" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const id = typeof body.id === "string" ? body.id : "";
  const code = typeof body.code === "string" ? body.code : "";
  if (!id || !code) {
    return Response.json(
      { error: "invalid_request", message: 'Both "id" (from the request step) and "code" are required.' },
      { status: 400 },
    );
  }

  const result = await checkVerification(id, code);
  if (result.status !== "ok") {
    // One shape for every failure — the same discipline every code in this
    // codebase follows, so a caller cannot tell "wrong digits" from
    // "expired" from a burned id by probing.
    return Response.json({ error: "invalid_code" }, { status: 401 });
  }

  await markPhoneProven(session.id, result.phone);

  return Response.json({
    ok: true,
    tel: result.phone,
    next: "POST /api/v1/journals — the proven number is attached to this token automatically.",
  });
}

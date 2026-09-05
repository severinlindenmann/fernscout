import { NO_JOURNAL, isEmail, verifyCode } from "@/lib/auth";
import { setIdentityCookie } from "@/lib/auth/identityCookie";
import { isEnabled } from "@/lib/capabilities";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * Exchange an identity code for the year-long credential — B410.
 *
 * The token leaves in an httpOnly cookie and is never returned in the body.
 * There is no agent branch here and there must not be one: an identity is a
 * browser credential for a person looking at a page, and an agent that wanted
 * to act on a journal asks `/api/auth/request` for a token scoped to it.
 * Decision 24's wall is between reading and writing, and nothing here writes.
 *
 * What *is* returned is the opaque public id, which B412's service worker uses
 * to name the cache it keeps this reader's data in. It authenticates nothing;
 * see `019-identity`.
 */
export async function POST(request: Request) {
  if (!isEnabled("auth")) {
    return Response.json({ error: "auth_disabled" }, { status: 404 });
  }

  const limit = rateLimitFor("auth-verify", clientIp(request), {
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

  // `verifyCode` redeems the six digits and opens the identity in one step —
  // the attempt counter, the burn and the supersede rules all live in there.
  const result = await verifyCode(NO_JOURNAL, email, code, "identity");
  if (!result.ok) {
    // One answer for every failure, as everywhere else: which of "no code",
    // "expired", "wrong" and "burned" applies is what an attacker wants.
    return Response.json({ error: "invalid_code" }, { status: 401 });
  }

  await setIdentityCookie(result.token);
  return Response.json({ ok: true, id: result.publicId });
}

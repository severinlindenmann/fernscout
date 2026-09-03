import { cookies } from "next/headers";
import {
  GUEST_COOKIE,
  SESSION_TTL_MS,
  isEmail,
  verifyCode,
  type SessionKind,
} from "@/lib/auth";
import { isEnabled } from "@/lib/capabilities";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { getUser } from "@/lib/users";
import { getTrip, tripRef } from "@/lib/trips";
import { isPersonOn, tripWriteScope } from "@/lib/tripPeople";

export const dynamic = "force-dynamic";

/**
 * Exchange a code for a session.
 *
 * The two classes leave by different doors, and that is deliberate (decision
 * 24): a guest session is set as an httpOnly cookie and never shown to
 * JavaScript, while an agent token is returned in the body because an agent has
 * no cookie jar. Neither is accepted down the other's channel — see
 * `resolveSession`.
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
  const username = typeof body.user === "string" ? body.user : "";
  const code = typeof body.code === "string" ? body.code : "";
  const kind: SessionKind = body.kind === "agent" ? "agent" : "guest";
  const tripId = typeof body.trip === "string" ? body.trip.trim() : "";

  if (!isEmail(email) || !username || !code) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  // The trip named at request time decides how wide the token is. The owner
  // gets the journal; anybody else gets the one trip they are listed on.
  const result = await verifyCode(
    username,
    email,
    code,
    kind,
    await agentScope(username, tripId, email),
  );
  if (!result.ok) {
    // One answer for every failure. Which of "no code", "expired", "wrong" and
    // "burned" applies is exactly what an attacker would like to know.
    return Response.json({ error: "invalid_code" }, { status: 401 });
  }

  if (kind === "guest") {
    const jar = await cookies();
    jar.set(GUEST_COOKIE, result.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: Math.floor(SESSION_TTL_MS.guest / 1000),
    });
    // The token is in the cookie; echoing it in the body would put a
    // credential somewhere script can read it.
    return Response.json({ ok: true, expires: result.expiresAt, scope: result.scope });
  }

  return Response.json({
    ok: true,
    token: result.token,
    expires: result.expiresAt,
    scope: [result.scope],
    user: username,
  });
}

/**
 * How wide an agent token should be.
 *
 * `undefined` means the default — the whole journal.
 *
 * **Naming a trip narrows the token, whoever asks.** It used to be ignored for
 * the owner, who silently received `write:content` for the entire journal even
 * when they had explicitly asked for one trip. An owner wanting to hand a
 * helper a limited credential, or to bound what an agent could reach, could not
 * get one and was not told. Honouring the request is the only defensible
 * answer: quietly granting more than was asked for is the one option that
 * cannot be argued for.
 *
 * `/api/auth/request` has already refused to send a code to an address that is
 * neither the owner nor on the named trip, so this only decides the width.
 */
async function agentScope(
  username: string,
  tripId: string,
  email: string,
): Promise<string | undefined> {
  if (!tripId) return undefined;
  const trip = getTrip(tripRef(username, tripId));
  if (!trip) return undefined;
  const owner = getUser(username)?.owner.email;
  const isOwnerAddress = owner === email.trim().toLowerCase();
  return isOwnerAddress || (await isPersonOn(trip, email))
    ? tripWriteScope(trip.id)
    : undefined;
}

import { cookies } from "next/headers";
import {
  GUEST_COOKIE,
  SESSION_TTL_MS,
  isEmail,
  pendingCodeTrip,
  tripWriteScope,
  verifyCode,
  type SessionKind,
} from "@/lib/auth";
import { issueIdentityCookie } from "@/lib/auth/identityCookie";
import { isEnabled } from "@/lib/capabilities";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { getUser } from "@/lib/users";
import { getTrip, tripRef } from "@/lib/trips";

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

  /**
   * How wide the token is, decided **before** anything is redeemed.
   *
   * A guest session reads and has nothing to narrow, so it skips this
   * entirely. For an agent token the answer comes off the code's own row —
   * see `agentScope`.
   */
  let scope: string | undefined;
  if (kind === "agent") {
    const decided = await agentScope(username, email, tripId);
    if (!decided.ok) {
      /**
       * **The same answer as a wrong code, deliberately.**
       *
       * A friendlier body here would say which of "your code was issued for a
       * different trip", "this address does not own this journal" and "no such
       * trip" applied — and each of those is a question about somebody else's
       * journal that a caller holding no code could ask by sending this
       * request. The first in particular would turn an outstanding code into
       * something enumerable: name trip after trip until the answer changes.
       *
       * So the refusal is the endpoint's one uniform answer, and the
       * explanation goes where it costs nothing: `/agent.md` says the trip is
       * decided when the code is issued, and the operator gets the line below.
       * Refused before `verifyCode` runs, so a caller that sent the wrong body
       * has not spent the code the person is still holding.
       */
      console.warn(`[auth] agent token refused for ${username}: ${decided.why}`);
      return Response.json({ error: "invalid_code" }, { status: 401 });
    }
    scope = decided.scope;
  }

  const result = await verifyCode(username, email, code, kind, scope);
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
    /**
     * And an identity, because this code proved the address — B410.
     *
     * The reader asked to sign in to one journal and gets, in addition, the
     * instance-wide credential that lets `/` tell them what else they may
     * open. That is not a widening of what they were granted: an identity
     * authorises nothing on its own, and every journal it is presented to
     * re-derives access from grants, `people:` and `config.json` on each
     * request. What it removes is having to prove the same address again for
     * the next journal and on the next device.
     *
     * Guarded, because it is a bonus and not the thing that was asked for. A
     * database hiccup here must not turn a successful sign-in into a 500 and
     * lose the session the reader has already earned.
     */
    try {
      await issueIdentityCookie(email, request.headers.get("user-agent"));
    } catch (err) {
      console.warn("[auth] signed in, but no identity could be issued:", err);
    }

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
 * **The trip is read off the code, never off the request** — B230, and the
 * whole of the fix. `/api/auth/request` refuses an agent code to an address
 * that is neither the journal's owner nor on the trip it named; that check was
 * then thrown away, because the trip was not written down and was re-supplied
 * here. `agentScope` returned `undefined` for every value it did not
 * recognise, `undefined` means "no narrowing", and so **leaving the field out
 * handed somebody who had been let onto one trip the owner's unqualified
 * `write:content`**. Naming a trip they were not on did the same thing by the
 * same branch.
 *
 * Now the code carries its trip (`login_codes.trip_id`) and this reads it:
 *
 * - **A bound code opens its own trip and nothing else.** The `trip` field in
 *   the body may repeat it or be left out; anything else is refused rather
 *   than resolved. Whether the holder is *still* on that trip is asked at
 *   every write by `tripWriteVerdict`, not here — a token outlives the
 *   answer (B98).
 * - **An unbound code is the journal owner's**, because that is the only way
 *   `/api/auth/request` issues one. Confirmed against `owner.email` rather
 *   than assumed: an unbound code held by anybody else is refused, so a row
 *   written by some future path cannot become a journal-wide token by
 *   default.
 * - **The owner may still narrow at verify time**, which is the behaviour this
 *   function was written for and it survives intact: naming a trip gets that
 *   trip's scope, whoever asks. A trip that does not exist is refused, where
 *   it used to widen — the one direction this must never move in.
 *
 * `undefined` still means the whole journal in `verifyCode`, and it is now
 * returned from exactly one branch: the owner's address, with no trip named
 * and no trip on the code.
 */
async function agentScope(
  username: string,
  email: string,
  requestedTrip: string,
): Promise<{ ok: true; scope?: string } | { ok: false; why: string }> {
  const bound = await pendingCodeTrip(username, email, "agent");

  if (bound) {
    if (requestedTrip && requestedTrip !== bound) {
      return { ok: false, why: "the code was issued for a different trip than the one named" };
    }
    return { ok: true, scope: tripWriteScope(bound) };
  }

  const owner = getUser(username)?.owner.email;
  if (!owner || owner !== email.trim().toLowerCase()) {
    return { ok: false, why: "an agent code with no trip on it, for an address that is not the owner" };
  }

  if (!requestedTrip) return { ok: true, scope: undefined };

  const trip = getTrip(tripRef(username, requestedTrip));
  if (!trip) return { ok: false, why: "the owner asked to narrow to a trip that does not exist" };
  return { ok: true, scope: tripWriteScope(trip.id) };
}

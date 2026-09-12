import { cookies } from "next/headers";
import {
  GUEST_COOKIE,
  NO_JOURNAL,
  SESSION_TTL_MS,
  isEmail,
  pendingCodeTrip,
  tripWriteScope,
  verifyCode,
} from "@/lib/auth";
import { issueIdentityCookie, setIdentityCookie } from "@/lib/auth/identityCookie";
import { isEnabled } from "@/lib/capabilities";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { getUser } from "@/lib/users";
import { getTrip, tripRef } from "@/lib/trips";
import { MAX_JOURNALS_PER_EMAIL, journalsOwnedBy } from "@/lib/journals";
import { ERROR_CODES } from "@/lib/api/errorCodes";
import { fail, ok, readJson } from "@/lib/api/v2/route";
import { problemsFrom } from "@/lib/api/v2/incomplete";
import { CREDENTIAL_TO_SESSION_KIND, codesRedeemRequest } from "@/lib/api/v2/schemas/auth";

export const dynamic = "force-dynamic";

/**
 * Spend a code — B1600, replacing `/api/auth/verify`, `/api/auth/identity/
 * verify` and `/api/auth/signup/verify` (auth.md §2.2). `for:"read"`/
 * `"identity"` leave in a cookie; `for:"write"`/`"signup"` leave in the body
 * (decision 24: the two classes leave by different doors, and neither is
 * accepted down the other's channel).
 */
export async function POST(request: Request) {
  const body = await readJson(request);
  if (!body.ok) return body.response;
  const parsed = codesRedeemRequest.safeParse(body.value);
  if (!parsed.success) {
    return fail("invalid_request", ERROR_CODES.invalid_request, problemsFrom(parsed.error));
  }
  const req = parsed.data;
  const needsJournal = req.for === "read" || req.for === "write";

  if (needsJournal && !req.user) {
    return fail(
      "invalid_request",
      'user is required when "for" is "read" or "write" — the code is for a journal.',
    );
  }
  if (!needsJournal && req.user !== undefined) {
    return fail(
      "invalid_request",
      'user names no journal, so it is refused when "for" is "identity" or "signup".',
    );
  }
  if (req.scope && req.for !== "write") {
    return fail("invalid_request", 'scope is only meaningful when "for" is "write".');
  }
  if (!isEmail(req.email) || !req.code) {
    return fail("invalid_request", ERROR_CODES.invalid_request);
  }

  if (req.for === "signup") {
    if (!isEnabled("signup")) return fail("signup_disabled", ERROR_CODES.signup_disabled, undefined, 404);
  } else if (!isEnabled("auth")) {
    return fail("auth_disabled", ERROR_CODES.auth_disabled, undefined, 404);
  }

  const limit = rateLimitFor("codes-redeem", clientIp(request), { max: 20, windowMs: 15 * 60 * 1000 });
  if (!limit.ok) {
    const res = fail("too_many_requests", ERROR_CODES.too_many_requests, { retryAfter: limit.retryAfter }, 429);
    res.headers.set("Retry-After", String(limit.retryAfter));
    return res;
  }

  const owner = needsJournal ? req.user! : NO_JOURNAL;
  const kind = CREDENTIAL_TO_SESSION_KIND[req.for];

  /**
   * `auth` is also a per-journal opt-in — the server-wide check above is the
   * ceiling; this is the journal's own vote under it. Only for a username
   * that exists: an unknown one falls through to `invalid_code` unchanged, so
   * this adds no way to tell "no such journal" apart from "wrong code".
   */
  if (needsJournal && getUser(owner) && !isEnabled("auth", owner)) {
    return fail("auth_disabled", ERROR_CODES.auth_disabled, undefined, 404);
  }

  let scope: string | undefined;
  if (req.for === "write") {
    const decided = await agentScope(owner, req.email, req.scope?.trip?.trim() ?? "");
    if (!decided.ok) {
      // The same answer as a wrong code — see agentScope's own comment.
      console.warn(`[auth] write token refused for ${owner}: ${decided.why}`);
      return fail("invalid_code", ERROR_CODES.invalid_code, undefined, 401);
    }
    scope = decided.scope;
  }

  const userAgent = req.for === "identity" ? request.headers.get("user-agent") : undefined;
  const result = await verifyCode(owner, req.email, req.code, kind, scope, userAgent);
  if (!result.ok) {
    // One answer for every failure — wrong, expired, burned, wrong `for`, or a
    // `scope.trip` that does not match the bound code.
    return fail("invalid_code", ERROR_CODES.invalid_code, undefined, 401);
  }

  if (req.for === "read") {
    const jar = await cookies();
    jar.set(GUEST_COOKIE, result.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: Math.floor(SESSION_TTL_MS.guest / 1000),
    });
    // And an identity, because this code proved the address — B410. Guarded:
    // a database hiccup here must not turn a successful sign-in into a 500.
    try {
      await issueIdentityCookie(req.email, request.headers.get("user-agent"));
    } catch (err) {
      console.warn("[auth] signed in, but no identity could be issued:", err);
    }
    return ok({ ok: true, expires: result.expiresAt, scope: "read" as const });
  }

  if (req.for === "identity") {
    await setIdentityCookie(result.token);
    return ok({ ok: true, expires: result.expiresAt, scope: "identity" as const });
  }

  /**
   * An address at the journal cap is told so here, not three steps later —
   * B1568. `createJournal` still enforces the cap (this route is not the
   * only way to a signup token), but the wizard used to reach it only after
   * the journal form and a proven phone number, so the person burned an SMS
   * to learn something knowable at the code step. Checked *after* the code
   * verifies, never before: answered on the address alone, this would be
   * the "who is on this server" oracle the uniform 202 on /api/auth/codes
   * exists to prevent.
   */
  if (req.for === "signup") {
    const owned = journalsOwnedBy(req.email);
    if (owned.length >= MAX_JOURNALS_PER_EMAIL) {
      return fail(
        "too_many_journals",
        owned.length === 1
          ? `This address already owns "${owned[0]}", and one journal per address is the limit ` +
            `on this server.`
          : `This address already owns ${owned.length} journals (${owned.join(", ")}), which is ` +
            `the limit on this server.`,
        {
          next:
            `To write to one of them instead, POST /api/auth/codes with ` +
            `{"user": "${owned[0]}", "email": "${req.email}", "for": "write"}, then redeem the ` +
            `code at /api/auth/codes/redeem.`,
        },
        409,
      );
    }
  }

  // "write" or "signup" — the token is the whole body, and no cookie is set.
  return ok({
    ok: true,
    token: result.token,
    expires: result.expiresAt,
    scope: req.for,
    ...(needsJournal ? { user: owner } : {}),
  });
}

/**
 * How wide a write token should be — carried over from `/api/auth/verify`'s
 * `agentScope` unchanged. The trip is read off the code (`login_codes.trip_id`),
 * never off the request body (B230): a field the caller resends is a field the
 * caller can omit to get more than they asked for.
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
    return { ok: false, why: "a write code with no trip on it, for an address that is not the owner" };
  }

  if (!requestedTrip) return { ok: true, scope: undefined };

  const trip = getTrip(tripRef(username, requestedTrip));
  if (!trip) return { ok: false, why: "the owner asked to narrow to a trip that does not exist" };
  return { ok: true, scope: tripWriteScope(trip.id) };
}

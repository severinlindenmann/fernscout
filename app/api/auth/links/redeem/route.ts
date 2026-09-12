import { cookies } from "next/headers";
import { GUEST_COOKIE, NO_JOURNAL, SESSION_TTL_MS, verifyLink } from "@/lib/auth";
import { issueIdentityCookie, setIdentityCookie } from "@/lib/auth/identityCookie";
import { isEnabled } from "@/lib/capabilities";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { getTrip, tripRef } from "@/lib/trips";
import { getUser } from "@/lib/users";
import { ERROR_CODES } from "@/lib/api/errorCodes";
import { fail, ok, readJson } from "@/lib/api/v2/route";
import { problemsFrom } from "@/lib/api/v2/incomplete";
import { CREDENTIAL_TO_SESSION_KIND, linksRedeemRequest } from "@/lib/api/v2/schemas/auth";

export const dynamic = "force-dynamic";

/**
 * Spend a one-click sign-in link — B1600, replacing `/api/auth/link` and
 * `/api/auth/identity/link` (auth.md §2.3). `POST` only (§0 property 7): a
 * mail scanner follows a link, it does not submit a form, and B142 is what
 * three welcome links redeemed by a scanning host before any human opened
 * anything cost the owners who followed their own link afterwards.
 *
 * A link only ever exists for `"read"` or `"identity"` — an agent has no
 * browser to follow one, and a signup link would quietly create a journal on
 * arrival, which nobody has ever wanted.
 */
export async function POST(request: Request) {
  const body = await readJson(request);
  if (!body.ok) return body.response;
  const parsed = linksRedeemRequest.safeParse(body.value);
  if (!parsed.success) {
    return fail("invalid_request", ERROR_CODES.invalid_request, problemsFrom(parsed.error));
  }
  const req = parsed.data;

  if (req.for === "read" && !req.user) {
    return fail("invalid_request", 'user is required when "for" is "read".');
  }
  if (req.for === "identity" && req.user !== undefined) {
    return fail("invalid_request", 'user names no journal, so it is refused when "for" is "identity".');
  }

  const owner = req.for === "read" ? req.user! : NO_JOURNAL;

  if (req.for === "read" && (!getUser(owner) || !isEnabled("auth", owner))) {
    return fail("not_found", ERROR_CODES.not_found, undefined, 404);
  }
  if (req.for === "identity" && !isEnabled("auth")) {
    return fail("not_found", ERROR_CODES.not_found, undefined, 404);
  }

  const limit = rateLimitFor(`links-redeem-${req.for}`, clientIp(request), {
    max: 30,
    windowMs: 15 * 60 * 1000,
  });
  if (!limit.ok) {
    const res = fail("too_many_requests", ERROR_CODES.too_many_requests, { retryAfter: limit.retryAfter }, 429);
    res.headers.set("Retry-After", String(limit.retryAfter));
    return res;
  }

  const result = await verifyLink(
    owner,
    req.token,
    CREDENTIAL_TO_SESSION_KIND[req.for],
    request.headers.get("user-agent"),
  );
  if (!result.ok) {
    const next = req.for === "read" ? `/${owner}/me?signin=expired` : "/?signin=expired";
    // Never a dead end: the page named can issue a fresh code, and says why.
    return fail("link_spent", ERROR_CODES.link_spent, { next }, 401);
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
    try {
      await issueIdentityCookie(result.email, request.headers.get("user-agent"));
    } catch (err) {
      console.warn("[auth] link signed in, but no identity could be issued:", err);
    }
    return ok({ ok: true, next: landing(owner, result.destination) });
  }

  await setIdentityCookie(result.token);
  // Home, always. An identity belongs to no journal, so there is no stored
  // destination to honour.
  return ok({ ok: true, next: "/" });
}

/**
 * Where to put the reader down — carried over from `/api/auth/link`
 * unchanged. A trip that has closed to them lands on the gate, which
 * explains itself; only a trip that is gone falls back to the journal home.
 */
function landing(username: string, destination: string | null): string {
  const home = `/${username}`;
  if (!destination) return home;

  const [, , section, id] = destination.split("/");
  if (section === "trips" && id && !getTrip(tripRef(username, id))) return home;

  return destination;
}

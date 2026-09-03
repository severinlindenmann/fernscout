import { cookies } from "next/headers";
import { GUEST_COOKIE, SESSION_TTL_MS, verifyLink } from "@/lib/auth";
import { isEnabled } from "@/lib/capabilities";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { getTrip, tripRef } from "@/lib/trips";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/**
 * Spend a sign-in link — the deliberate half of `/{user}/s/{token}`.
 *
 * This used to happen on the `GET` of that link, and B142 is what that cost.
 * Three journals were created on 2026-09-03 and all three welcome links were
 * redeemed at 17:59 by something at the receiving mail host, twelve seconds
 * apart, in descending order of creation — a sweep, before any human had
 * opened anything. Each redemption minted a year-long read session for a
 * machine, and each owner following their own link afterwards got
 * `?signin=expired`. On that instance the onboarding path had a 100% failure
 * rate for mail delivered to a scanning host.
 *
 * **Scanners follow links; they do not submit forms.** That is the whole
 * mechanism, and it is the same one the sibling at `/{user}/u/{token}` already
 * used for unsubscribes — a GET that only *shows* you something, a POST that
 * acts. The route this replaces argued the opposite in its own comment: that
 * "the worst a scanner can do is mint a read session it will never use, on a
 * journal whose pages are public anyway, and the reader's code stays live … so
 * they are never locked out by a robot that got to their inbox first". Both
 * halves were wrong in production. A guest session reads `guest` trips, which
 * are not public; and the reader *was* locked out, because the mail's button
 * carries the link, not the code.
 *
 * Deliberately not user-agent sniffing. It is an arms race, it fails open, and
 * it would not have caught this one.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const username = typeof body.user === "string" ? body.user : "";
  const token = typeof body.token === "string" ? body.token : "";

  if (!username || !token || !getUser(username) || !isEnabled("auth", username)) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const limit = rateLimitFor("auth-link", clientIp(request), {
    max: 30,
    windowMs: 15 * 60 * 1000,
  });
  if (!limit.ok) {
    return Response.json(
      { error: "too_many_requests", retryAfter: limit.retryAfter },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const result = await verifyLink(username, token);
  if (!result.ok) {
    // Never a dead end. The page that can issue a fresh code, saying what
    // happened — see `me.signinExpired`.
    return Response.json({ error: "link_spent", next: `/${username}/me?signin=expired` }, { status: 401 });
  }

  const jar = await cookies();
  jar.set(GUEST_COOKIE, result.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS.guest / 1000),
  });

  return Response.json({ ok: true, next: landing(username, result.destination) });
}

/**
 * Where to put the reader down.
 *
 * `result.destination` is the page they were on when they asked for the code,
 * already checked by `safeDestination` to be a path inside this journal —
 * there is nothing in the URL that sets it, and nothing here that widens it.
 * Null means nobody said, which is every mail sent from somewhere other than a
 * gate, and the answer is the journal's front page as it always was.
 *
 * The one thing left to decide is a destination that has gone stale. Half an
 * hour is long enough for the owner to delete the trip the reader was looking
 * at, and a link that signs somebody in and then shows them a 404 is a worse
 * ending than the front page. A trip that still exists but has closed to them
 * is *not* stale: that lands on the gate, which is the page that explains
 * itself and offers the way on. Only a trip that is gone falls back.
 */
function landing(username: string, destination: string | null): string {
  const home = `/${username}`;
  if (!destination) return home;

  const [, , section, id] = destination.split("/");
  if (section === "trips" && id && !getTrip(tripRef(username, id))) return home;

  return destination;
}

import { cookies } from "next/headers";
import { GUEST_COOKIE, SESSION_TTL_MS, verifyLink } from "@/lib/auth";
import { isEnabled } from "@/lib/capabilities";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { serverSite } from "@/lib/site";
import { getTrip, tripRef } from "@/lib/trips";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/**
 * The button in a sign-in email: one click, and you are reading the journal.
 *
 * Typing a six-digit code from a phone into a laptop is where a reader who is
 * not comfortable with computers gives up, and the people this is built for
 * open the site once a month from a link somebody sent them. The code is still
 * in the mail, underneath, for anyone whose client mangles links.
 *
 * **A GET that changes state deserves an explanation**, because the sibling
 * route at `/[user]/u/[token]` refuses to do exactly that. The difference is
 * what is at stake. There, a scanner following a link would unsubscribe a
 * reader — a loss they never see and cannot undo. Here, the worst a scanner
 * can do is mint a *read* session it will never use, on a journal whose pages
 * are public anyway, and the reader's code stays live (see `verifyLink`), so
 * they are never locked out by a robot that got to their inbox first.
 *
 * What a scanner cannot do is get anything that writes. This issues a guest
 * session and only ever a guest session — decision 24, and the reason
 * `verifyLink` defaults to that kind rather than taking it from the URL.
 */
export async function GET(request: Request, context: RouteContext<"/[user]/s/[token]">) {
  const { user: username, token } = await context.params;
  const site = serverSite().url;

  if (!getUser(username) || !isEnabled("auth", username)) {
    return new Response("Not found", { status: 404 });
  }

  const limit = rateLimitFor("auth-link", clientIp(request), {
    max: 30,
    windowMs: 15 * 60 * 1000,
  });
  if (!limit.ok) {
    return Response.redirect(`${site}/${username}/me?signin=throttled`, 303);
  }

  const result = await verifyLink(username, token);
  if (!result.ok) {
    // Never a dead end. An expired or already-used link lands on the page that
    // can issue a fresh one, saying so, rather than on a 404 that leaves a
    // reader with nowhere to go and nothing to try.
    return Response.redirect(`${site}/${username}/me?signin=expired`, 303);
  }

  const jar = await cookies();
  jar.set(GUEST_COOKIE, result.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS.guest / 1000),
  });

  // 303, so the browser follows with a GET and a reload does not re-run a
  // link that has already been spent.
  return Response.redirect(`${site}${landing(username, result.destination)}`, 303);
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

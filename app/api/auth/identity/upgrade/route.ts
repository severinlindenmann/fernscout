import { GUEST_COOKIE, IDENTITY_COOKIE, resolveSession } from "@/lib/auth";
import { issueIdentityCookie } from "@/lib/auth/identityCookie";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

/**
 * Give a reader who signed in before B410 the identity that sign-in would
 * mint today — B459.
 *
 * B410 shipped after a year-long cookie had already been handed to everybody
 * signed in, so the ordinary population of this instance is readers holding
 * `fs_session` and no `fs_identity`. Nothing upgrades them: identity is minted
 * at `/api/auth/verify`, `/api/auth/link` and `/api/contacts/confirm`, all
 * three of which are the *act* of signing in. A reader already signed in never
 * passes through one again, so for up to a year they are missing every surface
 * drawn from an identity — B411's home view, the device list, and B433's way
 * back out of a journal, which is what somebody noticed.
 *
 * **Why a journal session is enough to mint one.** It is the same trust the
 * three sign-ins already act on, one step later: each of them proves an
 * address *for a journal* and issues an instance-wide identity from it,
 * because proving an address for one journal proves the address. A live
 * `fs_session` is the persisted result of exactly that proof. What it is not
 * is an *answer* about the instance — `resolveIdentity` still refuses to be
 * satisfied by it, and must, for the reason written out in `handshake.ts`.
 * Minting is a different act from answering: what comes out is a fresh
 * credential that authorises nothing on its own and that every gate re-checks
 * per request.
 *
 * The one thing to be clear about is revocation. An owner who revokes a
 * guest's session does not revoke an identity minted from it earlier — but
 * that is already true of one minted at sign-in, and it costs nothing: an
 * identity opens only what its holder is entitled to today, and a revoked
 * guest is entitled to nothing.
 */
export async function POST(request: Request) {
  const jar = await cookies();

  // Already holds one. Not an error: the client fires this once per page load
  // for as long as the cookie is missing, and a race between two tabs must
  // not mint two.
  if (await resolveSession(jar.get(IDENTITY_COOKIE)?.value, "identity")) {
    return Response.json({ ok: true, issued: false });
  }

  const limit = rateLimitFor("identity-upgrade", clientIp(request), {
    max: 20,
    windowMs: 15 * 60 * 1000,
  });
  if (!limit.ok) {
    return Response.json(
      { error: "too_many_requests", retryAfter: limit.retryAfter },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  // A journal cookie and nothing else. `resolveSession` enforces the kind, so
  // an agent's bearer token cannot arrive here down the cookie channel and an
  // identity cannot mint itself a second one.
  const session = await resolveSession(jar.get(GUEST_COOKIE)?.value, "guest");
  if (!session) return Response.json({ error: "no_session" }, { status: 401 });

  await issueIdentityCookie(session.email, request.headers.get("user-agent"));
  return Response.json({ ok: true, issued: true });
}

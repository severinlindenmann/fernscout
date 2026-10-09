// GET /api/v2/me/home — ports app/api/v1/me/home/route.ts onto the v2
// plumbing. Identity-cookie surface, not bearer: there is no {user} in this
// path because the whole point is "which journals may THIS address open",
// answered before any one journal is named.
import { listIdentities } from "@/lib/auth";
import { resolveIdentity } from "@/lib/auth/handshake";
import { isAdminEmail } from "@/lib/admin";
import { isEnabled } from "@/lib/capabilities";
import { journalsFor } from "@/lib/home";
import { ok } from "@/lib/api/v2/route";
import { cookieLink, keepsTrip, openToken } from "@/lib/tripLink";
import { ownerShortName } from "@/lib/site";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/** Never stored by a shared cache — see the v1 route this replaces. */
const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * What this person may open, and on which devices they are signed in.
 *
 * `fs_identity` and nothing else — a journal cookie proves an address for
 * one journal only, and `resolveIdentity` refuses a guest cookie, an agent
 * bearer token and a handover credential the same way it does everywhere
 * else. Answers `200` with `id: null` for a stranger rather than `401`: this
 * is a probe fired on every load of `/`, not a protected resource. See the
 * v1 route's own comment (B443) for the full reasoning.
 */
export async function GET() {
  const identity = isEnabled("auth") ? await resolveIdentity() : null;
  // B-2962: the trip link this browser holds, for the keep card. Only for the
  // cookie holder, in this private answer; the path is the one thing the card
  // posts to, so it carries the code the holder already has.
  const held = isEnabled("auth") ? await cookieLink() : null;
  const user = held ? getUser(held.link.owner) : null;
  const link =
    held && user
      ? {
          ownerName: ownerShortName(user) ?? user.title,
          tripTitle: held.link.trip.title,
          keepPath: `/t/${held.code}`,
          token: openToken(held.code),
          signupEnabled: isEnabled("signup"),
          kept: identity ? await keepsTrip(held.link.owner, held.link.trip.id, identity.email) : false,
        }
      : null;
  if (!identity) {
    return ok({ id: null, email: null, journals: [], devices: [], admin: false, link }, { headers: NO_STORE });
  }

  const [journals, devices] = await Promise.all([
    journalsFor(identity.email),
    listIdentities(identity.email),
  ]);

  return ok(
    {
      id: identity.publicId,
      email: identity.email,
      admin: isAdminEmail(identity.email),
      link,
      journals,
      devices: devices.map((row) => ({
        id: row.id,
        publicId: row.publicId,
        createdAt: row.createdAt,
        lastSeenAt: row.lastSeenAt,
        userAgent: row.userAgent,
        current: row.id === identity.id,
      })),
    },
    { headers: NO_STORE },
  );
}

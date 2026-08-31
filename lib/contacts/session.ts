import "server-only";
import { cookies } from "next/headers";
import { GUEST_COOKIE, resolveSession } from "../auth";
import { getUser } from "../users";

/**
 * "Is this the person whose journal it is?"
 *
 * The admin surface lists names, email addresses and — for anyone who asked
 * for a postcard — home addresses. It is the most sensitive page in the
 * application, so the check is deliberately narrow: the session has to belong
 * to *this* user's journal **and** be held by the address named as its owner in
 * `content/<username>/config.json`. A guest session for somebody else's site,
 * or for a reader of this one, is not enough.
 *
 * Two doors, because decision 24 gives the owner two credentials and both are
 * legitimately theirs:
 *
 * - the **guest cookie**, which is how they read their own site in a browser;
 * - an **agent bearer token**, which only the owner address can ever obtain
 *   (`app/api/auth/request` refuses to issue one to anybody else) and which is
 *   how a script or an agent approves someone.
 *
 * A journal with no `owner.email` has no owner, and therefore no admin surface.
 * That is the right default: it fails closed.
 */
export async function isOwner(username: string, request?: Request): Promise<boolean> {
  const user = getUser(username);
  if (!user?.owner.email) return false;
  const ownerEmail = user.owner.email;

  const jar = await cookies();
  const guest = await resolveSession(jar.get(GUEST_COOKIE)?.value, "guest");
  if (guest && guest.owner === username && guest.email === ownerEmail) return true;

  const header = request?.headers.get("authorization") ?? "";
  const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : undefined;
  const agent = await resolveSession(bearer, "agent");
  return Boolean(agent && agent.owner === username && agent.email === ownerEmail);
}

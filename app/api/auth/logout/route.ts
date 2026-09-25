import { cookies } from "next/headers";
import { GUEST_COOKIE, IDENTITY_COOKIE, resolveSession, revokeSession } from "@/lib/auth";
import { isEnabled } from "@/lib/capabilities";

export const dynamic = "force-dynamic";

/**
 * Ends a reader's session, on the server as well as in the browser.
 *
 * **Both credentials, always.** Since B410 a browser may hold a journal
 * session, an instance-wide identity, or one of each, and "sign out" means the
 * same thing to the person whichever they are looking at. Ending only the
 * journal session would leave the identity live, and the very next page load
 * would resolve the same address through it and put them straight back where
 * they were — a sign-out button that visibly does nothing.
 */
export async function POST() {
  if (!isEnabled("auth")) {
    return Response.json({ error: "auth_disabled" }, { status: 404 });
  }

  const jar = await cookies();

  // Revoked server-side too: clearing only the cookie would leave a working
  // token behind for anyone who had copied it.
  const session = await resolveSession(jar.get(GUEST_COOKIE)?.value, "guest");
  if (session) await revokeSession(session.id);

  const identity = await resolveSession(jar.get(IDENTITY_COOKIE)?.value, "identity");
  if (identity) await revokeSession(identity.id);

  jar.delete(GUEST_COOKIE);
  jar.delete(IDENTITY_COOKIE);
  return Response.json({ ok: true });
}

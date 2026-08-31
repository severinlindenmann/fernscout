import { cookies } from "next/headers";
import { GUEST_COOKIE, resolveSession, revokeSession } from "@/lib/auth";
import { isEnabled } from "@/lib/capabilities";

export const dynamic = "force-dynamic";

/** Ends a guest session, on the server as well as in the browser. */
export async function POST() {
  if (!isEnabled("auth")) {
    return Response.json({ error: "auth_disabled" }, { status: 404 });
  }

  const jar = await cookies();
  const token = jar.get(GUEST_COOKIE)?.value;

  // Revoked server-side too: clearing only the cookie would leave a working
  // token behind for anyone who had copied it.
  const session = await resolveSession(token, "guest");
  if (session) await revokeSession(session.id);

  jar.delete(GUEST_COOKIE);
  return Response.json({ ok: true });
}

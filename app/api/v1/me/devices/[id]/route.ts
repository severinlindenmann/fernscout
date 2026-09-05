import { listIdentities, revokeSession } from "@/lib/auth";
import { resolveIdentity } from "@/lib/auth/handshake";
import { isEnabled } from "@/lib/capabilities";

export const dynamic = "force-dynamic";

/**
 * End one device's identity — B411.
 *
 * The revocation surface belongs to the person whose credential it is, which
 * is why it lives here and not on any journal owner's page. An identity spans
 * journals: revoking it from one owner's contacts page would sign the reader
 * out of a different owner's journal, which is not that owner's call. Revoking
 * the *grant* is the tool there, and it already exists.
 *
 * **The id is checked against this address's own list**, not merely revoked.
 * `sessions.id` is a UUID and unguessable, but "unguessable" is not an
 * authorisation model — a caller who came by one anywhere at all must not be
 * able to sign somebody else out. `listIdentities` is scoped to the address on
 * the credential presented, so an id belonging to anybody else is simply not
 * in the list and answers 404.
 */
export async function DELETE(_request: Request, context: RouteContext<"/api/v1/me/devices/[id]">) {
  if (!isEnabled("auth")) {
    return Response.json({ error: "auth_disabled" }, { status: 404 });
  }

  const identity = await resolveIdentity();
  if (!identity) {
    return Response.json({ error: "not_signed_in" }, { status: 401 });
  }

  const { id } = await context.params;
  const mine = (await listIdentities(identity.email)).find((row) => row.id === id);
  if (!mine) {
    return Response.json({ error: "no_such_device" }, { status: 404 });
  }

  await revokeSession(mine.id);

  // Signing *this* device out is allowed and is the ordinary "sign out"
  // button. The cookie is left in place deliberately: the token behind it is
  // dead, so the next request resolves to nobody, and clearing it here would
  // make the two paths differ for no gain. The page reloads either way.
  return Response.json({ ok: true, current: mine.id === identity.id });
}

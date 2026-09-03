import { isEnabled } from "@/lib/capabilities";
import { listInvites, revokeInvite } from "@/lib/contacts/invites";
import { isOwner } from "@/lib/contacts/session";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/**
 * Revoke one link — B33.
 *
 * The half of this that makes leaving the shared password behind worth
 * anything: a password could only be changed, which cut off everybody at once.
 * A link is one row, and killing it stops the people who have not used it yet
 * while **everybody already approved stays exactly where they are**. Access
 * lives in `access_grants` and `trip_people`, and nothing here touches either.
 *
 * Unlike deleting a journal or a trip, this needs no mailed confirmation. It
 * is reversible in the only sense that matters — issue another link — and it
 * removes nothing anybody wrote.
 */
export async function DELETE(
  request: Request,
  { params }: RouteContext<"/api/v1/[user]/invites/[id]">,
) {
  const { user, id } = await params;

  if (!getUser(user) || !isEnabled("contacts", user)) {
    return Response.json({ error: "contacts_disabled" }, { status: 404 });
  }
  if (!(await isOwner(user, request))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  // Checked first so that "no such link" and "revoked" are distinguishable to
  // the one caller entitled to the difference. `revokeInvite` is an UPDATE and
  // would answer the same either way.
  const invite = (await listInvites(user)).find((row) => row.id === id);
  if (!invite) return Response.json({ error: "unknown_invite" }, { status: 404 });

  await revokeInvite(user, id);
  return Response.json({
    ok: true,
    id,
    revoked: true,
    note: "The link stops working. Everybody you already approved stays in.",
  });
}

import { isEnabled } from "@/lib/capabilities";
import { listInvites, revokeInvite } from "@/lib/contacts/invites";
import { isOwner } from "@/lib/contacts/session";

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
 *
 * **Ownership checked before the capability, same order as `.../invites` —
 * B340.** `isOwner` refuses a journal that does not exist and one that is not
 * this caller's alike, so that check goes first and stays the only thing an
 * uninvolved caller ever sees; only a proven owner, for whom the journal's
 * existence is not in question, is told *why* — `contacts_disabled` rather
 * than a `404` shaped like "no such link".
 */
export async function DELETE(
  request: Request,
  { params }: RouteContext<"/api/v1/[user]/invites/[id]">,
) {
  const { user, id } = await params;

  if (!(await isOwner(user, request))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  if (!isEnabled("contacts", user)) {
    return Response.json({ error: "contacts_disabled" }, { status: 409 });
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

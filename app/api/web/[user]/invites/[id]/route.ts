// DELETE /api/web/{user}/invites/{id} — revoke one link, from a cookie —
// B1595 (v2 migration, web proxies for invites/channels).
//
// B2295 (one door for readers, B2291): the agent bearer equivalent this
// used to proxy for is gone — revoking an invite link happens only from
// `/<user>/studio/readers`. `isOwner` on the cookie only; any
// `Authorization` header is refused outright, not pointed elsewhere.
//
// Revoking an invite grants nothing and takes nothing away that was already
// granted (`lib/contacts/invites.ts`'s own doc comment) — it only stops
// people who have not used the link yet.
import { inviteDeleteResponse } from "@/lib/contacts/invitesResponse";
import { contactsReady } from "@/lib/api/v2/social";
import { isOwner } from "@/lib/contacts/session";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

const NOT_FOR_AGENTS = {
  error: "not_for_agents",
  message:
    "This is the owner's own door, from a browser. Revoking an invite link happens only from " +
    "Studio › Readers, in the owner's own browser — there is no agent bearer equivalent.",
};

export async function DELETE(
  request: Request,
  { params }: RouteContext<"/api/web/[user]/invites/[id]">,
) {
  if (request.headers.get("authorization")) {
    return Response.json(NOT_FOR_AGENTS, { status: 403 });
  }
  const { user, id } = await params;
  if (!getUser(user)) return Response.json({ error: "unknown_user" }, { status: 404 });
  if (!(await isOwner(user))) return Response.json({ error: "forbidden" }, { status: 403 });
  const ready = await contactsReady(user);
  if (!ready.ok) return ready.response;
  return inviteDeleteResponse(user, id, request);
}

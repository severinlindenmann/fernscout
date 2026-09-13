// DELETE /api/web/{user}/invites/{id} — revoke one link, from a cookie —
// B1595 (v2 migration, web proxies for invites/channels).
//
// `isOwner` on the cookie only; any `Authorization` header is refused
// outright. Then `inviteDeleteResponse`, the exact function
// `DELETE /api/v2/{user}/invites/{id}` calls after its own bearer check, in
// process. No bearer token is minted, held, or sent anywhere for this call.
//
// Revoking an invite grants nothing and takes nothing away that was already
// granted (`lib/contacts/invites.ts`'s own doc comment) — it only stops
// people who have not used the link yet.
//
// Replaces `app/api/v1/[user]/invites/[id]/route.ts`, which answered both
// bearer and cookie callers from one door.
import { inviteDeleteResponse } from "@/app/api/v2/[user]/invites/[id]/route";
import { contactsReady } from "@/lib/api/v2/social";
import { isOwner } from "@/lib/contacts/session";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

const NOT_FOR_AGENTS = {
  error: "not_for_agents",
  message:
    "This is the owner's own door, from a browser. An agent revokes an invite with " +
    "DELETE /api/v2/{user}/invites/{id}.",
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

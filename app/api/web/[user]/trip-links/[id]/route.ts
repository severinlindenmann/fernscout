import { ownerOnly, PRIVATE } from "@/lib/readers/ownerDoor";
import { stopLinkAndKeepers } from "@/lib/tripLink";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/**
 * `DELETE /api/web/<user>/trip-links/<id>` — "Stop it and remove the people
 * who kept it" (B-2963): the link and every keep through it end together.
 * Plain Stop is `DELETE /invites/<id>` and leaves the keepers.
 */
export async function DELETE(request: Request, { params }: RouteContext<"/api/web/[user]/trip-links/[id]">) {
  const { user, id } = await params;
  if (!getUser(user)) return Response.json({ error: "unknown_user" }, { status: 404 });
  const denied = await ownerOnly(request, user);
  if (denied) return denied;
  if (!(await stopLinkAndKeepers(user, id))) {
    return Response.json({ error: "not_found" }, { status: 404, headers: PRIVATE });
  }
  return Response.json({ id, revoked: true, keepersRemoved: true }, { headers: PRIVATE });
}

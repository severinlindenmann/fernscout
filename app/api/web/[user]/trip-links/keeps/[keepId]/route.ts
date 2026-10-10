import { ownerOnly, PRIVATE } from "@/lib/readers/ownerDoor";
import { removeKeep } from "@/lib/tripLink";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/** `DELETE /api/web/<user>/trip-links/keeps/<keepId>` — Remove one trip a person saved (B-2963). */
export async function DELETE(
  request: Request,
  { params }: RouteContext<"/api/web/[user]/trip-links/keeps/[keepId]">,
) {
  const { user, keepId } = await params;
  if (!getUser(user)) return Response.json({ error: "unknown_user" }, { status: 404 });
  const denied = await ownerOnly(request, user);
  if (denied) return denied;
  if (!(await removeKeep(user, keepId))) {
    return Response.json({ error: "not_found" }, { status: 404, headers: PRIVATE });
  }
  return Response.json({ id: keepId, removed: true }, { headers: PRIVATE });
}

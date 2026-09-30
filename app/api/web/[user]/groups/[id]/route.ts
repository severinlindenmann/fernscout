import { readJsonBody } from "@/lib/api/jsonBody";
import { deleteGroup, GROUP_ERROR_STATUS, updateGroup } from "@/lib/contacts/groups";
import { ownerOnly, PRIVATE } from "@/lib/readers/ownerDoor";

export const dynamic = "force-dynamic";

/**
 * `PATCH|DELETE /api/web/<user>/groups/<id>` — rename or recolour one reader
 * group, or delete it (TIX-6). Owner's own door (`ownerOnly`).
 *
 * DELETE lets go of everybody in it and nothing else: they keep reading, and
 * the answer lists who they were so the page can offer Undo (POST
 * `…/groups` with `members`).
 */
export async function PATCH(request: Request, { params }: RouteContext<"/api/web/[user]/groups/[id]">) {
  const { user, id } = await params;
  const denied = await ownerOnly(request, user);
  if (denied) return denied;
  const jsonBody = await readJsonBody(request);
  if (!jsonBody.ok) return jsonBody.response;
  const body = (jsonBody.value ?? {}) as Record<string, unknown>;
  const updated = await updateGroup(user, id, { name: body.name, color: body.color });
  if (!updated.ok) {
    return Response.json({ error: updated.error }, { status: GROUP_ERROR_STATUS[updated.error], headers: PRIVATE });
  }
  return Response.json({ ok: true, group: updated.value }, { headers: PRIVATE });
}

export async function DELETE(request: Request, { params }: RouteContext<"/api/web/[user]/groups/[id]">) {
  const { user, id } = await params;
  const denied = await ownerOnly(request, user);
  if (denied) return denied;
  const deleted = await deleteGroup(user, id);
  if (!deleted.ok) {
    return Response.json({ error: deleted.error }, { status: GROUP_ERROR_STATUS[deleted.error], headers: PRIVATE });
  }
  return Response.json({ ok: true, members: deleted.value }, { headers: PRIVATE });
}

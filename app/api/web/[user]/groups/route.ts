import { readJsonBody } from "@/lib/api/jsonBody";
import { createGroup, GROUP_ERROR_STATUS, listGroups, restoreGroupMembers } from "@/lib/contacts/groups";
import { ownerOnly, PRIVATE } from "@/lib/readers/ownerDoor";

export const dynamic = "force-dynamic";

/**
 * `GET|POST /api/web/<user>/groups` — the owner's reader groups (TIX-6).
 *
 * The owner's own door, from a browser, like every door on Studio › Readers
 * (`ownerOnly`: no bearer token, no foreign origin, owner cookie). A group is
 * a label for who is told — creating one opens nothing for anybody.
 *
 * POST `{ name, color?, members? }`. `members` is the Undo after a delete:
 * `{ contactIds, inviteIds }` exactly as the DELETE answered them, put back
 * into the new group — only rows of this owner's, so a guessed id is a no-op.
 */
export async function GET(request: Request, { params }: RouteContext<"/api/web/[user]/groups">) {
  const { user } = await params;
  const denied = await ownerOnly(request, user);
  if (denied) return denied;
  return Response.json({ groups: await listGroups(user) }, { headers: PRIVATE });
}

export async function POST(request: Request, { params }: RouteContext<"/api/web/[user]/groups">) {
  const { user } = await params;
  const denied = await ownerOnly(request, user);
  if (denied) return denied;
  const jsonBody = await readJsonBody(request);
  if (!jsonBody.ok) return jsonBody.response;
  const body = (jsonBody.value ?? {}) as Record<string, unknown>;

  const created = await createGroup(user, { name: body.name, color: body.color });
  if (!created.ok) {
    return Response.json({ error: created.error }, { status: GROUP_ERROR_STATUS[created.error], headers: PRIVATE });
  }
  const members = body.members as { contactIds?: unknown; inviteIds?: unknown } | undefined;
  if (members && typeof members === "object") {
    await restoreGroupMembers(user, created.value.id, {
      contactIds: stringList(members.contactIds),
      inviteIds: stringList(members.inviteIds),
    });
  }
  return Response.json({ ok: true, group: created.value }, { status: 201, headers: PRIVATE });
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string").slice(0, 5000) : [];
}

import { applyVisitedDelete, applyVisitedPatch } from "@/lib/api/v2/visitedApply";
import { isOwner } from "@/lib/contacts/session";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

// PATCH/DELETE /api/web/{user}/visited/{code} — the owner's own door, from a
// browser cookie (B2914); the handlers are the v2 route's own.
async function gate(request: Request, user: string): Promise<Response | null> {
  if (request.headers.get("authorization")) {
    return Response.json(
      { error: "not_for_agents", message: "This is the owner's own door, from a browser. An agent uses /api/v2/{user}/visited/{code}." },
      { status: 403 },
    );
  }
  if (!getUser(user)) return Response.json({ error: "unknown_user" }, { status: 404 });
  if (!(await isOwner(user))) return Response.json({ error: "forbidden" }, { status: 403 });
  return null;
}

export async function PATCH(request: Request, { params }: RouteContext<"/api/web/[user]/visited/[code]">) {
  const { user, code } = await params;
  return (await gate(request, user)) ?? applyVisitedPatch(user, code, request);
}

export async function DELETE(request: Request, { params }: RouteContext<"/api/web/[user]/visited/[code]">) {
  const { user, code } = await params;
  return (await gate(request, user)) ?? applyVisitedDelete(user, code);
}

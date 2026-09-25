// PUT /api/web/{user}/figures/{id} — the figure creator's own door, from a
// cookie — B2021. Same shape as the trip's `.../plan` and `.../visibility`
// doors beside this one: `applyFigurePut` (the same function
// `.../figures/{id}/route.ts` calls for a bearer token) is the one place
// that parses, validates and writes a figure, so a figure saved from the
// studio and one saved by an agent read back identically.
import { applyFigureDelete, applyFigurePut } from "@/app/api/v2/[user]/figures/[id]/route";
import { isOwner } from "@/lib/contacts/session";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

const NOT_FOR_AGENTS = {
  error: "not_for_agents",
  message:
    "This is the owner's own door, from a browser. An agent writes a figure with " +
    "PUT /api/v2/{user}/figures/{id}.",
};

const NOT_FOR_AGENTS_DELETE = {
  error: "not_for_agents",
  message:
    "This is the owner's own door, from a browser. An agent deletes a figure with " +
    "DELETE /api/v2/{user}/figures/{id}.",
};

export async function PUT(request: Request, { params }: RouteContext<"/api/web/[user]/figures/[id]">) {
  if (request.headers.get("authorization")) {
    return Response.json(NOT_FOR_AGENTS, { status: 403 });
  }

  const { user, id } = await params;
  if (!getUser(user)) return Response.json({ error: "unknown_user" }, { status: 404 });
  if (!(await isOwner(user))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  return applyFigurePut(user, id, request);
}

// DELETE /api/web/{user}/figures/{id} — B2022. Same shape as PUT above:
// `applyFigureDelete` is the one place that checks references and writes,
// so a delete pressed in the studio and one issued by an agent answer the
// same refusal.
export async function DELETE(request: Request, { params }: RouteContext<"/api/web/[user]/figures/[id]">) {
  if (request.headers.get("authorization")) {
    return Response.json(NOT_FOR_AGENTS_DELETE, { status: 403 });
  }

  const { user, id } = await params;
  if (!getUser(user)) return Response.json({ error: "unknown_user" }, { status: 404 });
  if (!(await isOwner(user))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  return applyFigureDelete(user, id, request);
}

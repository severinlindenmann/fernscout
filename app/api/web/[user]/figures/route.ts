// GET /api/web/{user}/figures — the figure library, from a cookie — B2021.
// Read-only sibling of `GET /api/v2/{user}/figures` (bearer only): the
// People flow's "decide" and "draw them?" steps need to know whether an
// email already has a figure, and a browser holds no bearer token to ask
// the v2 route with (AGENTS.md: "Agent bearer tokens reach /api/**, not
// rendered owner pages"). Every figure a journal has may carry `person`, an
// email — not a vocabulary, so this is owner-only exactly like the v2 route.
import { listFiguresPage, DEFAULT_FIGURES_LIMIT } from "@/lib/figures";
import { isOwner } from "@/lib/contacts/session";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

const NOT_FOR_AGENTS = {
  error: "not_for_agents",
  message:
    "This is the owner's own door, from a browser. An agent reads the figure library with " +
    "GET /api/v2/{user}/figures.",
};

export async function GET(request: Request, { params }: RouteContext<"/api/web/[user]/figures">) {
  if (request.headers.get("authorization")) {
    return Response.json(NOT_FOR_AGENTS, { status: 403 });
  }

  const { user } = await params;
  if (!getUser(user)) return Response.json({ error: "unknown_user" }, { status: 404 });
  if (!(await isOwner(user))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const { items } = listFiguresPage(user, { limit: DEFAULT_FIGURES_LIMIT });
  return Response.json({ figures: items });
}

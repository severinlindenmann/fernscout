import { applyVisitedCreate } from "@/lib/api/v2/visitedApply";
import { FOREIGN_ORIGIN_REFUSAL, foreignOrigin } from "@/lib/auth/originCheck";
import { isOwner } from "@/lib/contacts/session";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

// POST /api/web/{user}/visited — the owner's own door, from a browser cookie
// (B2914). The same handler as `POST /api/v2/{user}/visited`; an agent token
// is refused here and uses that route instead.
export async function POST(request: Request, { params }: RouteContext<"/api/web/[user]/visited">) {
  if (request.headers.get("authorization")) {
    return Response.json(
      { error: "not_for_agents", message: "This is the owner's own door, from a browser. An agent uses POST /api/v2/{user}/visited." },
      { status: 403 },
    );
  }
  const { user } = await params;
  if (foreignOrigin(request)) return Response.json(FOREIGN_ORIGIN_REFUSAL, { status: 403 });
  if (!getUser(user)) return Response.json({ error: "unknown_user" }, { status: 404 });
  if (!(await isOwner(user))) return Response.json({ error: "forbidden" }, { status: 403 });
  return applyVisitedCreate(user, request);
}

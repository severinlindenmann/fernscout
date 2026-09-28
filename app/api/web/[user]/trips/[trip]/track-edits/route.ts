// GET/PUT /api/web/{user}/trips/{trip}/track-edits — the studio's own door
// onto one trip's hidden spots, hidden stretches and named stretches, from a
// cookie — B2539, D8 C.
//
// `isOwner` on the cookie only, any `Authorization` header refused outright,
// then `trackEditsGetDoc`/`trackEditsPutResponse`, the exact functions
// `GET`/`PUT /api/v2/{user}/trips/{trip}/track-edits` call after their own
// bearer check, in process — the same split `gps/zones`' web wrapper uses.
import { trackEditsGetDoc, trackEditsPutResponse } from "@/app/api/v2/[user]/trips/[trip]/track-edits/route";
import { isOwner } from "@/lib/contacts/session";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

const NOT_FOR_AGENTS = {
  error: "not_for_agents",
  message:
    "This is the owner's own door, from a browser. An agent reads or writes a trip's hidden " +
    "spots and stretches with GET/PUT /api/v2/{user}/trips/{trip}/track-edits.",
};

async function guard(user: string): Promise<Response | null> {
  if (!getUser(user)) return Response.json({ error: "unknown_user" }, { status: 404 });
  if (!(await isOwner(user))) return Response.json({ error: "forbidden" }, { status: 403 });
  return null;
}

export async function GET(request: Request, { params }: RouteContext<"/api/web/[user]/trips/[trip]/track-edits">) {
  if (request.headers.get("authorization")) {
    return Response.json(NOT_FOR_AGENTS, { status: 403 });
  }
  const { user, trip } = await params;
  const denied = await guard(user);
  if (denied) return denied;
  return trackEditsGetDoc(user, trip);
}

export async function PUT(request: Request, { params }: RouteContext<"/api/web/[user]/trips/[trip]/track-edits">) {
  if (request.headers.get("authorization")) {
    return Response.json(NOT_FOR_AGENTS, { status: 403 });
  }
  const { user, trip } = await params;
  const denied = await guard(user);
  if (denied) return denied;
  return trackEditsPutResponse(user, trip, request);
}

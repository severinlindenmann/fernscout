// GET/PUT /api/web/{user}/gps/zones — the studio's own door onto private
// zones, from a cookie — B2203.
//
// `isOwner` on the cookie only, any `Authorization` header refused outright,
// then `zonesGetDoc`/`zonesPutResponse`, the exact functions
// `GET`/`PUT /api/v2/{user}/gps/zones` call after their own bearer check, in
// process — the same split `channels`' web wrapper uses.
import { zonesGetDoc, zonesPutResponse } from "@/app/api/v2/[user]/gps/zones/route";
import { isOwner } from "@/lib/contacts/session";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

const NOT_FOR_AGENTS = {
  error: "not_for_agents",
  message:
    "This is the owner's own door, from a browser. An agent reads or writes zones with " +
    "GET/PUT /api/v2/{user}/gps/zones.",
};

async function guard(user: string): Promise<Response | null> {
  if (!getUser(user)) return Response.json({ error: "unknown_user" }, { status: 404 });
  if (!(await isOwner(user))) return Response.json({ error: "forbidden" }, { status: 403 });
  return null;
}

export async function GET(request: Request, { params }: RouteContext<"/api/web/[user]/gps/zones">) {
  if (request.headers.get("authorization")) {
    return Response.json(NOT_FOR_AGENTS, { status: 403 });
  }
  const { user } = await params;
  const denied = await guard(user);
  if (denied) return denied;
  return zonesGetDoc(user);
}

export async function PUT(request: Request, { params }: RouteContext<"/api/web/[user]/gps/zones">) {
  if (request.headers.get("authorization")) {
    return Response.json(NOT_FOR_AGENTS, { status: 403 });
  }
  const { user } = await params;
  const denied = await guard(user);
  if (denied) return denied;
  return zonesPutResponse(user, request);
}

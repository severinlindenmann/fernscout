// POST /api/web/{user}/trips/{trip}/rename — the owner's own door, from a
// cookie — B2015. Same shape as .../visibility/route.ts beside this file:
// `isOwner` on the cookie only, any `Authorization` header refused outright,
// no bearer token minted or read for this call. An agent renames a trip with
// POST /api/v2/{user}/trips/{trip}/rename instead.
import { isValidTripId, renameTrip } from "@/lib/tripRename";
import { isOwner } from "@/lib/contacts/session";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

const NOT_FOR_AGENTS = {
  error: "not_for_agents",
  message:
    "This is the owner's own door, from a browser. An agent renames a trip with " +
    "POST /api/v2/{user}/trips/{trip}/rename.",
};

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/web/[user]/trips/[trip]/rename">,
) {
  if (request.headers.get("authorization")) {
    return Response.json(NOT_FOR_AGENTS, { status: 403 });
  }

  const { user, trip } = await params;
  if (!getUser(user)) return Response.json({ error: "unknown_user" }, { status: 404 });
  if (!(await isOwner(user))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const id = body && typeof body.id === "string" ? body.id : "";
  if (!isValidTripId(id)) {
    return Response.json({ error: "invalid_trip_id" }, { status: 400 });
  }

  const renamed = await renameTrip(user, trip, id);
  if (!renamed.ok) {
    const status = renamed.error === "trip_id_taken" ? 409 : renamed.error === "unknown_trip" ? 404 : 400;
    return Response.json({ error: renamed.error }, { status });
  }

  return Response.json({ ok: true, id: renamed.id });
}

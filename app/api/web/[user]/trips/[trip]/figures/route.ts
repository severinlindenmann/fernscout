// PATCH /api/web/{user}/trips/{trip}/figures — a trip's own party, from a
// cookie — B2022, same shape as the sibling `.../plan` route beside this
// one (B2011). v2 has no separate `/figures` call: `figures` is a section
// of the trip document itself, and `applyTripPatch` (the same function
// `.../trips/{trip}/route.ts` calls) already merge-patches it with every
// other field. This door exists anyway, narrowed to exactly that key,
// because the figure library's "per trip" picker is a browser flow with no
// bearer token to hold — AGENTS.md: "Agent bearer tokens reach /api/**, not
// rendered owner pages." `isOwner` (cookie only) is the gate; any
// `Authorization` header is refused outright, and nothing is minted for the
// browser to hold. `applyTripPatch("sections")` is what lets this write land
// on a trip the studio made with every other section still open (B2011's own
// reasoning), and what retracts a stored `declined.figures` the moment
// `figures` is supplied (T6, the same mechanism the plan door already
// relies on).
import { applyTripPatch } from "@/app/api/v2/[user]/trips/[trip]/route";
import { isOwner } from "@/lib/contacts/session";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

const NOT_FOR_AGENTS = {
  error: "not_for_agents",
  message:
    "This is the owner's own door, from a browser. An agent changes which figures walk a trip with " +
    "PATCH /api/v2/{user}/trips/{trip}.",
};

const ALLOWED = ["figures", "declined"];

export async function PATCH(
  request: Request,
  { params }: RouteContext<"/api/web/[user]/trips/[trip]/figures">,
) {
  if (request.headers.get("authorization")) {
    return Response.json(NOT_FOR_AGENTS, { status: 403 });
  }

  const { user, trip } = await params;
  const journal = getUser(user);
  if (!journal) return Response.json({ error: "unknown_user" }, { status: 404 });
  if (!(await isOwner(user))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const clone = request.clone();
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  if (Object.keys(body).some((key) => !ALLOWED.includes(key))) {
    return Response.json({ error: "unsupported_field" }, { status: 400 });
  }

  return applyTripPatch(user, trip, journal, clone, "sections");
}

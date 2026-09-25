// PATCH /api/web/{user}/trips/{trip}/plan — the planner's own door, from a
// cookie — B2011, same shape as the sibling `.../visibility` route beside
// this one (B1595).
//
// v2 has no separate `/plan` call: `plan` and `costs` are sections of the
// trip document itself, and `applyTripPatch` (the same function
// `.../trips/{trip}/route.ts` calls) already merge-patches them with every
// other field. This door exists anyway, narrowed to exactly those two keys,
// because `PlannerFlow` is a browser flow with no bearer token to hold —
// AGENTS.md: "Agent bearer tokens reach /api/**, not rendered owner pages."
// `isOwner` (cookie only) is the gate; any `Authorization` header is refused
// outright, and nothing is minted for the browser to hold.
import { applyTripPatch } from "@/app/api/v2/[user]/trips/[trip]/route";
import { isOwner } from "@/lib/contacts/session";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

const NOT_FOR_AGENTS = {
  error: "not_for_agents",
  message:
    "This is the owner's own door, from a browser. An agent changes a trip's plan or costs with " +
    "PATCH /api/v2/{user}/trips/{trip}.",
};

const ALLOWED = ["plan", "costs", "declined"];

export async function PATCH(request: Request, { params }: RouteContext<"/api/web/[user]/trips/[trip]/plan">) {
  if (request.headers.get("authorization")) {
    return Response.json(NOT_FOR_AGENTS, { status: 403 });
  }

  const { user, trip } = await params;
  const journal = getUser(user);
  if (!journal) return Response.json({ error: "unknown_user" }, { status: 404 });
  if (!(await isOwner(user))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  // Read the body twice on purpose, same reasoning as `.../visibility`: once
  // here to keep this door narrow, once inside `applyTripPatch`, which is
  // the one place that actually parses and validates it.
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

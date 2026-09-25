// PATCH /api/web/{user}/trips/{trip}/visibility — who may read a trip, from
// a cookie — B1595 (v2 migration, phase 2 step 5).
//
// v2 has no separate visibility call: `visibility`, `listed` and `teaser`
// are fields on the trip document itself, and `applyTripPatch` (the same
// function `.../trips/{trip}/route.ts` beside this file calls) already
// merge-patches them with every other field. This door exists anyway,
// narrowed to exactly those three keys, because the panel that asks "who
// can see this" is not the same panel as the one correcting a typo in the
// title — B1585's reasoning for keeping the two questions apart survives the
// storage change even though one function now answers both. `isOwner` on the
// cookie only; any `Authorization` header is refused outright, and no bearer
// token is minted, held, or sent anywhere for this call.
//
// Replaces `app/[user]/trips/[trip]/visibility/route.ts`, which wrote
// through v1's `patchTripVisibility` against the pre-B1598 file shape.
import { applyTripPatch } from "@/app/api/v2/[user]/trips/[trip]/route";
import { isOwner } from "@/lib/contacts/session";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

const NOT_FOR_AGENTS = {
  error: "not_for_agents",
  message:
    "This is the owner's own door, from a browser. An agent changes a trip's visibility with " +
    "PATCH /api/v2/{user}/trips/{trip}.",
};

const ALLOWED = ["visibility", "listed", "teaser"];

export async function PATCH(
  request: Request,
  { params }: RouteContext<"/api/web/[user]/trips/[trip]/visibility">,
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

  // Read the body twice on purpose: once here, to keep this door narrow, and
  // once inside `applyTripPatch`, which is the one place that actually
  // parses and validates it. Cloning the request means the second read still
  // sees the same bytes.
  const clone = request.clone();
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  if (Object.keys(body).some((key) => !ALLOWED.includes(key))) {
    return Response.json({ error: "unsupported_field" }, { status: 400 });
  }

  // "sections", like the plan and figures doors beside this one (B2011):
  // the owner is answering one question, and a trip made in the studio
  // still has costs, figures, teaser and more open. In "whole" mode the
  // studio's first PATCH answered 422 for every one of those (B2071).
  // `reconcileVisibility` still drops a stale listed/teaser across the
  // public line, and the fields sent are still validated by their schema.
  return applyTripPatch(user, trip, journal, clone, "sections");
}

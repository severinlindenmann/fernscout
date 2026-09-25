// PATCH /api/web/{user}/trips/{trip}/plan-readers — what a reader sees of the
// plan, from a cookie — B2012, beside .../visibility (who may read the trip
// at all). Same shape as that route: owner-cookie only, narrowed to exactly
// one field, and merge-patched through `applyTripPatch` — the same door an
// agent's PATCH /api/v2/{user}/trips/{trip} would use.
//
// `plan` is a whole section (unlike `visibility`/`listed`/`teaser`, three
// plain scalars on the trip document itself): v2's merge-patch replaces a
// named key wholesale rather than deep-merging inside it, so changing only
// `readers` means re-sending the stored `plan` object with that one field
// swapped — done here, against what is on disk right now, rather than
// asking the browser to hold and echo back a route it never edited.
import { applyTripPatch } from "@/app/api/v2/[user]/trips/[trip]/route";
import { isOwner } from "@/lib/contacts/session";
import { getUser } from "@/lib/users";
import { readTripFile } from "@/lib/api/v2/store";
import { PLAN_READERS } from "@/lib/tripWrite";

export const dynamic = "force-dynamic";

const NOT_FOR_AGENTS = {
  error: "not_for_agents",
  message:
    "This is the owner's own door, from a browser. An agent sets a trip's plan.readers with " +
    "PATCH /api/v2/{user}/trips/{trip}.",
};

export async function PATCH(
  request: Request,
  { params }: RouteContext<"/api/web/[user]/trips/[trip]/plan-readers">,
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

  const body = (await request.json().catch(() => null)) as { readers?: unknown } | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!PLAN_READERS.includes(body.readers as (typeof PLAN_READERS)[number])) {
    return Response.json(
      { error: "invalid_readers", message: `readers must be one of ${PLAN_READERS.join(", ")}` },
      { status: 400 },
    );
  }

  const stored = readTripFile(user, trip);
  if (!stored?.plan) {
    return Response.json({ error: "no_plan" }, { status: 404 });
  }

  const merged = new Request(request.url, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ plan: { ...stored.plan, readers: body.readers } }),
  });
  return applyTripPatch(user, trip, journal, merged, "sections");
}

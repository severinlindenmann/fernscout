import { authenticate, errorResponse, mayActAsOwner, mayWriteTrip, outOfScope, ownsUser, refuseWrite } from "@/lib/api/auth";
import { putPlan, type PlanFileInput } from "@/lib/api/plan";
import { getPlan, readPlanFileRaw } from "@/lib/plan";
import { getTrip, tripRef } from "@/lib/trips";
import { validatePlanPut } from "@/lib/validate/plan";

export const dynamic = "force-dynamic";

const FIELDS = ["route", "body"] as const;

async function resolve(request: Request, user: string, trip: string) {
  const auth = await authenticate(request);
  if (!auth.ok) return { ok: false as const, response: errorResponse(auth) };

  if (!ownsUser(auth.session, user)) {
    return { ok: false as const, response: outOfScope(auth.session, user) };
  }

  const ref = tripRef(user, trip);
  const found = getTrip(ref);
  if (!found) return { ok: false as const, response: Response.json({ error: "unknown_trip" }, { status: 404 }) };

  // `mayWriteTrip` rather than a separate read gate: every bearer token this
  // server issues is either the journal's own (`write:content`, the owner)
  // or scoped to one trip's `people:` (a trip-scoped agent token) — there is
  // no third kind that can authenticate here and read without also being
  // able to write. The wider "whoever may read the trip" population the
  // ticket asks this route to match — a journal guest who has never
  // written a word — only ever holds a browser cookie, never a bearer
  // token (see AGENTS.md, "Agent tokens arrive in Authorization: Bearer and
  // nowhere else"), so it cannot reach this door at all. Reusing the write
  // gate here is not a narrower read gate in disguise; it is the same gate,
  // because for this credential the two populations are identical.
  const gate = await mayWriteTrip(auth.session, found);
  if (!gate.ok) return { ok: false as const, response: refuseWrite(gate) };

  return { ok: true as const, ref, session: auth.session };
}

/**
 * A trip's plan.md — the intended route, for a journey that has not
 * happened yet — B909.
 *
 * Read and written over REST only, `GET` and `PUT`. No `PATCH`, no `DELETE`:
 * a route is a short list, and resending it whole is not the burden it
 * would be for costs.md.
 *
 * **No model-facing tool reaches this door, and that is deliberate rather
 * than an oversight.** The owner has asked for a future planner — "I want
 * to go to Japan in September, plan me a trip" — that would write here on a
 * person's behalf, echoing places they actually named. That is a different
 * act from a model inventing an itinerary unprompted, and this ticket ships
 * the document the first act would write to without building the act
 * itself: a plain, ordinary authenticated route, with no rule anywhere
 * saying a model may never call it, so the door stays open for the tool
 * that has not been built yet.
 *
 * **Authority is reader-shaped, not writer-shaped, in intent** — the trip
 * page and the map already show a guest-approved reader's browser this same
 * plan.md, via `readFor(trip)` then `getPlan`, so refusing that reader here
 * would mean the API doing less than the page it exists to replace. In
 * practice the only credential this door accepts is a bearer token, and
 * every bearer token this server mints is already owner- or trip-scoped —
 * see the comment on `resolve` above for why that makes the write gate the
 * whole of the read gate here.
 *
 * **Draft-derived stops stay owner-only**, though, and that is a real
 * narrowing: `getPlan`'s own `includeDrafts` folds a trip's future-dated
 * drafts in as extra stops, on the reasoning that "a reader must not learn
 * where somebody is going next" (lib/plan.ts). A trip-scoped token is
 * somebody the journal's owner named in `people:` — real, but not the
 * owner — so this asks `mayActAsOwner` before setting it, the same
 * question the write API's owner-only doors already ask.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/v1/[user]/trips/[trip]/plan">,
) {
  const { user, trip } = await params;
  const resolved = await resolve(request, user, trip);
  if (!resolved.ok) return resolved.response;
  const { ref, session } = resolved;

  const includeDrafts = mayActAsOwner(session, user);
  const plan = getPlan(ref, { includeDrafts, reader: "person" });
  const parsed = readPlanFileRaw(ref);

  return Response.json({
    trip: ref,
    // Whether plan.md exists at all — `false` here is not an error, it is
    // the same answer an empty drafts list gives (see .../costs' `exists`).
    exists: parsed !== null,
    stops: plan.stops,
    reachedCount: plan.reachedCount,
    next: plan.next ?? null,
    // Whether the future-dated drafts a trip-scoped token cannot see were
    // even asked for — so a caller that is not the owner knows why its
    // `stops` list may be shorter than what the trip page shows them.
    draftsIncluded: includeDrafts,
    body: parsed ? parsed.content.trim() : "",
  });
}

/**
 * Write the whole plan.md — the route and the trip's own prose about it, in
 * one call. Replaces the file entirely, same as `PUT .../costs`: send the
 * route even if nothing about it is changing.
 *
 * `route` is a list of stops the map can plot — each needs at least a
 * `location` and a real `lat`/`lng` — and it is where a person's own words
 * for a place they named belong, never a model's invention of one they did
 * not (see the module comment above).
 */
export async function PUT(
  request: Request,
  { params }: RouteContext<"/api/v1/[user]/trips/[trip]/plan">,
) {
  const { user, trip } = await params;
  const resolved = await resolve(request, user, trip);
  if (!resolved.ok) return resolved.response;
  const { ref } = resolved;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const unsupported = Object.keys(body).filter((k) => !(FIELDS as readonly string[]).includes(k));
  if (unsupported.length > 0) {
    return Response.json(
      {
        error: "unsupported_field",
        message:
          `This call writes ${unsupported.map((k) => JSON.stringify(k)).join(", ")} for nobody. ` +
          `This endpoint writes ${FIELDS.join(", ")}.`,
      },
      { status: 400 },
    );
  }

  const problems = validatePlanPut(body);
  if (problems.length > 0) {
    return Response.json({ error: "invalid_plan", problems }, { status: 400 });
  }

  const result = putPlan(ref, body as PlanFileInput);
  if (!result.ok) {
    const status = result.bug ? 500 : result.error === "unknown_trip" ? 404 : 400;
    return Response.json({ error: result.error }, { status });
  }

  return Response.json({
    ok: true,
    trip: ref,
    note:
      "plan.md now exists (or was replaced) for this trip. GET this same URL to read it back " +
      "before telling the owner it is there.",
  });
}

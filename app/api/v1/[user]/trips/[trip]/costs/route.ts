import { authenticate, errorResponse, mayWriteTrip, ownsUser, refuseWrite } from "@/lib/api/auth";
import { deleteCosts, patchCosts, putCosts, type CostsEditInput, type CostsFileInput } from "@/lib/api/costs";
import { conversionFor, readCostsFile } from "@/lib/costs";
import { parseBudget, parseCostItems } from "@/lib/costFormat";
import { getTrip, tripRef } from "@/lib/trips";
import { validateCostsPatch, validateCostsPut } from "@/lib/validate/costs";

export const dynamic = "force-dynamic";

const FIELDS = ["budget", "costs", "body"] as const;

async function resolve(request: Request, user: string, trip: string) {
  const auth = await authenticate(request);
  if (!auth.ok) return { ok: false as const, response: errorResponse(auth) };

  if (!ownsUser(auth.session, user)) {
    return { ok: false as const, response: Response.json({ error: "out_of_scope" }, { status: 403 }) };
  }

  const ref = tripRef(user, trip);
  const found = getTrip(ref);
  if (!found) return { ok: false as const, response: Response.json({ error: "unknown_trip" }, { status: 404 }) };

  const gate = await mayWriteTrip(auth.session, found);
  if (!gate.ok) return { ok: false as const, response: refuseWrite(gate) };

  return { ok: true as const, ref };
}

/**
 * A trip's costs.md — B295.
 *
 * Read, written, amended and removed over REST only. B298 removed MCP from
 * this codebase at the owner's request; a costs tool would have been
 * written the same week it was deleted, so there is none here — if MCP ever
 * returns, it returns with one.
 *
 * **Authority is the same as writing a day**: whoever `mayWriteTrip` admits
 * may read, write, amend or delete this trip's budget, trip-scoped tokens
 * included. A budget is trip content, and the people on a trip are the
 * people who spent the money.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/v1/[user]/trips/[trip]/costs">,
) {
  const { user, trip } = await params;
  const resolved = await resolve(request, user, trip);
  if (!resolved.ok) return resolved.response;
  const { ref } = resolved;

  const parsed = readCostsFile(ref);
  const { base } = conversionFor(ref);
  const budget = parsed ? parseBudget(parsed.data.budget) : undefined;
  const costs = parsed ? parseCostItems(parsed.data.costs, base) : [];

  return Response.json({
    trip: ref,
    // Whether costs.md exists at all — the question `hasCostsData` (B267)
    // asks to decide if the page exists. `false` here does not mean the
    // call failed; it means there is nothing yet, same as an empty drafts
    // list.
    exists: parsed !== null,
    // The currency a cost item is read in when it omits its own — useful to
    // an agent deciding whether to write one.
    baseCurrency: base,
    budget: budget ?? null,
    costs,
    body: parsed ? parsed.content.trim() : "",
  });
}

/**
 * Write the whole costs.md — budget, preparation costs and the trip's own
 * prose about the money, in one call. Replaces the file entirely: send the
 * costs list even if nothing about it is changing, the same as
 * `PUT .../costs` always would.
 *
 * A budget is required. `parseBudget` (lib/costFormat.ts) silently drops a
 * zero or missing total when the page reads it back — a defect this door
 * exists to close, not to repeat — so this refuses it here instead, with a
 * `problems` list naming exactly what was wrong.
 */
export async function PUT(
  request: Request,
  { params }: RouteContext<"/api/v1/[user]/trips/[trip]/costs">,
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

  const problems = validateCostsPut(body);
  if (problems.length > 0) {
    return Response.json({ error: "invalid_costs", problems }, { status: 400 });
  }

  const result = putCosts(ref, body as CostsFileInput);
  if (!result.ok) {
    const status = result.bug ? 500 : result.error === "unknown_trip" ? 404 : 400;
    return Response.json({ error: result.error }, { status });
  }

  return Response.json({
    ok: true,
    trip: ref,
    note:
      "costs.md now exists (or was replaced) for this trip. GET this same URL to read it back " +
      "before telling the owner it is there.",
  });
}

/**
 * Amend part of costs.md without resending the whole thing — the same
 * discipline `editEntry` (B266) uses for a day: a field this omits is left
 * exactly as it was, formatting, comments and key order included, because
 * this may well be a file the owner wrote by hand.
 *
 * `budget`, `costs` and `body` each replace their own block wholesale when
 * sent — the same rule a day's `costs:` list already follows. `budget: null`
 * clears the budget alone and leaves the rest of the file; `costs: []`
 * clears the preparation-costs list the same way. Neither removes the file
 * — that is `DELETE`, below, and it is the only call that makes the costs
 * page disappear.
 */
export async function PATCH(
  request: Request,
  { params }: RouteContext<"/api/v1/[user]/trips/[trip]/costs">,
) {
  const { user, trip } = await params;
  const resolved = await resolve(request, user, trip);
  if (!resolved.ok) return resolved.response;
  const { ref } = resolved;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const keys = Object.keys(body);
  if (keys.length === 0) {
    return Response.json(
      { error: "invalid_request", message: `Name what to change: one or more of ${FIELDS.join(", ")}.` },
      { status: 400 },
    );
  }

  const unsupported = keys.filter((k) => !(FIELDS as readonly string[]).includes(k));
  if (unsupported.length > 0) {
    return Response.json(
      {
        error: "unsupported_field",
        message:
          `This call changes ${unsupported.map((k) => JSON.stringify(k)).join(", ")} for nobody, ` +
          `and nothing was written. This endpoint writes ${FIELDS.join(", ")}.`,
      },
      { status: 400 },
    );
  }

  const problems = validateCostsPatch(body);
  if (problems.length > 0) {
    return Response.json({ error: "invalid_costs", problems }, { status: 400 });
  }

  const result = patchCosts(ref, body as CostsEditInput);
  if (!result.ok) {
    const status = result.bug ? 500 : result.error === "unknown_trip" ? 404 : 400;
    return Response.json({ error: result.error }, { status });
  }

  return Response.json({ ok: true, trip: ref, changed: keys });
}

/**
 * Remove costs.md — how a budget goes away, and with it the trip's whole
 * costs page (B293: the page is presence-driven, and `hasCostsData`, B267,
 * is the presence it asks about).
 *
 * Whole file, not just the `budget:` line — a costs.md left behind with only
 * preparation costs on it would still have a page, which is not what "the
 * page is now gone" means. Idempotent in effect but not in status: calling
 * this on a trip with no costs.md answers 404, since there was nothing here
 * to remove.
 */
export async function DELETE(
  request: Request,
  { params }: RouteContext<"/api/v1/[user]/trips/[trip]/costs">,
) {
  const { user, trip } = await params;
  const resolved = await resolve(request, user, trip);
  if (!resolved.ok) return resolved.response;
  const { ref } = resolved;

  const result = deleteCosts(ref);
  if (!result.ok) {
    return Response.json({ error: "no_costs_file", message: result.error }, { status: 404 });
  }

  return Response.json({
    ok: true,
    trip: ref,
    costsPageGone: true,
    note: `costs.md is removed. The costs page for ${ref} no longer exists and will not appear in the trip's nav.`,
  });
}

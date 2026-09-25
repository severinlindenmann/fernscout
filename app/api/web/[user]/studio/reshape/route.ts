// /api/web/{user}/studio/reshape — the owner's cookie door onto B1832's
// three writers, spec §7.1. No v2/bearer equivalent exists (and none is
// asked for by the spec) — this flow is owner-browser-only, the same
// reasoning `/api/web/{user}/trips/{trip}/days/{slug}` already gives for
// EditDay's own door: the studio is a rendered owner page, and an agent
// bearer token has no business here (AGENTS.md, "agent bearer tokens reach
// /api/**, not rendered owner pages" — the inverse of this route, which is
// under /api but refuses one outright, same as every other studio proxy).
import { isOwner } from "@/lib/contacts/session";
import { getUser } from "@/lib/users";
import { dayForEdit } from "@/lib/studio/editDay";
import { moveDayTransactional, splitDayTransactional, mergeDaysTransactional, referenceSweep } from "@/lib/studio/reshapeDay";

export const dynamic = "force-dynamic";

const NOT_FOR_AGENTS = {
  error: "not_for_agents",
  message: "This is the owner's own door, from a browser — B1832 has no agent-facing equivalent.",
};

async function gate(request: Request, user: string): Promise<Response | null> {
  if (request.headers.get("authorization")) return Response.json(NOT_FOR_AGENTS, { status: 403 });
  if (!getUser(user)) return Response.json({ error: "unknown_user" }, { status: 404 });
  if (!(await isOwner(user))) return Response.json({ error: "forbidden" }, { status: 403 });
  return null;
}

/**
 * GET ?slug=… — a day's own detail, for the flow's preview and to prefill
 * split's paragraph fields (real content, never composed). GET
 * ?sweep=1&tripId=…&slug=… — M4's reference sweep instead.
 */
export async function GET(request: Request, { params }: RouteContext<"/api/web/[user]/studio/reshape">) {
  const { user } = await params;
  const refused = await gate(request, user);
  if (refused) return refused;

  const url = new URL(request.url);
  if (url.searchParams.get("sweep") === "1") {
    const tripId = url.searchParams.get("tripId");
    const slug = url.searchParams.get("slug");
    if (!tripId || !slug) return Response.json({ error: "invalid_request" }, { status: 400 });
    const rows = await referenceSweep(user, tripId, slug);
    return Response.json({ rows });
  }

  const slug = url.searchParams.get("slug");
  if (!slug) return Response.json({ error: "invalid_request" }, { status: 400 });
  const found = dayForEdit(user, slug);
  if (!found) return Response.json({ error: "unknown_day" }, { status: 404 });
  const lead = found.day.lead;
  return Response.json({
    tripId: found.tripId,
    tripTitle: found.tripTitle,
    slug: lead.slug,
    title: lead.title,
    date: found.day.date,
    time: lead.time,
    content: lead.content,
    media: lead.gallery.map((item) => ({ src: item.src })),
    // Every update of this day is a draft, or none of them are — the same
    // reading `OwnerTools`/`EditDay` already use to decide whether "take
    // down" has anything left to do.
    published: found.day.entries.some((entry) => !entry.draft),
  });
}

export async function POST(request: Request, { params }: RouteContext<"/api/web/[user]/studio/reshape">) {
  const { user } = await params;
  const refused = await gate(request, user);
  if (refused) return refused;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.op !== "string") return Response.json({ error: "invalid_request" }, { status: 400 });

  if (body.op === "move") {
    const { fromTripId, slug, toTripId, date } = body as Record<string, string>;
    if (!fromTripId || !slug || !toTripId || !date) return Response.json({ error: "invalid_request" }, { status: 400 });
    const result = moveDayTransactional(user, fromTripId, slug, { tripId: toTripId, date });
    if (!result.ok) return Response.json({ error: result.error }, { status: 409 });
    return Response.json(result);
  }

  if (body.op === "split") {
    const { tripId, slug, photoCutIndex, firstContent, secondTitle, secondContent, secondTime } = body as Record<string, unknown>;
    if (typeof tripId !== "string" || typeof slug !== "string" || typeof photoCutIndex !== "number" || typeof firstContent !== "string" || typeof secondTitle !== "string" || typeof secondContent !== "string") {
      return Response.json({ error: "invalid_request" }, { status: 400 });
    }
    const result = splitDayTransactional(user, tripId, slug, {
      photoCutIndex,
      firstContent,
      secondTitle,
      secondContent,
      ...(typeof secondTime === "string" && secondTime ? { secondTime } : {}),
    });
    if (!result.ok) return Response.json({ error: result.error }, { status: 409 });
    return Response.json(result);
  }

  if (body.op === "merge") {
    const { tripIdA, slugA, tripIdB, slugB } = body as Record<string, string>;
    if (!tripIdA || !slugA || !tripIdB || !slugB) return Response.json({ error: "invalid_request" }, { status: 400 });
    const result = mergeDaysTransactional(user, tripIdA, slugA, tripIdB, slugB);
    if (!result.ok) return Response.json({ error: result.error }, { status: 409 });
    return Response.json(result);
  }

  return Response.json({ error: "invalid_request", message: `Unknown op "${String(body.op)}".` }, { status: 400 });
}

// GET/PUT /api/web/{user}/trips/{trip}/roster — a group trip's roster and
// duty plan, from the owner's cookie — B2435 slice 1. Not part of /api/v2: no
// agent reads or writes a roster of children's names. Absent (404) unless
// features.groupTrips is on for the journal.
import { isJournalOwnerCookie } from "@/lib/contacts/session";
import { isEnabled } from "@/lib/capabilities";
import { parseRoster, readRoster, writeRoster } from "@/lib/groupRoster";
import { tripRef, getTrip } from "@/lib/trips";
import { getUser } from "@/lib/users";
import { readJsonBody } from "@/lib/api/jsonBody";

export const dynamic = "force-dynamic";

async function gate(request: Request, user: string, trip: string): Promise<Response | null> {
  if (request.headers.get("authorization")) {
    return Response.json({ error: "not_for_agents", message: "The roster is the owner's own, from a browser." }, { status: 403 });
  }
  if (!getUser(user) || !isEnabled("groupTrips", user)) return Response.json({ error: "not_found" }, { status: 404 });
  // Minors' names: the journal's own owner only, never the operator (B480).
  if (!(await isJournalOwnerCookie(user))) return Response.json({ error: "forbidden" }, { status: 403 });
  if (!getTrip(tripRef(user, trip))) return Response.json({ error: "unknown_trip" }, { status: 404 });
  return null;
}

export async function GET(request: Request, { params }: RouteContext<"/api/web/[user]/trips/[trip]/roster">) {
  const { user, trip } = await params;
  const refused = await gate(request, user, trip);
  if (refused) return refused;
  return Response.json({ ok: true, ...readRoster(user, trip) });
}

export async function PUT(request: Request, { params }: RouteContext<"/api/web/[user]/trips/[trip]/roster">) {
  const { user, trip } = await params;
  const refused = await gate(request, user, trip);
  if (refused) return refused;
  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = parseRoster(body.value);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  writeRoster(user, trip, parsed.roster);
  return Response.json({ ok: true, ...parsed.roster });
}

import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { resolveAccess } from "@/lib/auth/handshake";
import { getUser } from "@/lib/users";
import { isEnabled } from "@/lib/capabilities";
import { ownerTripLine } from "@/lib/gps/api";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * The owner's own preview of one trip's raw route — B2226, the second
 * exception to "nothing reads gps/" after `placeForDay`. Unlike everything
 * else a reader may see on a trip's map, this line has no private-zone
 * removal, no 24-hour recency cap and no end-trimming applied
 * (`ownerTripLine`, `lib/gps/api.ts`) — the owner looking at their own
 * history is not the audience those exist to protect.
 *
 * **Owner-only, not just `isHelperOwner`-only** — same second check as
 * `.../gps` and `.../gps/trips`: the operator's admin cookie opens every
 * other helper door and none of this one.
 *
 * There is deliberately no `/api/v2` twin — the owner decided on
 * 2026-09-24 that there is no agent door onto the raw line.
 */
async function isOwnerOnly(username: string): Promise<boolean> {
  if (!(await isHelperOwner(username))) return false;
  const journal = getUser(username);
  const access = await resolveAccess(username);
  return journal !== null && access.email === journal.owner.email;
}

export async function GET(request: Request, { params }: RouteContext<"/api/helper/[user]/gps/line">) {
  const { user } = await params;
  if (!(await isOwnerOnly(user))) return notYourJournal(request, user);
  if (!isEnabled("routeRecording", user)) {
    return Response.json({ error: "capability_off" }, { status: 404, headers: NO_STORE });
  }

  const url = new URL(request.url);
  const tripId = url.searchParams.get("trip") ?? "";
  const line = ownerTripLine(user, tripId);
  if (!line) return Response.json({ error: "unknown_trip" }, { status: 404, headers: NO_STORE });

  return Response.json({ ok: true, ...line }, { headers: NO_STORE });
}

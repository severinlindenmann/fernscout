import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { resolveAccess } from "@/lib/auth/handshake";
import { getUser } from "@/lib/users";
import { FOREIGN_ORIGIN_REFUSAL, foreignOrigin } from "@/lib/auth/originCheck";
import { isEnabled } from "@/lib/capabilities";
import { deleteTripRecording, isRealDate } from "@/lib/gps/api";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * "Delete this trip's recording" and its own per-day sibling — B2226. Takes
 * `?trip=` alone for the whole trip's window, or `?trip=&date=` for one
 * day's — `deleteTripRecording` (`lib/gps/api.ts`) resolves either to the
 * exact fixes inside that window, in the day's own timezone, and re-derives
 * the trip's `track.json` afterwards so the delete is visible on the trip's
 * own map at once.
 *
 * The phone's own upload buffer is unaffected — a position already queued
 * on the device before this ran still arrives later; the page says so.
 *
 * **Owner-only, not just `isHelperOwner`-only**, and **`foreignOrigin`
 * checked** — the same two-layer guard `.../gps` (B1843 addendum) puts in
 * front of its own real deletion.
 */
async function isOwnerOnly(username: string): Promise<boolean> {
  if (!(await isHelperOwner(username))) return false;
  const journal = getUser(username);
  const access = await resolveAccess(username);
  return journal !== null && access.email === journal.owner.email;
}

export async function DELETE(request: Request, { params }: RouteContext<"/api/helper/[user]/gps/trip">) {
  const { user } = await params;
  if (!(await isOwnerOnly(user))) return notYourJournal(request, user);
  if (foreignOrigin(request)) {
    return Response.json(FOREIGN_ORIGIN_REFUSAL, { status: 403, headers: NO_STORE });
  }
  if (!isEnabled("routeRecording", user)) {
    return Response.json({ error: "capability_off" }, { status: 404, headers: NO_STORE });
  }

  const url = new URL(request.url);
  const tripId = url.searchParams.get("trip") ?? "";
  const date = url.searchParams.get("date") ?? undefined;
  if (date !== undefined && !isRealDate(date)) {
    return Response.json({ error: "invalid_date" }, { status: 400, headers: NO_STORE });
  }

  const result = deleteTripRecording(user, tripId, date);
  if (!result) return Response.json({ error: "unknown_trip" }, { status: 404, headers: NO_STORE });

  return Response.json({ ok: true, ...result }, { headers: NO_STORE });
}

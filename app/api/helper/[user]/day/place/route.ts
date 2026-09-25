import { resolveAccess } from "@/lib/auth/handshake";
import { isEnabled } from "@/lib/capabilities";
import { placeForDay } from "@/lib/gps/api";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { getTrip, tripRef } from "@/lib/trips";
import { getUser } from "@/lib/users";

/** Never kept by a browser or a shared cache — it is derived from `gps/`. */
const PRIVATE = { "Cache-Control": "private, no-store" };

export const dynamic = "force-dynamic";

/**
 * "You were in Chiang Mai — use it?" — B2200, D1.
 *
 * The one door onto `placeForDay` (`lib/gps/api.ts`), and it is guarded
 * exactly the way every other route under `app/api/helper/` is:
 * `isHelperOwner` reads the browser's signed-in cookie only, never an
 * `Authorization` header, so a bearer token — including a journal-wide agent
 * token — gets `notYourJournal`'s bearer-refused sentence rather than a
 * place name. AGENTS.md: "agent bearer tokens reach `/api/**`, not rendered
 * owner pages," and this is the one page in the studio that reads `gps/` at
 * all.
 *
 * Behind `features.routeRecording` like every optional capability — off
 * means this answers `capability_off` rather than silently returning
 * nothing, so the flow can tell "no capability" from "no fixes that day"
 * apart.
 */
export async function GET(request: Request, { params }: RouteContext<"/api/helper/[user]/day/place">) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }
  // `isHelperOwner` also admits the operator's admin address. This one door
  // reads somebody's location history, so it is the owner's alone.
  const { email } = await resolveAccess(user);
  if (email !== getUser(user)?.owner.email) return notYourJournal(request, user);

  if (!isEnabled("routeRecording", user)) {
    return Response.json({ error: "capability_off" }, { status: 404 });
  }

  const url = new URL(request.url);
  const tripId = url.searchParams.get("trip") ?? "";
  const date = url.searchParams.get("date") ?? "";
  if (!getTrip(tripRef(user, tripId))) {
    return Response.json({ error: "unknown_trip" }, { status: 404 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json({ error: "invalid_date" }, { status: 400 });
  }

  const place = placeForDay(user, tripId, date);
  return Response.json({ ok: true, place }, { headers: PRIVATE });
}

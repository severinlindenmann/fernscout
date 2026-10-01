import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { resolveAccess } from "@/lib/auth/handshake";
import { getUser } from "@/lib/users";
import { isEnabled } from "@/lib/capabilities";
import { travelForPartOfDay } from "@/lib/gps/api";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * "What did we do in this part of the day?" — TIX-2's add-a-day flow, asking
 * for one stretch's recorded travel (e.g. the morning before lunch) rather
 * than the whole day's `kmByMode`. Same owner-only door as
 * `app/api/helper/[user]/gps/line/route.ts` next door — `isHelperOwner` plus
 * the operator-admin-cookie exclusion, never a bearer token, and no `/api/v2`
 * twin (the owner's 2026-09-24 decision: no agent door onto the raw line).
 *
 * Answers with a mode and a kilometre count only — never a point, a
 * coordinate or a time; see `travelForPartOfDay` in `lib/gps/api.ts`.
 */
async function isOwnerOnly(username: string): Promise<boolean> {
  if (!(await isHelperOwner(username))) return false;
  const journal = getUser(username);
  const access = await resolveAccess(username);
  return journal !== null && access.email === journal.owner.email;
}

export async function GET(request: Request, { params }: RouteContext<"/api/helper/[user]/day/travel">) {
  const { user } = await params;
  if (!(await isOwnerOnly(user))) return notYourJournal(request, user);
  if (!isEnabled("routeRecording", user)) {
    return Response.json({ error: "capability_off" }, { status: 404, headers: NO_STORE });
  }

  const url = new URL(request.url);
  const tripId = url.searchParams.get("trip") ?? "";
  const date = url.searchParams.get("date") ?? "";
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (from !== null && !HHMM.test(from)) {
    return Response.json({ error: "invalid_from" }, { status: 400, headers: NO_STORE });
  }
  if (to !== null && !HHMM.test(to)) {
    return Response.json({ error: "invalid_to" }, { status: 400, headers: NO_STORE });
  }

  const travel = travelForPartOfDay(user, tripId, date, from ?? undefined, to ?? undefined);
  if (travel === undefined) {
    return Response.json({ error: "unknown_trip" }, { status: 404, headers: NO_STORE });
  }
  return Response.json({ ok: true, travel }, { headers: NO_STORE });
}

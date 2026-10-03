import { isEnabled } from "@/lib/capabilities";
import { isJournalOwnerCookie } from "@/lib/contacts/session";
import { fillDays } from "@/lib/gps/nameDays";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { readJsonBody } from "@/lib/api/jsonBody";
import { getTrip, tripRef } from "@/lib/trips";

export const dynamic = "force-dynamic";

/**
 * "Fill ticked days" — B2303. The one write behind the route page's "Days
 * without a place" section. Owner's own browser cookie only (never a bearer
 * token, never the operator's cookie): the place it writes comes from the
 * owner's location history. It names days that already exist and lack a
 * place — nothing else — and recomputes each place here rather than
 * trusting what the page showed.
 */
export async function POST(request: Request, { params }: RouteContext<"/api/helper/[user]/gps/name-days">) {
  const { user } = await params;
  if (!(await isHelperOwner(user)) || !(await isJournalOwnerCookie(user))) return notYourJournal(request, user);
  if (!isEnabled("routeRecording", user)) return Response.json({ error: "capability_off" }, { status: 404 });

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const { trip, dates } = (body.value ?? {}) as { trip?: unknown; dates?: unknown };
  if (typeof trip !== "string" || !getTrip(tripRef(user, trip))) {
    return Response.json({ error: "unknown_trip" }, { status: 404 });
  }
  if (!Array.isArray(dates) || dates.length === 0 || dates.length > 400 || dates.some((d) => typeof d !== "string")) {
    return Response.json({ error: "invalid_dates" }, { status: 400 });
  }
  return Response.json({ ok: true, ...fillDays(user, trip, dates as string[]) }, { headers: { "Cache-Control": "private, no-store" } });
}

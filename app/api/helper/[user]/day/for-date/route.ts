import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { getTrip, tripRef } from "@/lib/trips";
import { findDayForDate } from "@/lib/studio/day";

export const dynamic = "force-dynamic";

/**
 * D3, asked before the write rather than only discovered by it — A2✗
 * (`spec.md` §5). The flow calls this the moment a date is chosen, so the
 * collision screen can render before anybody has typed anything past it;
 * `POST .../day/new` re-checks the same fact at write time regardless
 * (never trust a client's earlier answer for something this can change
 * under it), so this route is a UX convenience, not the actual guard.
 */
export async function GET(request: Request, { params }: RouteContext<"/api/helper/[user]/day/for-date">) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
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

  const existing = findDayForDate(user, tripId, date);
  return Response.json({ ok: true, existing });
}

// GET every day in this trip, paged (V12) — B1612 (phase 2 step 3, parcel B).
//
// Creation is `PUT .../days/{slug}`, client-chosen slug (S2) — this route
// only lists.
import { dayDoc } from "@/lib/api/v2/schemas";
import { fail, ok } from "@/lib/api/v2/route";
import { resolveBearer, ownsUser, outOfScopeRefusal } from "@/lib/api/v2/auth";
import { mayWriteTrip } from "@/lib/api/auth";
import { ERROR_CODES } from "@/lib/api/errorCodes";
import { readTripFile, listDaySlugs, readDayFile } from "@/lib/api/v2/store";
import { dayEchoInput, withResolvedTest } from "@/lib/api/v2/days";
import type { Trip } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: RouteContext<"/api/v2/[user]/trips/[trip]/days">,
) {
  const { user, trip: tripId } = await params;

  const bearer = await resolveBearer(request);
  if (!bearer.ok) return bearer.response;
  if (!ownsUser(bearer.session, user)) return outOfScopeRefusal(bearer.session, user);

  const stored = readTripFile(user, tripId);
  if (!stored) return fail("unknown_trip", ERROR_CODES.unknown_trip, undefined, 404);

  const tripLike = { username: user, id: tripId, ref: `${user}/${tripId}`, people: stored.people } as unknown as Trip;
  const gate = await mayWriteTrip(bearer.session, tripLike);
  if (!gate.ok) return fail("unknown_trip", ERROR_CODES.unknown_trip, undefined, 404);

  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Math.max(1, Math.min(200, Number(limitParam) || 50)) : 50;
  const cursor = url.searchParams.get("cursor") ?? undefined;

  const slugs = listDaySlugs(user, tripId);
  const startAt = cursor ? slugs.findIndex((s) => s > cursor) : 0;
  const from = startAt === -1 ? slugs.length : startAt;
  const page = slugs.slice(from, from + limit);
  const next = page.length === limit && from + limit < slugs.length ? page[page.length - 1] : undefined;

  const days = page
    .map((slug) => readDayFile(user, tripId, slug))
    .filter((d): d is NonNullable<typeof d> => d !== null)
    .map((d) => dayDoc.parse(withResolvedTest(dayEchoInput(d), stored, d)));

  return ok({ trip: tripId, days, next_cursor: next });
}

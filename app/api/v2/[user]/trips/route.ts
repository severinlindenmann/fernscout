// GET every trip in this journal — B1612 (phase 2 step 3, parcel B).
//
// Client-chosen ids everywhere means creation is `PUT .../trips/{trip}`, not
// a POST here (S2) — this route only lists.
import type { TripFile } from "@/lib/api/v2/documents";
import { fail, ok } from "@/lib/api/v2/route";
import { resolveBearer, ownsUser, outOfScopeRefusal } from "@/lib/api/v2/auth";
import { writableTrips } from "@/lib/api/auth";
import { ERROR_CODES } from "@/lib/api/errorCodes";
import { readTripFile, listTripIds } from "@/lib/api/v2/store";
import { buildTripDoc } from "@/lib/api/v2/trips";
import { getUser } from "@/lib/users";
import type { Trip } from "@/lib/types";

export const dynamic = "force-dynamic";

/** A minimal `Trip`-shaped stand-in so `writableTrips` (lib/api/auth, v1
 * domain logic reused per this ticket's brief) can scope by trip-people —
 * it reads `username`, `id` and `people` at runtime and nothing else. */
function asTripLike(user: string, id: string, trip: TripFile): Trip {
  return { username: user, id, ref: `${user}/${id}`, people: trip.people } as unknown as Trip;
}

function readAll(user: string): { id: string; trip: TripFile }[] {
  return listTripIds(user)
    .map((id) => {
      const trip = readTripFile(user, id);
      return trip ? { id, trip } : null;
    })
    .filter((t): t is { id: string; trip: TripFile } => t !== null)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export async function GET(request: Request, { params }: RouteContext<"/api/v2/[user]/trips">) {
  const { user } = await params;
  if (!getUser(user)) return fail("no_such_journal", ERROR_CODES.no_such_journal, undefined, 404);

  const bearer = await resolveBearer(request);
  if (!bearer.ok) return bearer.response;
  if (!ownsUser(bearer.session, user)) return outOfScopeRefusal(bearer.session, user);

  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Math.max(1, Math.min(200, Number(limitParam) || 50)) : 50;
  const cursor = url.searchParams.get("cursor") ?? undefined;

  const all = readAll(user);
  const scoped = await writableTrips(
    bearer.session,
    all.map(({ id, trip }) => asTripLike(user, id, trip)),
  );
  const scopedIds = new Set(scoped.map((t) => t.id));
  const visible = all.filter(({ id }) => scopedIds.has(id));

  const startAt = cursor ? visible.findIndex(({ id }) => id > cursor) : 0;
  const from = startAt === -1 ? visible.length : startAt;
  const page = visible.slice(from, from + limit);
  const next = page.length === limit && from + limit < visible.length ? page[page.length - 1].id : undefined;

  return ok({
    trips: page.map(({ id, trip }) => buildTripDoc(user, id, trip, "full")),
    next_cursor: next,
  });
}

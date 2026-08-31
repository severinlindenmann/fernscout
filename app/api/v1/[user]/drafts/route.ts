import { authenticate, errorResponse, ownsUser, writableTrips } from "@/lib/api/auth";
import { listDrafts } from "@/lib/api/entries";
import { getTrips } from "@/lib/trips";

export const dynamic = "force-dynamic";

/** Everything waiting for a person to approve it. */
export async function GET(request: Request, { params }: RouteContext<"/api/v1/[user]/drafts">) {
  const auth = await authenticate(request);
  if (!auth.ok) return errorResponse(auth);

  const { user } = await params;
  if (!ownsUser(auth.session, user)) {
    return Response.json({ error: "out_of_scope" }, { status: 403 });
  }

  return Response.json({
    user,
    // Same scoping as the trip list: a trip-scoped token sees that trip's
    // drafts and no others.
    drafts: writableTrips(auth.session, getTrips(user)).flatMap((trip) =>
      listDrafts(trip.ref).map((d) => ({ ...d, trip: trip.ref })),
    ),
  });
}

import { authenticate, errorResponse, ownsUser, writableTrips } from "@/lib/api/auth";
import { tripSummary } from "@/lib/api/entries";
import { getTrips } from "@/lib/trips";

export const dynamic = "force-dynamic";

/** Every trip in this journal, including ones the public cannot see. */
export async function GET(request: Request, { params }: RouteContext<"/api/v1/[user]/trips">) {
  const auth = await authenticate(request);
  if (!auth.ok) return errorResponse(auth);

  const { user } = await params;
  if (!ownsUser(auth.session, user)) {
    // A token is scoped to one journal. Saying "forbidden" rather than
    // "not found" is safe here: the caller already proved who they are.
    return Response.json({ error: "out_of_scope" }, { status: 403 });
  }

  // Only the trips this token can actually reach. A trip-scoped token listing
  // the whole journal would tell somebody who came on one trip what else its
  // owner has been doing.
  return Response.json({
    user,
    trips: writableTrips(auth.session, getTrips(user))
      .map((t) => tripSummary(user, t.id))
      .filter(Boolean),
  });
}

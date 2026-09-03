import { authenticate, errorResponse, ownsUser, writableTrips } from "@/lib/api/auth";
import { listDrafts } from "@/lib/api/entries";
import { getTrips } from "@/lib/trips";
import { serverSite } from "@/lib/site";

export const dynamic = "force-dynamic";

/**
 * Everything waiting for a person to approve it.
 *
 * Each draft now carries `publish` — the call that puts *that* day on the site.
 * This list is what an agent ends its report with, and until B28 it could say
 * what was waiting and not where the person went to say yes: the guide told an
 * agent four times that "a person publishes it" and never once how. A queue
 * that names the outstanding work and not the approval is half a queue.
 */
export async function GET(request: Request, { params }: RouteContext<"/api/v1/[user]/drafts">) {
  const auth = await authenticate(request);
  if (!auth.ok) return errorResponse(auth);

  const { user } = await params;
  if (!ownsUser(auth.session, user)) {
    return Response.json({ error: "out_of_scope" }, { status: 403 });
  }

  const base = serverSite().url;
  return Response.json({
    user,
    // Same scoping as the trip list: a trip-scoped token sees that trip's
    // drafts and no others.
    drafts: (await writableTrips(auth.session, getTrips(user))).flatMap((trip) =>
      listDrafts(trip.ref).map((d) => ({
        ...d,
        trip: trip.ref,
        publish: `POST ${base}/api/v1/${user}/trips/${trip.id}/days/${d.slug}/publish`,
      })),
    ),
    next:
      "Tell the person what is waiting and ask which to publish. `publish` is the call " +
      "that acts on their answer — it is refused once and hands you a confirmation code.",
  });
}

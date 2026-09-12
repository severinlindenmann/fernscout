import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { sessionsOf } from "@/lib/helper/sessions";
import { liveSession } from "@/lib/helper/thread";
import { AS_AUTHOR, getAllEntries } from "@/lib/entries";
import { getTrips, tripRef } from "@/lib/trips";

export const dynamic = "force-dynamic";

/**
 * The room's own history panel, reading back what `sessionsOf` already
 * answers for `past_conversations` — B1109.
 *
 * A second door onto the same read rather than the tool's own route, because
 * the panel opens with a tap and owes nobody a sentence from a model: the
 * tool exists for "show me my earlier conversations" typed into the
 * conversation itself, and this exists for the clock icon beside it. Both
 * read the owner's own words, so both are cookie-only and owner-only, outside
 * `/api/v1` and outside the published contract, for the reason
 * `app/api/helper/[user]/day/route.ts` sets out at length.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/helper/[user]/sessions">,
) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }
  // `q` filters against the stored words (B1217, D36). `trips` lists every
  // trip cheaply — B1573 split this from `days` below, which used to
  // compute the newest trip's days on every open whether or not the Tage
  // tab was ever opened. A trip's days now load only once the panel's own
  // picker names one, via `?trip=<id>` — the same on-demand shape
  // `trip-files` gives the files pane's photographs.
  const q = new URL(request.url).searchParams.get("q") ?? "";
  const tripId = new URL(request.url).searchParams.get("trip");
  const trips = [...getTrips(user)]
    .sort((a, b) => b.start.localeCompare(a.start))
    .map((trip) => ({ id: trip.id, title: trip.title }));
  const named = tripId ? trips.find((trip) => trip.id === tripId) : undefined;
  const days =
    tripId && named
      ? getAllEntries(tripRef(user, tripId), AS_AUTHOR)
          .map((entry) => ({
            trip: tripId,
            slug: entry.slug,
            date: entry.date,
            title: entry.title,
            draft: entry.draft === true,
          }))
          .sort((a, b) => b.date.localeCompare(a.date))
      : [];
  // `live` names the conversation a next sentence would extend, so the
  // panel can say which row is the one you are in — B1168. `null` when
  // nothing is in progress.
  return Response.json({
    ok: true,
    live: await liveSession(user),
    sessions: await sessionsOf(user, 30, q),
    trips,
    ...(tripId ? { tripTitle: named?.title ?? "", days } : {}),
  });
}

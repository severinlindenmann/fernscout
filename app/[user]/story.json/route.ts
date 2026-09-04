import { storyWindow } from "@/lib/tripView";
import { currentTripRef, getTrip, parseTripRef, tripRef } from "@/lib/trips";
import { draftsVisibleTo, mayReadTrip, mayViewCosts } from "@/lib/tripGate";
import { userExists } from "@/lib/users";

/**
 * `/<username>/story.json?trip=<id>&from=<n>&to=<n>` — days `from`…`to` of a
 * trip, in full.
 *
 * The story page ships a window of days and fetches its neighbours from here
 * as the reader moves, so the page's size no longer tracks the length of the
 * trip. It lives beside the user's other generated documents (`feed.xml`,
 * `search-index.json`) rather than under `/api`, because it is part of the
 * reading surface: same owner, same trip gate, same 404s.
 */

/** Days are small, so a generous slice costs little and a runaway one is
 * refused rather than served. */
const MAX_DAYS = 24;

export async function GET(request: Request, { params }: RouteContext<"/[user]/story.json">) {
  const { user } = await params;
  if (!userExists(user)) return new Response("Not found", { status: 404 });

  const url = new URL(request.url);
  const asked = url.searchParams.get("trip");

  // The wire format is the qualified ref, `<username>/<trip-id>`, the same
  // string the reactions API takes — one shape everywhere beats two. A bare id
  // is still accepted so an older client keeps working, and either way the
  // username in the path is what decides: a ref naming somebody else is
  // refused rather than quietly served.
  const ref = !asked
    ? currentTripRef(user)
    : asked.includes("/")
      ? asked
      : tripRef(user, asked);
  if (!ref) return new Response("Not found", { status: 404 });
  if (parseTripRef(ref)?.username !== user) {
    return new Response("Not found", { status: 404 });
  }

  const trip = getTrip(ref);
  if (!trip) return new Response("Not found", { status: 404 });
  // The same gate the layouts apply. A locked trip's days are not readable
  // just because they are asked for as JSON.
  if (!(await mayReadTrip(trip))) return new Response("Forbidden", { status: 403 });

  const from = Number(url.searchParams.get("from") ?? "0");
  const to = Number(url.searchParams.get("to") ?? "0");
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to <= from) {
    return new Response("Bad request", { status: 400 });
  }

  const start = from;
  // Costs travel with the day, so the same rule the pages apply has to
  // apply here: this is the route a reader's own browser calls for the
  // days it has not been sent yet.
  const days = storyWindow(ref, start, Math.min(to, start + MAX_DAYS), {
    showCosts: await mayViewCosts(trip),
    // B327: the owner, or somebody on the trip — the same audience the API's
    // own days listing has had since B296. This is the route a reader's own
    // browser calls for days it has not been sent yet, so a buddy paging back
    // through the story would otherwise hit a hole where their draft is.
    includeDrafts: (await draftsVisibleTo(trip, request)).visible,
  });

  return new Response(JSON.stringify({ from: start, days }), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // A day's content changes when it is edited, not per reader. Short
      // enough that a correction shows up, long enough that paging back and
      // forth over the same stretch costs one request.
      "Cache-Control": "private, max-age=60, stale-while-revalidate=600",
    },
  });
}

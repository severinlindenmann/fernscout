import { buildStoryProps } from "@/lib/tripView";
import { tripCardFor, dayCardFor } from "@/lib/map/tripCard";
import { currentTripRef, getTrip } from "@/lib/trips";
import { mayReadTrip, readFor } from "@/lib/tripGate";
import { userExists } from "@/lib/users";

/**
 * `/@<username>/card.svg[?day=YYYY-MM-DD]` — the current trip's still
 * preview card (B2538), served as `image/svg+xml` behind the trip's own
 * read gate so a `MapCard` can be an ordinary `<img src>` instead of an
 * inlined string: a day the pager fetches client-side (`story.json`'s own
 * neighbour) gets its card the same way it gets everything else about
 * itself, rather than only the one day a `/day/<slug>` permalink happened
 * to render on the server.
 *
 * Same gate as `story.json` beside it — `mayReadTrip`, and `readFor`'s own
 * draft/reader resolution feeds the same `index` the story page itself
 * reads its places and recorded line from, so a reader who may not see a
 * draft day never sees its place or its line here either (see
 * `test/card-svg-route.test.ts`).
 */
export async function GET(request: Request, { params }: RouteContext<"/at/[user]/card.svg">) {
  const { user } = await params;
  if (!userExists(user)) return new Response("Not found", { status: 404 });

  const ref = currentTripRef(user);
  if (!ref) return new Response("Not found", { status: 404 });

  const trip = getTrip(ref);
  if (!trip) return new Response("Not found", { status: 404 });
  // Refused as a plain 404, not a 403 — the same face a locked trip's day
  // permalink already wears (`app/at/[user]/day/[slug]/page.tsx` returns
  // `null` rather than a page), so a probe cannot tell "no such trip" from
  // "not yours to see" apart.
  if (!(await mayReadTrip(trip))) return new Response("Not found", { status: 404 });

  const { read } = await readFor(trip, request);
  const { index } = buildStoryProps(ref, read);

  const url = new URL(request.url);
  const day = url.searchParams.get("day");
  // Concrete colours per theme, not a `var(--map-…)` cascade an `<img>`'s
  // separate document cannot see — see lib/map/cardPalette.ts and
  // components/map/MapCard.tsx, which is what appends this.
  const scheme = url.searchParams.get("theme") === "dark" ? "dark" : "light";
  const result = day ? await dayCardFor(trip, index, day, scheme) : await tripCardFor(trip, index, scheme);
  if (!result) return new Response("Not found", { status: 404 });

  return new Response(result.card.svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      // `private`, same reasoning as `story.json`: the body varies by which
      // days this cookie may see, and a shared/device cache must not answer
      // one reader's request with another's drafts.
      "Cache-Control": "private, max-age=60, stale-while-revalidate=600",
      Vary: "Cookie",
    },
  });
}

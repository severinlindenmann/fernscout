import { buildStoryProps } from "@/lib/tripView";
import { tripCardFor, dayCardFor } from "@/lib/map/tripCard";
import { getTrip, tripRef } from "@/lib/trips";
import { mayReadTrip, readFor } from "@/lib/tripGate";
import { userExists } from "@/lib/users";

/**
 * `/@<username>/trips/<id>/card.svg[?day=YYYY-MM-DD]` — a past trip's own
 * card. Mirrors `/@<username>/card.svg` (the current trip's own route)
 * exactly; see that file's doc for the whole rationale.
 */
export async function GET(request: Request, { params }: RouteContext<"/at/[user]/trips/[trip]/card.svg">) {
  const { user, trip: id } = await params;
  if (!userExists(user)) return new Response("Not found", { status: 404 });

  const ref = tripRef(user, id);
  const trip = getTrip(ref);
  if (!trip) return new Response("Not found", { status: 404 });
  if (!(await mayReadTrip(trip))) return new Response("Not found", { status: 404 });

  const { read } = await readFor(trip, request);
  const { index } = buildStoryProps(ref, read);

  const url = new URL(request.url);
  const day = url.searchParams.get("day");
  const scheme = url.searchParams.get("theme") === "dark" ? "dark" : "light";
  const result = day ? await dayCardFor(trip, index, day, scheme) : await tripCardFor(trip, index, scheme);
  if (!result) return new Response("Not found", { status: 404 });

  return new Response(result.card.svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "private, max-age=60, stale-while-revalidate=600",
      Vary: "Cookie",
    },
  });
}

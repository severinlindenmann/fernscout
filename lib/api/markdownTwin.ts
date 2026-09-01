import "server-only";
import { getEntryBySlug } from "../entries";
import { mayReadTrip } from "../tripGate";
import { currentTripRef, getTrip, getTrips, tripRef } from "../trips";
import type { Entry } from "../types";

/**
 * The markdown twin of a day page.
 *
 * One function behind two routes, because there are two URLs a day page has —
 * `/<user>/day/<slug>` when it is the current trip's, and
 * `/<user>/trips/<trip>/day/<slug>` always — and the promise the documentation
 * makes is that appending `.md` to *the page's own URL* gives you its source.
 * That promise was only kept for the first form, and only for the current
 * trip: `/example/day/zion-narrows.md` answered 404 because zion-narrows is in
 * `parks-2025` and the current trip is `usa-2026`.
 *
 * Gated exactly like the HTML page. A markdown twin that ignored visibility
 * would be the easiest way to read a private trip, so `mayReadTrip` is checked
 * for every trip considered — including the ones the fallback walks through,
 * where an unreadable trip is skipped rather than refused, so that the search
 * cannot be used to ask which trips exist.
 *
 * Answers `text/plain`. A 404 here used to be able to come back as the app's
 * HTML error page — forty kilobytes of markup into an agent's context window
 * for a mistyped slug, and in a loop, real trouble.
 */
export async function markdownTwin(
  user: string,
  tripId: string | null,
  slug: string,
): Promise<Response> {
  const found = tripId
    ? await inNamedTrip(user, tripId, slug)
    : await inCurrentTripOrAnyOther(user, slug);

  if (!found) return notFound(user, tripId, slug);
  return new Response(render(found), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "X-Robots-Tag": "noindex",
      "Cache-Control": "public, max-age=300",
    },
  });
}

async function readable(ref: string) {
  const trip = getTrip(ref);
  if (!trip) return null;
  return (await mayReadTrip(trip)) ? trip : null;
}

async function inNamedTrip(user: string, tripId: string, slug: string): Promise<Entry | null> {
  const ref = tripRef(user, tripId);
  if (!(await readable(ref))) return null;
  return getEntryBySlug(ref, slug) ?? null;
}

/**
 * The current trip first, then the rest of the journal.
 *
 * The current trip is checked first rather than merely being one of the
 * candidates: two trips may hold the same slug, and the bare `/day/<slug>`
 * URL belongs to the current trip's page, so that is the day it must return.
 */
async function inCurrentTripOrAnyOther(user: string, slug: string): Promise<Entry | null> {
  const current = currentTripRef(user);
  if (current) {
    const trip = await readable(current);
    if (trip) {
      const entry = getEntryBySlug(current, slug);
      if (entry) return entry;
    }
  }

  for (const trip of getTrips(user)) {
    if (trip.ref === current) continue;
    if (!(await mayReadTrip(trip))) continue;
    const entry = getEntryBySlug(trip.ref, slug);
    if (entry) return entry;
  }
  return null;
}

/** Plain text, and it says what to try instead. */
function notFound(user: string, tripId: string | null, slug: string): Response {
  return new Response(
    `No day "${slug}" in ${tripId ? `${user}/${tripId}` : `${user}'s readable trips`}.\n` +
      `Days are listed at /${user}/documentation.txt, and identified there as ` +
      `<trip-id>/<slug>. The markdown twin of a day is its own page's URL with .md ` +
      `on the end: /${user}/trips/<trip-id>/day/<slug>.md\n`,
    {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8", "X-Robots-Tag": "noindex" },
    },
  );
}

function render(entry: Entry): string {
  return [
    "---",
    `title: ${JSON.stringify(entry.title)}`,
    `date: ${JSON.stringify(entry.date)}`,
    ...(entry.time ? [`time: ${JSON.stringify(entry.time)}`] : []),
    `location: ${JSON.stringify(entry.location)}`,
    `country: ${JSON.stringify(entry.country)}`,
    ...(Number.isFinite(entry.lat) ? [`lat: ${entry.lat}`] : []),
    ...(Number.isFinite(entry.lng) ? [`lng: ${entry.lng}`] : []),
    ...(entry.gallery.length ? [`photos: ${entry.gallery.length}`] : []),
    "---",
    "",
    entry.content,
    "",
  ].join("\n");
}

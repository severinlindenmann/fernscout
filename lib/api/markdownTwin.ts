import "server-only";
import { getEntryBySlug } from "../entries";
import { isTestContent } from "../access";
import { journalTombstone, tripTombstone, type Tombstone } from "../tombstones";
import { mayReadTrip } from "../tripGate";
import { currentTripRef, getTrip, getTrips, tripRef } from "../trips";
import type { Entry, Trip } from "../types";

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
  /**
   * Deleted is not missing, and the twin was the one route that could not tell
   * them apart.
   *
   * Every other surface of a removed journal answers 410 — the pages through
   * `proxy.ts`, and `documentation.txt`, `feed.xml`, `search-index.json` and
   * `story.json` through the extra matcher entries there. The twins fell
   * through both: the matcher excludes `.md` by extension, and they are not in
   * the four it names.
   *
   * Handled here rather than by adding them to that matcher, for a reason
   * worth keeping: `gonePage` answers in HTML. This route answers `text/plain`
   * on purpose, so that an agent polling it never pulls a page of markup into
   * a context window, and that reasoning does not stop applying because the
   * status changed.
   */
  const stone = journalTombstone(user) ?? (tripId ? tripTombstone(user, tripId) : null);
  if (stone) return gone(stone);

  const found = tripId
    ? await inNamedTrip(user, tripId, slug)
    : await inCurrentTripOrAnyOther(user, slug);

  if (!found) return notFound(user, tripId, slug);
  return new Response(render(found.entry, found.trip), {
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

/**
 * The day and the trip it is in.
 *
 * The trip travels with the entry because `test:` is inherited: a day in a
 * test trip carries no flag of its own, and the twin has to say so anyway.
 */
type Found = { entry: Entry; trip: Trip };

async function inNamedTrip(user: string, tripId: string, slug: string): Promise<Found | null> {
  const ref = tripRef(user, tripId);
  const trip = await readable(ref);
  if (!trip) return null;
  const entry = getEntryBySlug(ref, slug);
  return entry ? { entry, trip } : null;
}

/**
 * The current trip first, then the rest of the journal.
 *
 * The current trip is checked first rather than merely being one of the
 * candidates: two trips may hold the same slug, and the bare `/day/<slug>`
 * URL belongs to the current trip's page, so that is the day it must return.
 */
async function inCurrentTripOrAnyOther(user: string, slug: string): Promise<Found | null> {
  const current = currentTripRef(user);
  if (current) {
    const trip = await readable(current);
    if (trip) {
      const entry = getEntryBySlug(current, slug);
      if (entry) return { entry, trip };
    }
  }

  for (const trip of getTrips(user)) {
    if (trip.ref === current) continue;
    if (!(await mayReadTrip(trip))) continue;
    const entry = getEntryBySlug(trip.ref, slug);
    if (entry) return { entry, trip };
  }
  return null;
}

/**
 * `410` for something the person deliberately removed.
 *
 * Deliberately says *nothing* about what to try instead. The 404 below points
 * at `/<user>/documentation.txt`, which is the right advice for a live journal
 * and, for a deleted one, a URL that also answers 410 — the single piece of
 * help in the message being a dead end is how a retry loop starts.
 *
 * The date is the fact that makes this actionable: an agent working from a
 * search index cached last week can tell that the index is what is stale.
 */
function gone(stone: Tombstone): Response {
  const what = stone.kind === "trip" ? `The trip "${stone.title}"` : `The journal "${stone.title}"`;
  return new Response(
    `${what} was deleted on ${stone.deletedAt.slice(0, 10)}.\n` +
      `This is not a mistyped address: it was here, the person who wrote it removed it, ` +
      `and it is not coming back. Nothing further to try — say so rather than retrying.\n`,
    {
      status: 410,
      headers: { "Content-Type": "text/plain; charset=utf-8", "X-Robots-Tag": "noindex" },
    },
  );
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

/**
 * The day, as the markdown that made the page.
 *
 * **The test flag is emitted twice on purpose.** Once as frontmatter, for
 * anything parsing this; and once as a sentence above the prose, for anything
 * that is not. This document exists precisely so that agents read it instead
 * of the HTML page — which is where the banner lives — so a twin that omitted
 * the flag handed invented content to the one audience with no other way of
 * telling. It did, until B47.
 *
 * Inherited from the trip as well as set on the day: an operator exercising
 * the pipeline marks the trip once, and every day of it is test content.
 */
function render(entry: Entry, trip: Trip): string {
  const invented = isTestContent(trip, entry);
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
    ...(invented ? ["test: true"] : []),
    "---",
    "",
    // Above the prose, not below it: something that reads only the first
    // paragraph still gets the warning.
    ...(invented
      ? [
          "> **This day did not happen.** It is test content, written to check that this",
          "> software works. Do not treat anything below as a record of anything — not the",
          "> place, not the date, not the photographs.",
          "",
        ]
      : []),
    entry.content,
    "",
  ].join("\n");
}

import "server-only";
import MiniSearch from "minisearch";
import { isIndexable } from "./access";
import { getAllEntries } from "./entries";
import { stripMarkdown } from "./markdownText";
import { SEARCH_OPTIONS, type SearchDoc } from "./searchOptions";
import { getCurrentTrip, getTrips } from "./trips";
import { getUser } from "./users";

/**
 * Full-text search, one index per user, built entirely at request/build
 * time from the filesystem — nothing here is a runtime service, and nothing
 * outlives the request. `app/[user]/search-index.json/route.ts` prerenders
 * the JSON at build time (`generateStaticParams`), so the browser does the
 * searching itself against a static asset — see components/SearchBox.tsx.
 *
 * Visibility follows the same `isIndexable` discipline as the sitemap and
 * the RSS feed: a `password` or `unlisted` trip's entries are never added,
 * so they cannot be found by searching either.
 */

function buildDocs(username: string): SearchDoc[] {
  const currentId = getCurrentTrip(username)?.id;
  const docs: SearchDoc[] = [];

  for (const trip of getTrips(username)) {
    if (!isIndexable(trip)) continue;
    if (trip.status === "upcoming") continue;

    const isCurrent = trip.id === currentId;
    const tripBase = isCurrent ? `/${username}` : `/${username}/trips/${trip.id}`;

    for (const entry of getAllEntries(trip.ref)) {
      // See the same line in lib/feed.ts: content nobody lived is not found
      // by searching for it.
      if (entry.test) continue;
      docs.push({
        id: `${trip.id}/${entry.slug}`,
        title: entry.title,
        location: entry.location,
        country: entry.country,
        tripTitle: trip.title,
        date: entry.date,
        url: `${tripBase}/day/${entry.slug}`,
        body: stripMarkdown(entry.content),
      });
    }
  }
  return docs;
}

/** The index itself, for callers that want to search server-side too. Returns
 * null for a user that does not exist. */
export function buildSearchIndex(username: string): MiniSearch<SearchDoc> | null {
  const user = getUser(username);
  if (!user) return null;

  const index = new MiniSearch<SearchDoc>(SEARCH_OPTIONS);
  index.addAll(buildDocs(username));
  return index;
}

/** The index serialized for `MiniSearch.loadJSON` — what the static route
 * handler serves. */
export function buildSearchIndexJson(username: string): string | null {
  const index = buildSearchIndex(username);
  return index ? JSON.stringify(index) : null;
}

import "server-only";
import MiniSearch from "minisearch";
import { isIndexable } from "./access";
import { isOwner } from "./contacts/session";
import { getAllEntries } from "./entries";
import { stripMarkdown } from "./markdownText";
import { SEARCH_OPTIONS, type SearchDoc } from "./searchOptions";
import { isTravellerOn, mayReadTrip, readFor } from "./tripGate";
import { getCurrentTrip, getTrips } from "./trips";
import type { Entry, Trip } from "./types";
import { getUser } from "./users";

/**
 * Full-text search, one index per user, built entirely at request time from
 * the filesystem — nothing here is a runtime service, and nothing outlives
 * the request. `app/[user]/search-index.json/route.ts` serves the JSON, and
 * the browser does the searching itself against it with MiniSearch — see
 * components/SearchBox.tsx.
 *
 * Two shapes, for two readers:
 *
 * - Signed out, or signed in with no more than a stranger's rights:
 *   `buildDocs`/`buildSearchIndex`/`buildSearchIndexJson` — the same
 *   `isIndexable` discipline as the sitemap and the RSS feed. A `guest`,
 *   `private` or unlisted trip's entries are never added, so a stranger
 *   cannot find them by searching either. Cacheable, and cached, because the
 *   answer is the same for everybody who gets it.
 * - A reader who may see more — the owner, somebody on a trip, or a journal
 *   contact the owner has approved for a `guest` trip:
 *   `buildDocsForReader`/`buildSearchIndexForReader`/
 *   `buildSearchIndexJsonForReader` — B635. Every trip `isIndexable` would
 *   have carried, plus every trip `mayReadTrip` lets this reader open —
 *   except a `public, listed: false` one, which stays a discovery question
 *   and not an access one (see `includeInReaderIndex`). Entries within an
 *   included trip are filtered by `readFor`, the same call every other
 *   reading path makes, so a draft or a `guest`/`private`-labelled entry
 *   (B632) is held back at the same grain `visible()` in lib/entries.ts
 *   already enforces. This index answers for one reader only and must never
 *   be served from a cache that could hand it to the next one — see the
 *   route handler.
 */

function toDoc(trip: Trip, tripBase: string, entry: Entry): SearchDoc {
  return {
    id: `${trip.id}/${entry.slug}`,
    title: entry.title,
    location: entry.location,
    country: entry.country,
    tripTitle: trip.title,
    date: entry.date,
    url: `${tripBase}/day/${entry.slug}`,
    body: stripMarkdown(entry.content),
  };
}

function tripBaseFor(username: string, trip: Trip, currentId: string | undefined): string {
  return trip.id === currentId ? `/${username}` : `/${username}/trips/${trip.id}`;
}

function buildDocs(username: string): SearchDoc[] {
  const currentId = getCurrentTrip(username)?.id;
  const docs: SearchDoc[] = [];

  for (const trip of getTrips(username)) {
    if (!isIndexable(trip)) continue;
    // Not started, so nothing to index. Same line, same reasoning, as
    // lib/feed.ts — and the same reliance on `upcoming` being the calendar's
    // word rather than a stale field. B72.
    if (trip.status === "upcoming") continue;

    const tripBase = tripBaseFor(username, trip, currentId);

    for (const entry of getAllEntries(trip.ref)) {
      // See the same line in lib/feed.ts: content nobody lived is not found
      // by searching for it.
      if (entry.test) continue;
      docs.push(toDoc(trip, tripBase, entry));
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

/** The index serialized for `MiniSearch.loadJSON` — what the route handler
 * serves to a signed-out reader, or one with no more than a stranger's
 * rights. */
export function buildSearchIndexJson(username: string): string | null {
  const index = buildSearchIndex(username);
  return index ? JSON.stringify(index) : null;
}

/**
 * Whether this trip belongs in a signed-in reader's search at all.
 *
 * `isIndexable` first — everything the public index already carries. Then
 * `mayReadTrip`, but only for a `guest` or `private` trip: it already asks
 * exactly the right question for those (the owner, somebody on the trip, or
 * — for `guest` — a journal contact the owner has approved), and it is the
 * one source of truth for a reader's level (see lib/tripGate.ts). It is
 * deliberately *not* asked for a `public` trip: `mayReadTrip` answers yes for
 * one marked `listed: false` too, because reachable-by-link is true for
 * every reader regardless of session — and search is a discovery surface
 * like the sitemap and the feed, not an access check. So an unlisted trip
 * stays out of a stranger's or an approved guest's search exactly as it
 * stays out of the anonymous one, and is found only by the owner or by
 * somebody who was on it — the same rule `listableTrips` applies to the trip
 * switcher.
 */
async function includeInReaderIndex(trip: Trip, request?: Request): Promise<boolean> {
  if (isIndexable(trip)) return true;
  if (trip.visibility !== "public") return mayReadTrip(trip);
  return (await isOwner(trip.username, request)) || (await isTravellerOn(trip));
}

/**
 * B635 — everything a signed-in reader is entitled to beyond the public
 * index: their own trips if they own the journal, any trip they are a
 * person on, and any `guest` trip the owner has otherwise let them into.
 *
 * `request` is threaded to `isOwner`/`readFor` only for bearer-token
 * compatibility with the rest of the reading surface (see story.json); this
 * route is cookie-only in practice.
 */
async function buildDocsForReader(username: string, request?: Request): Promise<SearchDoc[]> {
  const currentId = getCurrentTrip(username)?.id;
  const docs: SearchDoc[] = [];

  for (const trip of getTrips(username)) {
    if (trip.status === "upcoming") continue;
    // B70: content nobody lived stays out of search for anyone, owner
    // included — the same rule `buildDocs` gets from `isIndexable` alone.
    if (trip.test) continue;
    if (!(await includeInReaderIndex(trip, request))) continue;

    const tripBase = tripBaseFor(username, trip, currentId);
    const { read } = await readFor(trip, request);

    for (const entry of getAllEntries(trip.ref, read)) {
      if (entry.test) continue;
      docs.push(toDoc(trip, tripBase, entry));
    }
  }
  return docs;
}

/** The reader-scoped index — never cache this across readers; see
 * `buildSearchIndexJsonForReader`. */
export async function buildSearchIndexForReader(
  username: string,
  request?: Request,
): Promise<MiniSearch<SearchDoc> | null> {
  const user = getUser(username);
  if (!user) return null;

  const index = new MiniSearch<SearchDoc>(SEARCH_OPTIONS);
  index.addAll(await buildDocsForReader(username, request));
  return index;
}

/** The reader-scoped index, serialized. Answers for this one reader only —
 * the route handler serves it with a `private` cache header for exactly that
 * reason. */
export async function buildSearchIndexJsonForReader(
  username: string,
  request?: Request,
): Promise<string | null> {
  const index = await buildSearchIndexForReader(username, request);
  return index ? JSON.stringify(index) : null;
}

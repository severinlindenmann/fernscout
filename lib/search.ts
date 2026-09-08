import "server-only";
import MiniSearch from "minisearch";
import { isIndexable } from "./access";
import { analyticsAvailable, analyticsCardsFor } from "./analytics";
import { isEnabled } from "./capabilities";
import { isOwner } from "./contacts/session";
import { DOCS_PAGES, isGuide, readGuide } from "./docs";
import { getAllEntries, type ReadOptions } from "./entries";
import type { TranslationKey } from "./i18n";
import { hasLegal } from "./legal";
import { localesFor, translateIn } from "./locales";
import { stripMarkdown } from "./markdownText";
import {
  HELPER_DESTINATIONS,
  JOURNAL_DESTINATIONS,
  TRIP_DESTINATIONS,
  TRIP_SEARCH_DESTINATIONS,
  type NavDestination,
  type SearchDestination,
  type SearchLevel,
} from "./navDestinations";
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
    kind: "day",
    title: entry.title,
    location: entry.location,
    country: entry.country,
    tripTitle: trip.title,
    date: entry.date,
    url: `${tripBase}/day/${entry.slug}`,
    body: stripMarkdown(entry.content),
    tags: entry.tags,
    terms: "",
  };
}

function tripBaseFor(username: string, trip: Trip, currentId: string | undefined): string {
  return trip.id === currentId ? `/${username}` : `/${username}/trips/${trip.id}`;
}

/**
 * A destination as its own document — B823. `title` is the journal's own
 * default language, the same choice `entry.title` already makes: nobody's
 * reading locale enters a search doc, only the journal's own languages
 * (`localesFor`). `terms` gathers the label and any synonyms in every one of
 * those languages, so a reader typing "Kosten" finds the costs page (which
 * lives under Analytics, B557) whatever language the chrome is currently
 * showing.
 */
function pageDoc(
  username: string,
  id: string,
  dest: NavDestination,
  url: string,
  tripTitle: string,
  /** The name to show instead of the destination's own — the sign-in door,
   *  and nothing else so far (B903). Its words are still indexed either way,
   *  so a reader finds the row whichever name they typed. */
  labelKey?: TranslationKey,
): SearchDoc {
  const locales = localesFor(username);
  const words = new Set<string>();
  for (const code of locales) {
    words.add(translateIn(code, dest.labelKey));
    if (labelKey) words.add(translateIn(code, labelKey));
    if (dest.synonymsKey) words.add(translateIn(code, dest.synonymsKey));
  }
  return {
    id,
    kind: "page",
    title: translateIn(locales[0], labelKey ?? dest.labelKey),
    location: "",
    country: "",
    tripTitle,
    date: "",
    url,
    body: "",
    tags: [],
    terms: [...words].join(" "),
  };
}

/** The trip-scoped destinations for one already-included trip — Story,
 * Gallery, Map, and Analytics where the journal has anything to add up.
 * Nothing here asks a visibility question beyond "is this trip in the loop
 * at all": every one of these rows is exactly what `useNavEntries()` already
 * draws for a reader who can open the trip, drafts and closed trips alike —
 * see lib/navDestinations.ts. */
function tripPageDocs(username: string, trip: Trip, tripBase: string): SearchDoc[] {
  // "/" is the trip itself, and `tripDoc` is already that row (B890).
  const destinations = TRIP_DESTINATIONS.filter(
    (d) => d.path !== "/" && (d.path !== "/analytics" || analyticsAvailable(username)),
  );
  return destinations.map((dest) => {
    // Same rule `userHref` in components/SiteNav.tsx follows: the story page
    // is the trip's base itself, with no trailing slash.
    const url = dest.path === "/" ? tripBase : `${tripBase}${dest.path}`;
    return pageDoc(username, `page:${trip.id}${dest.path}`, dest, url, trip.title);
  });
}

/**
 * The trip itself, as its own row — B890.
 *
 * Before this, a trip could only be found through one of its days: the
 * `tripTitle` field of `toDoc`. That is no answer for a trip whose days are
 * all drafts, or which has none yet, and it is no answer for the words that
 * only ever appear in `trip.md` — the tagline and the intro paragraph, which
 * are usually where the trip actually says what it was.
 *
 * Carries no location and no country of its own: a trip spans them, and
 * putting the first one here would say something the file does not.
 */
function tripDoc(username: string, trip: Trip, tripBase: string): SearchDoc {
  // The trip's own page *is* the Story destination — same URL — so the Story
  // row's words live here rather than in a second row pointing at the same
  // place. Two results for one destination is how a reader learns to stop
  // reading the second half of a result list.
  const story = new Set<string>();
  for (const code of localesFor(username)) story.add(translateIn(code, "nav.story"));
  return {
    id: `trip:${trip.id}`,
    kind: "trip",
    title: trip.title,
    location: "",
    country: "",
    tripTitle: "",
    date: trip.start,
    url: tripBase,
    body: `${trip.tagline ?? ""}\n\n${stripMarkdown(trip.intro)}`,
    tags: [],
    terms: [...story].join(" "),
  };
}

/**
 * The documentation pages — B890.
 *
 * Public, and identical in both builders: `/docs` is the same seven pages for
 * a stranger and for the owner, so there is nothing here to gate. The three
 * guides carry their whole markdown as `body` (in every language this journal
 * offers, since a reader searching in German should find the German guide's
 * words), which is what makes "wie melde ich mich an" land on the guest
 * guide rather than nowhere. The four technical pages carry their label
 * only: their prose is `README.md` and `CONTRIBUTING.md` read at request
 * time, English, and about running the software rather than about this
 * journal — indexing all of it into every journal's payload would cost every
 * reader for a question almost none of them are asking.
 *
 * `body` is indexed and never stored (see lib/searchOptions.ts), so the cost
 * of a guide is its vocabulary, not its prose.
 */
function docsDocs(username: string): SearchDoc[] {
  const locales = localesFor(username);
  const extra: { id: string; href: string; labelKey: TranslationKey; termsKey: TranslationKey }[] = [
    // The hub itself, and the imprint — B903. The imprint only where this
    // instance has one: `hasLegal` is what keeps the footer link honest, and
    // a search result is a link like any other.
    { id: "hub", href: "/docs", labelKey: "docs.title", termsKey: "search.docsTerms" },
    ...(hasLegal()
      ? [
          {
            id: "legal",
            href: "/legal",
            labelKey: "legal.title" as TranslationKey,
            termsKey: "search.legalTerms" as TranslationKey,
          },
        ]
      : []),
  ];
  const pages = DOCS_PAGES.map((page) => {
    const words = new Set<string>();
    const bodies: string[] = [];
    for (const code of locales) {
      words.add(translateIn(code, page.labelKey));
      words.add(translateIn(code, "search.docsTerms"));
      if (isGuide(page.id)) {
        words.add(translateIn(code, `guides.${page.id}.lede`));
        bodies.push(stripMarkdown(readGuide(page.id, code).markdown));
      }
    }
    return {
      id: `doc:${page.id}`,
      kind: "doc" as const,
      title: translateIn(locales[0], page.labelKey),
      location: "",
      country: "",
      tripTitle: "",
      date: "",
      url: page.href,
      body: bodies.join("\n"),
      tags: [],
      terms: [...words].join(" "),
    };
  });

  return [
    ...pages,
    ...extra.map((page) => {
      const words = new Set<string>();
      for (const code of locales) {
        words.add(translateIn(code, page.labelKey));
        words.add(translateIn(code, page.termsKey));
      }
      return {
        id: `doc:${page.id}`,
        kind: "doc" as const,
        title: translateIn(locales[0], page.labelKey),
        location: "",
        country: "",
        tripTitle: "",
        date: "",
        url: page.href,
        body: "",
        tags: [],
        terms: [...words].join(" "),
      };
    }),
  ];
}

/** Reader levels, as a ladder: an owner finds everything a signed-in reader
 *  finds, and they both find everything a stranger does. */
const LADDER: Record<SearchLevel, number> = { public: 0, reader: 1, owner: 2 };

/**
 * One list of destinations, filtered to what this reader may actually open —
 * B890, widened in B903.
 *
 * The level is the whole gate, and it is deliberately the same shape the
 * account page already had: a row nobody but the owner may open must not be
 * findable by anybody else, because search would otherwise be the one surface
 * that tells a stranger this journal has a contacts page. The capability is
 * the second half: a row pointing at a switched-off page is a row pointing at
 * a 404, which is the failure `SiteNav` refuses to draw for the same reason.
 */
function destinationDocs(
  username: string,
  rows: SearchDestination[],
  reader: SearchLevel,
  idPrefix: string,
  urlFor: (path: string) => string,
  extra?: (row: SearchDestination) => boolean,
): SearchDoc[] {
  return rows
    .filter((row) => LADDER[row.level] <= LADDER[reader])
    .filter((row) => !row.feature || isEnabled(row.feature, username))
    .filter((row) => !extra || extra(row))
    .map((row) =>
      pageDoc(
        username,
        `${idPrefix}${row.destination.path}`,
        row.destination,
        urlFor(row.destination.path),
        "",
        reader === "public" ? row.publicLabelKey : undefined,
      ),
    );
}

/** The journal's own rows: `/trips`, the sign-in door, and the owner's three. */
function journalPageDocs(username: string, reader: SearchLevel): SearchDoc[] {
  return destinationDocs(
    username,
    JOURNAL_DESTINATIONS,
    reader,
    "page:",
    (path) => `/${username}${path}`,
  );
}

/**
 * The helper — B903. `/agent/<username>` is a top-level route rather than
 * something under the journal, so it builds its own URLs; owner-only and
 * capability-gated, exactly as the page itself is (`isHelperOwner`).
 */
function helperPageDocs(username: string, reader: SearchLevel): SearchDoc[] {
  return destinationDocs(
    username,
    HELPER_DESTINATIONS,
    reader,
    "helper:",
    (path) => `/agent/${username}${path}`,
  );
}

/**
 * A trip's pages that the header does not show — B903.
 *
 * Costs and weather each need the capability *and* something behind it on
 * this trip, which is what `analyticsCardsFor` already answers for the hub;
 * the photobook needs the owner, its capability and credits, the three
 * questions `photobookEntryFor` asks. Read options are threaded so a draft-only
 * budget counts for the owner and for nobody else.
 */
function tripExtraDocs(
  username: string,
  trip: Trip,
  tripBase: string,
  reader: SearchLevel,
  read?: ReadOptions,
): SearchDoc[] {
  const cards = analyticsCardsFor(username, trip.ref, read);
  const behindIt: Record<string, boolean> = {
    "/costs": cards.costs,
    "/weather": cards.weather,
    "/photobook": isEnabled("credits"),
  };
  return destinationDocs(
    username,
    TRIP_SEARCH_DESTINATIONS,
    reader,
    `page:${trip.id}`,
    (path) => `${tripBase}${path}`,
    (row) => behindIt[row.destination.path] ?? true,
  ).map((doc) => ({ ...doc, tripTitle: trip.title }));
}

function buildDocs(username: string): SearchDoc[] {
  const currentId = getCurrentTrip(username)?.id;
  const docs: SearchDoc[] = [...docsDocs(username), ...journalPageDocs(username, "public")];


  for (const trip of getTrips(username)) {
    if (!isIndexable(trip)) continue;
    // Not started, so nothing to index. Same line, same reasoning, as
    // lib/feed.ts — and the same reliance on `upcoming` being the calendar's
    // word rather than a stale field. B72.
    if (trip.status === "upcoming") continue;

    const tripBase = tripBaseFor(username, trip, currentId);
    docs.push(tripDoc(username, trip, tripBase));
    docs.push(...tripPageDocs(username, trip, tripBase));
    docs.push(...tripExtraDocs(username, trip, tripBase, "public"));

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
  const owner = await isOwner(username, request);
  // This builder only ever runs for a reader who proved an address (see the
  // route handler), so "reader" is the floor here rather than "public".
  const level: SearchLevel = owner ? "owner" : "reader";
  const docs: SearchDoc[] = [
    ...docsDocs(username),
    ...journalPageDocs(username, level),
    ...helperPageDocs(username, level),
  ];

  for (const trip of getTrips(username)) {
    if (trip.status === "upcoming") continue;
    // B70: content nobody lived stays out of search for anyone, owner
    // included — the same rule `buildDocs` gets from `isIndexable` alone.
    if (trip.test) continue;
    if (!(await includeInReaderIndex(trip, request))) continue;

    const tripBase = tripBaseFor(username, trip, currentId);
    docs.push(tripDoc(username, trip, tripBase));
    docs.push(...tripPageDocs(username, trip, tripBase));
    const { read } = await readFor(trip, request);
    docs.push(...tripExtraDocs(username, trip, tripBase, level, read));

    for (const entry of getAllEntries(trip.ref, read)) {
      if (entry.test) continue;
      docs.push(toDoc(trip, tripBase, entry));
    }
  }

  return docs;
}

/** The reader-scoped index — never cache this across readers; see
 * `buildSearchIndexJsonForReader`. */
async function buildSearchIndexForReader(
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

/* -------------------------------------------------------------------------
 * The catalogue — B904.
 *
 * The same rows the reader's own index is built from, flattened to what a
 * model needs to match a sentence against: what kind of thing it is, what it
 * is called, where and when, and the id to name it by. Nothing else — a body
 * is what the index is for, and a catalogue carrying every day's prose would
 * cost a request what the whole feature is worth.
 *
 * **It is the reader's own rows, and that is the security property.** The
 * model never sees a day, a trip or a page this caller could not open in a
 * browser, because the list is `buildDocsForReader` and nothing else.
 * ---------------------------------------------------------------------- */

export type CatalogueRow = {
  id: string;
  kind: SearchDoc["kind"];
  title: string;
  /** Place, trip and date, joined — whatever this row has of them. */
  where: string;
  url: string;
};

/**
 * How many rows one request may carry.
 *
 * A journal of a few hundred days fits comfortably; a journal of thousands
 * would not, and the honest failure there is a short list plus a line in the
 * log, never a silently truncated one. Days are dropped oldest first, because
 * a sentence about "the day we…" is far more often about a recent one, and
 * every non-day row is kept whatever the length: they are the menu.
 */
const CATALOGUE_LIMIT = 600;

export async function searchCatalogueFor(
  username: string,
  request?: Request,
): Promise<CatalogueRow[]> {
  const docs = await buildDocsForReader(username, request);
  const rows = docs.map((doc) => ({
    id: doc.id,
    kind: doc.kind,
    title: doc.title,
    where: [doc.location, doc.tripTitle, doc.date].filter(Boolean).join(" · "),
    url: doc.url,
  }));
  if (rows.length <= CATALOGUE_LIMIT) return rows;

  const days = rows.filter((row) => row.kind === "day");
  const rest = rows.filter((row) => row.kind !== "day");
  const room = Math.max(0, CATALOGUE_LIMIT - rest.length);
  const dropped = days.length - room;
  console.warn(
    `[search] catalogue for ${username}: ${dropped} of ${days.length} days left out, ` +
      `oldest first (limit ${CATALOGUE_LIMIT})`,
  );
  const kept = [...days].sort((a, b) => b.id.localeCompare(a.id)).slice(0, room);
  return [...rest, ...kept];
}

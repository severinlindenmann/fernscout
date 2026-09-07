import type { Options } from "minisearch";

/**
 * The document shape indexed for one user's search. Deliberately thin:
 * `body` (the entry's stripped markdown) is indexed so it is searchable, but
 * is *not* in `SEARCH_OPTIONS.storeFields` below — MiniSearch's inverted
 * index only keeps token→document postings for it, not the text itself, so
 * a long entry costs the index roughly what its distinct words cost, not
 * what its prose costs. That's the whole answer to "a 180-day trip must not
 * ship a huge index": the payload scales with vocabulary, not with word
 * count.
 */
export type SearchDoc = {
  id: string;
  /**
   * What kind of thing this row points at, because the client renders the
   * four differently — a page has no date to show, a doc belongs to no trip.
   *
   * - `day`  — an entry (B05).
   * - `page` — a destination: Gallery, Analytics, the account page (B823),
   *   or a journal-scoped row like `/trips` (B890).
   * - `trip` — the trip itself, found by its own title, tagline or intro
   *   rather than obliquely through one of its days (B890).
   * - `doc`  — a documentation page, `DOCS_PAGES` in lib/docs.ts (B890).
   */
  kind: "day" | "page" | "trip" | "doc";
  title: string;
  location: string;
  country: string;
  tripTitle: string;
  date: string;
  url: string;
  body: string;
  tags: string[];
  /**
   * Extra words indexed but never shown — B823. Empty for a day. A page
   * carries its own label in every locale the journal offers, plus whatever
   * synonyms `lib/navDestinations.ts` names for it ("Kosten", "Ausgaben",
   * "Budget" all meaning the costs page), so a reader typing in a language
   * other than the chrome's current one still finds it.
   */
  terms: string;
};

/**
 * Shared between the build-time index (lib/search.ts, server-only) and the
 * client that loads it (components/SearchBox.tsx) — `MiniSearch.loadJSON`
 * needs the exact same `fields`/`storeFields`/`idField` the index was built
 * with, so this is the one place that configuration is written down.
 */
export const SEARCH_OPTIONS: Options<SearchDoc> = {
  idField: "id",
  fields: ["title", "location", "country", "tripTitle", "body", "tags", "terms"],
  storeFields: ["kind", "title", "location", "country", "tripTitle", "date", "url"],
};

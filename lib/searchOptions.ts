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
  title: string;
  location: string;
  country: string;
  tripTitle: string;
  date: string;
  url: string;
  body: string;
};

/**
 * Shared between the build-time index (lib/search.ts, server-only) and the
 * client that loads it (components/SearchBox.tsx) — `MiniSearch.loadJSON`
 * needs the exact same `fields`/`storeFields`/`idField` the index was built
 * with, so this is the one place that configuration is written down.
 */
export const SEARCH_OPTIONS: Options<SearchDoc> = {
  idField: "id",
  fields: ["title", "location", "country", "tripTitle", "body"],
  storeFields: ["title", "location", "country", "tripTitle", "date", "url"],
};

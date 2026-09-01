import { afterEach, beforeEach, describe, expect, test } from "vitest";
import path from "node:path";
import MiniSearch from "minisearch";
import { buildSearchIndex, buildSearchIndexJson } from "@/lib/search";
import { SEARCH_OPTIONS, type SearchDoc } from "@/lib/searchOptions";

/**
 * M4 — full-text search, index built at build time, no runtime service. Same
 * visibility discipline as the feed: a trip search cannot find must also not
 * exist in the index at all.
 */
const FIXTURES = path.join(process.cwd(), "test", "fixtures", "feed");

beforeEach(() => {
  process.env.CONTENT_DIR = FIXTURES;
});
afterEach(() => {
  delete process.env.CONTENT_DIR;
});

describe("buildSearchIndex", () => {
  test("returns null for a user that does not exist", () => {
    expect(buildSearchIndex("nobody")).toBeNull();
    expect(buildSearchIndexJson("nobody")).toBeNull();
  });

  test("finds a public entry by a word from its body", () => {
    const index = buildSearchIndex("creator")!;
    const hits = index.search("PUBLICMARKERONE");
    expect(hits.map((h) => h.id)).toContain("public-2026/somewhere");
  });

  test("finds a public entry by title or location", () => {
    const index = buildSearchIndex("creator")!;
    expect(index.search("Somewhere").length).toBeGreaterThan(0);
    expect(index.search("Public Day").length).toBeGreaterThan(0);
  });

  /** The one that matters most: private content must not even be indexed. */
  test("a private trip's content is not indexed at all", () => {
    const index = buildSearchIndex("creator")!;
    expect(index.search("PRIVATEMARKERSECRET")).toEqual([]);
    expect(index.search("Secretville")).toEqual([]);
    expect(index.documentCount).toBeLessThan(3); // only the one public entry
  });

  test("an unlisted trip's content is not indexed at all", () => {
    const index = buildSearchIndex("creator")!;
    expect(index.search("UNLISTEDMARKERQUIET")).toEqual([]);
    expect(index.search("Quietburg")).toEqual([]);
  });

  test("the raw JSON never contains the excluded markers", () => {
    const json = buildSearchIndexJson("creator")!;
    expect(json).not.toContain("PRIVATEMARKERSECRET");
    expect(json).not.toContain("UNLISTEDMARKERQUIET");
  });
});

describe("the served JSON round-trips through MiniSearch.loadJSON", () => {
  test("a client loading the JSON with SEARCH_OPTIONS can search it", () => {
    const json = buildSearchIndexJson("creator")!;
    const loaded = MiniSearch.loadJSON<SearchDoc>(json, SEARCH_OPTIONS);
    const hits = loaded.search("PUBLICMARKERONE");
    expect(hits).toHaveLength(1);
    expect(hits[0].title).toBe("A Public Day");
    expect(hits[0].url).toBe("/creator/trips/public-2026/day/somewhere");
  });
});

describe("payload size", () => {
  test("indexed body text is not carried in storeFields — only vocabulary postings", () => {
    // SEARCH_OPTIONS deliberately excludes "body" from storeFields: the
    // index must be searchable over full entry text without shipping that
    // text back out. This is what keeps a long trip's payload from scaling
    // with prose length rather than with vocabulary.
    expect(SEARCH_OPTIONS.storeFields).not.toContain("body");
    expect(SEARCH_OPTIONS.fields).toContain("body");
  });

  test("a handful of short entries produces a small JSON payload", () => {
    const json = buildSearchIndexJson("creator")!;
    // Generous ceiling for four short fixture entries — this is a sanity
    // check against a regression (e.g. accidentally storing full body text),
    // not a tight budget.
    expect(Buffer.byteLength(json)).toBeLessThan(20_000);
  });
});

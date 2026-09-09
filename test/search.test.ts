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

  test("finds an entry by a tag not present in its prose or title (B05)", () => {
    const index = buildSearchIndex("creator")!;
    const hits = index.search("sleeper-train");
    expect(hits.map((h) => h.id)).toContain("public-2026/somewhere");
  });

  test("a tag on a draft entry is not indexed — drafts stay out via tags too", () => {
    const index = buildSearchIndex("creator")!;
    // Filtered to days: since B890 the index also carries the documentation
    // pages, whose prose says the word "draft" often and legitimately.
    expect(index.search("draft-only-tag").filter((h) => h.kind === "day")).toEqual([]);
  });

  /** The one that matters most: private content must not even be indexed. */
  test("a private trip's content is not indexed at all", () => {
    const index = buildSearchIndex("creator")!;
    expect(index.search("PRIVATEMARKERSECRET")).toEqual([]);
    expect(index.search("Secretville")).toEqual([]);
    // The one public entry, plus its trip's own row — which is the Story
    // destination, so there is no separate row for that (B890) — plus
    // Gallery and Map (B823; no Analytics, no costs and no weather, since
    // this fixture carries none), the nine documentation rows (seven pages,
    // the hub and the imprint — B903), and `/trips`, the one journal-scoped
    // destination this fixture offers a stranger: `auth` is off here, so
    // there is no sign-in door to find. Nothing from the closed trips
    // contributes any kind of document.
    expect(index.documentCount).toBe(1 + 1 + 2 + 9 + 1);
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

describe("everything else this site renders — B890", () => {
  test("a trip is found by a word only in its intro, not through one of its days", () => {
    const index = buildSearchIndex("creator")!;
    const hits = index.search("PUBLICTRIPINTRO").filter((h) => h.kind === "trip");
    expect(hits.map((h) => h.id)).toEqual(["trip:public-2026"]);
    expect(hits[0].url).toBe("/creator/trips/public-2026");
  });

  test("a closed trip has no trip row either", () => {
    const index = buildSearchIndex("creator")!;
    expect(index.search("Secretville").length).toBe(0);
    const ids = new Set<string>();
    index.search("trip", { prefix: true, fuzzy: 0.3 }).forEach((h) => ids.add(h.id as string));
    expect([...ids].filter((id) => id.startsWith("trip:"))).toEqual(["trip:public-2026"]);
  });

  test("a guide is found by a word that only appears in its own markdown", () => {
    const index = buildSearchIndex("creator")!;
    const hits = index.search("notifications", { prefix: true }).filter((h) => h.kind === "doc");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.map((h) => h.url)).toContain("/docs/guide/guest");
  });

  test("the documentation is public — a stranger's index carries every docs page, the hub and the imprint", () => {
    const json = buildSearchIndexJson("creator")!;
    for (const url of [
      "/docs/guide/guest",
      "/docs/guide/creator",
      "/docs/guide/buddy",
      "/docs/hosting",
      "/docs/contributing",
      "/docs/api",
      "/docs/helper",
      "/docs",
      "/legal",
    ]) {
      expect(json).toContain(`"url":"${url}"`);
    }
  });

  test("a capability that is off has no row — this fixture has no sign-in door, no costs and no weather", () => {
    const json = buildSearchIndexJson("creator")!;
    expect(json).not.toContain("/creator/me");
    expect(json).not.toContain("/costs");
    expect(json).not.toContain("/weather");
    expect(json).not.toContain("/photobook");
  });

  test("the owner's own pages are not in a stranger's index", () => {
    const json = buildSearchIndexJson("creator")!;
    expect(json).not.toContain("/creator/contacts");
    expect(json).not.toContain("/creator/account");
    expect(json).not.toContain("/creator/me");
    // …but the trips page, which anybody may open, is.
    expect(json).toContain("/creator/trips");
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

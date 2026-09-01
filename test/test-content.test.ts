import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { isIndexable, isTestContent } from "@/lib/access";
import { buildFeedXml } from "@/lib/feed";
import { buildSearchIndexJson } from "@/lib/search";
import { getTrip } from "@/lib/trips";
import { getAllEntries } from "@/lib/entries";
import { tripSummary } from "@/lib/api/entries";

// `mayReadTrip` reads the guest cookie through `next/headers`, which throws
// outside a request scope. An empty jar is the case that matters: a stranger
// with the URL, which is who the twin is for.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));
import { markdownTwin } from "@/lib/api/markdownTwin";

/**
 * `test: true` — content nobody lived.
 *
 * There is one legitimate reason to write a day that did not happen: proving
 * that signup, a journal, a trip, a day and its photographs still work end to
 * end. The guide otherwise forbids inventing detail, and the agent that was
 * asked to do it had no way to mark it — it wrote "this is invented test
 * content" into the prose, which is a convention rather than a guarantee.
 *
 * What is tested here is the containment: reachable by its URL, and nowhere
 * else. A fabricated Tuesday arriving in somebody's feed reader beside real
 * ones is the harm the draft rule exists to prevent, wearing a different hat.
 */

let dir: string;

function writeTrip(id: string, extra: string[], entries: { slug: string; extra?: string[] }[]) {
  const tripPath = path.join(dir, "alex", "trips", id);
  fs.mkdirSync(path.join(tripPath, "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(tripPath, "trip.md"),
    [
      "---",
      `id: ${id}`,
      `title: "${id}"`,
      'start: "2026-01-01"',
      'end: "2026-01-31"',
      "status: past",
      "visibility: public",
      "listed: true",
      ...extra,
      "---",
      "",
      "Body.",
      "",
    ].join("\n"),
  );
  for (const entry of entries) {
    fs.writeFileSync(
      path.join(tripPath, "entries", `2026-01-05-${entry.slug}.md`),
      [
        "---",
        `title: "${entry.slug}"`,
        'date: "2026-01-05"',
        'location: "Somewhere"',
        'country: "Nowhere"',
        ...(entry.extra ?? []),
        "---",
        "",
        `MARKER-${entry.slug.toUpperCase()}`,
        "",
      ].join("\n"),
    );
  }
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-testflag-"));
  process.env.CONTENT_DIR = dir;
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "T", url: "https://t.test" }, features: {} }),
  );
  fs.mkdirSync(path.join(dir, "alex", "trips"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({ title: "Alex", tagline: "t", owner: { name: "A B", nickname: "A" } }),
  );
  clearConfigCache();
  clearUserCache();

  writeTrip("real-2026", [], [{ slug: "realday" }, { slug: "fakeday", extra: ["test: true"] }]);
  writeTrip("proving-2026", ["test: true"], [{ slug: "provingday" }]);
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("a whole trip marked test", () => {
  test("reads its flag back", () => {
    expect(getTrip("alex/proving-2026")?.test).toBe(true);
    expect(getTrip("alex/real-2026")?.test).toBeUndefined();
  });

  test("is never indexable, however public it says it is", () => {
    // Both trips are `visibility: public, listed: true`. Only one is offered.
    expect(isIndexable(getTrip("alex/real-2026")!)).toBe(true);
    expect(isIndexable(getTrip("alex/proving-2026")!)).toBe(false);
  });

  test("is still readable at its own URL", () => {
    // Not hidden — the point is a banner on a page somebody deliberately
    // opened, not a second draft mechanism.
    expect(getAllEntries("alex/proving-2026")).toHaveLength(1);
  });

  test("covers its days without each of them saying so", () => {
    const day = getAllEntries("alex/proving-2026")[0];
    expect(day.test).toBeUndefined();
    expect(isTestContent(getTrip("alex/proving-2026"), day)).toBe(true);
  });
});

describe("a single test day inside a real trip", () => {
  test("does not reach the feed, while its neighbours do", () => {
    const xml = buildFeedXml("alex")!;
    expect(xml).toContain("MARKER-REALDAY");
    expect(xml).not.toContain("MARKER-FAKEDAY");
    expect(xml).not.toContain("MARKER-PROVINGDAY");
  });

  test("does not reach the search index", () => {
    const json = buildSearchIndexJson("alex")!;
    expect(json).toContain("realday");
    expect(json).not.toContain("fakeday");
    expect(json).not.toContain("provingday");
  });

  test("is still on the site for anyone with the link", () => {
    const slugs = getAllEntries("alex/real-2026").map((e) => e.slug);
    expect(slugs).toContain("fakeday");
  });

  test("and is flagged, so the page can put a banner on it", () => {
    const day = getAllEntries("alex/real-2026").find((e) => e.slug === "fakeday");
    expect(day?.test).toBe(true);
    expect(isTestContent(getTrip("alex/real-2026"), day)).toBe(true);
  });

  test("a real day beside it is not flagged", () => {
    const day = getAllEntries("alex/real-2026").find((e) => e.slug === "realday");
    expect(isTestContent(getTrip("alex/real-2026"), day)).toBe(false);
  });
});

/**
 * B47 — the flag has to survive being read back.
 *
 * It could be written and never seen: `tripSummary` omitted it, so an agent
 * that set it was never told it was accepted; the day read reported only the
 * entry's own, so a day inheriting it from its trip looked ordinary; and worst,
 * the markdown twin — public, unauthenticated, and the surface built so that
 * agents read it *instead of* the page with the banner on it — said nothing at
 * all. That handed invented content, unlabelled, to the one audience with no
 * other way of telling.
 */
describe("reading the flag back", () => {
  test("the trip summary says so, and only when it is true", () => {
    expect(tripSummary("alex", "proving-2026")).toMatchObject({ test: true });
    expect(tripSummary("alex", "real-2026")).not.toHaveProperty("test");
  });

  test("the markdown twin carries it in the frontmatter", async () => {
    const body = await (await markdownTwin("alex", "proving-2026", "provingday")).text();
    expect(body).toMatch(/^test: true$/m);
  });

  test("and says so in words, above the prose", async () => {
    // Frontmatter is for parsers. Anything reading only the text still has to
    // meet the warning, and has to meet it before the content.
    const body = await (await markdownTwin("alex", "proving-2026", "provingday")).text();
    const warning = body.indexOf("did not happen");
    const prose = body.indexOf("MARKER-PROVINGDAY");
    expect(warning).toBeGreaterThan(-1);
    expect(warning).toBeLessThan(prose);
  });

  test("a day that inherits it from its trip is flagged too", async () => {
    // The day carries no flag of its own — this is the case an operator
    // marking a whole test trip actually produces.
    const day = getAllEntries("alex/proving-2026")[0];
    expect(day.test).toBeUndefined();

    const body = await (await markdownTwin("alex", "proving-2026", "provingday")).text();
    expect(body).toMatch(/^test: true$/m);
  });

  test("an ordinary day's twin says none of it", async () => {
    const body = await (await markdownTwin("alex", "real-2026", "realday")).text();
    expect(body).not.toMatch(/^test: true$/m);
    expect(body).not.toContain("did not happen");
  });

  test("a test day inside an otherwise real trip is still flagged", async () => {
    const body = await (await markdownTwin("alex", "real-2026", "fakeday")).text();
    expect(body).toMatch(/^test: true$/m);
    expect(body).toContain("did not happen");
  });
});

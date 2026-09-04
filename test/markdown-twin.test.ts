import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import matter from "gray-matter";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";

// `mayReadTrip` reads the guest cookie through `next/headers`, which throws
// outside a real request scope. An empty jar is the case that matters here:
// a stranger with the URL and no session, which is who the gate is for.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));
import { markdownTwin } from "@/lib/api/markdownTwin";

/**
 * `.md` on the end of a day page's URL gives you its source.
 *
 * The documentation has promised that since the first agent guide, and it was
 * only true for the current trip: the twin resolved the slug against
 * `currentTripRef()` alone, so every day of every other trip answered 404 —
 * including the one worked example anybody would try, because the demo
 * journal's search index identifies entries as `parks-2025/zion-narrows` and
 * `parks-2025` is not the current trip.
 *
 * Two things are tested here and both are about not handing an agent the wrong
 * thing: that the URL works, and that a miss is 404 plain text rather than
 * forty kilobytes of HTML error page.
 */

let dir: string;

function writeTrip(id: string, status: string, visibility: string, slugs: string[]) {
  const tripPath = path.join(dir, "alex", "trips", id);
  fs.mkdirSync(path.join(tripPath, "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(tripPath, "trip.md"),
    [
      "---",
      `id: ${id}`,
      `title: "${id}"`,
      'start: "2026-01-01"',
      'end: "2026-01-05"',
      `status: ${status}`,
      `visibility: ${visibility}`,
      "---",
      "",
      "Body.",
      "",
    ].join("\n"),
  );
  for (const slug of slugs) {
    fs.writeFileSync(
      path.join(tripPath, "entries", `2026-01-02-${slug}.md`),
      [
        "---",
        `title: "${slug}"`,
        'date: "2026-01-02"',
        'location: "Somewhere"',
        'country: "Nowhere"',
        "---",
        "",
        `The prose of ${id}/${slug}.`,
        "",
      ].join("\n"),
    );
  }
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-twin-"));
  process.env.CONTENT_DIR = dir;
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "T", url: "https://t.test" }, features: {} }),
  );
  fs.mkdirSync(path.join(dir, "alex", "trips"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({ title: "Alex", owner: { name: "A B", nickname: "A" } }),
  );
  clearConfigCache();
  clearUserCache();

  writeTrip("now-2026", "current", "public", ["today"]);
  writeTrip("parks-2025", "past", "public", ["zion-narrows", "today"]);
  writeTrip("secret-2024", "past", "private", ["hidden-day"]);

  // B371 — a day written in German with an English translation, in the same
  // block-scalar shape lib/api/entries.ts's translationLines writes to disk.
  const tripPath = path.join(dir, "alex", "trips", "now-2026");
  fs.writeFileSync(
    path.join(tripPath, "entries", "2026-01-03-zwei-sprachen.md"),
    [
      "---",
      'title: "Ankunft"',
      'date: "2026-01-03"',
      'location: "Somewhere"',
      'country: "Nowhere"',
      "translations:",
      "  en:",
      '    title: "Arrival"',
      "    content: |-",
      "      In English, over two",
      "",
      "      paragraphs.",
      "---",
      "",
      "Auf Deutsch.",
      "",
    ].join("\n"),
  );
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the trip-scoped twin", () => {
  test("serves the source of a day in any trip, which is the URL the page has", async () => {
    const response = await markdownTwin("alex", "parks-2025", "zion-narrows");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/markdown");
    expect(await response.text()).toContain("The prose of parks-2025/zion-narrows.");
  });

  test("refuses a private trip exactly as the page does", async () => {
    const response = await markdownTwin("alex", "secret-2024", "hidden-day");
    expect(response.status).toBe(404);
  });
});

describe("the bare twin", () => {
  test("still answers for the current trip", async () => {
    const response = await markdownTwin("alex", null, "today");
    expect(await response.text()).toContain("The prose of now-2026/today.");
  });

  test("finds a day in another trip rather than giving up — the bug", async () => {
    const response = await markdownTwin("alex", null, "zion-narrows");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("The prose of parks-2025/zion-narrows.");
  });

  test("prefers the current trip when two trips share a slug", async () => {
    // The bare URL belongs to the current trip's page, so it must return that
    // trip's day and not whichever the search happened to reach first.
    expect(await (await markdownTwin("alex", null, "today")).text()).toContain("now-2026/today");
  });

  test("does not walk into a private trip on the way past", async () => {
    const response = await markdownTwin("alex", null, "hidden-day");
    expect(response.status).toBe(404);
  });
});

describe("B371: a translated day", () => {
  test("carries every translation, and still parses as frontmatter plus body", async () => {
    const response = await markdownTwin("alex", "now-2026", "zwei-sprachen");
    const body = await response.text();

    const { data, content } = matter(body);
    expect(data.translations.en.title).toBe("Arrival");
    expect(data.translations.en.content).toContain("In English, over two");
    expect(data.translations.en.content).toContain("paragraphs.");
    expect(content.trim()).toBe("Auf Deutsch.");
  });
});

/**
 * B61 — deleted is not missing.
 *
 * Every other surface of a removed journal answers 410. The twins answered
 * 404, which is a different instruction: 404 says "fix the slug and retry",
 * 410 says "this was here and is not coming back". The twin is the route built
 * so that agents read it instead of the page, so it is where the wrong answer
 * costs most — an agent retries, or tells somebody their day never existed.
 */
describe("a journal that was deleted", () => {
  /** Written straight to disk: what `lib/tombstones.ts` leaves behind. */
  function entomb(username: string, over: Record<string, unknown> = {}) {
    // Where lib/tombstones.ts actually writes them: content/.deleted/<user>.json
    const file = path.join(dir, ".deleted", `${username}.json`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({
        kind: "journal",
        username,
        title: "Alex",
        deletedAt: "2026-08-30T10:00:00.000Z",
        requestedBy: "owner@example.test",
        held: { trips: 1, days: 1, files: 3, bytes: 1024 },
        ...over,
      }),
    );
  }

  test("answers 410, not 404", async () => {
    entomb("alex");
    const response = await markdownTwin("alex", "parks-2025", "zion-narrows");
    expect(response.status).toBe(410);
  });

  test("in plain text, because that is what this route is for", async () => {
    entomb("alex");
    const response = await markdownTwin("alex", "parks-2025", "zion-narrows");
    expect(response.headers.get("content-type")).toContain("text/plain");
    const body = await response.text();
    expect(body.toLowerCase()).not.toContain("<html");
    expect(body).toContain("deleted on 2026-08-30");
  });

  test("the short form too", async () => {
    entomb("alex");
    expect((await markdownTwin("alex", null, "today")).status).toBe(410);
  });

  test("and does not send anybody to a URL that is also gone", async () => {
    // The 404 points at /<user>/documentation.txt, which is right for a live
    // journal and a dead end for this one.
    entomb("alex");
    const body = await (await markdownTwin("alex", "parks-2025", "zion-narrows")).text();
    expect(body).not.toContain("documentation.txt");
  });

  test("a deleted trip in a living journal says so as well", async () => {
    fs.mkdirSync(path.join(dir, ".deleted", "alex"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, ".deleted", "alex", "gone-2025.json"),
      JSON.stringify({
        kind: "trip",
        username: "alex",
        tripId: "gone-2025",
        title: "The one that went",
        deletedAt: "2026-08-31T10:00:00.000Z",
        requestedBy: "owner@example.test",
        held: { days: 2, files: 4, bytes: 2048 },
      }),
    );

    const response = await markdownTwin("alex", "gone-2025", "any-day");
    expect(response.status).toBe(410);
    expect(await response.text()).toContain("The one that went");
    // And the rest of the journal is unaffected.
    expect((await markdownTwin("alex", "parks-2025", "zion-narrows")).status).toBe(200);
  });
});

describe("a miss", () => {
  test("is plain text, not an HTML error page", async () => {
    const response = await markdownTwin("alex", null, "no-such-day");
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("text/plain");
    const body = await response.text();
    expect(body.toLowerCase()).not.toContain("<html");
    expect(body).not.toContain("<!DOCTYPE");
    expect(body.length).toBeLessThan(500);
    // And it says where to look, since the slug alone is not the identity.
    expect(body).toContain("/alex/documentation.txt");
  });

  test("names no trip it was not asked about", async () => {
    // A miss must not become a way to ask which trips exist.
    const body = await (await markdownTwin("alex", null, "no-such-day")).text();
    expect(body).not.toContain("secret-2024");
    expect(body).not.toContain("parks-2025");
  });
});

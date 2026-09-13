import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { getAllEntries, getDays } from "@/lib/entries";
import { isPublished, listDrafts } from "@/lib/api/entries";

/**
 * A trip's `entries/` may hold a file `matter()` cannot parse — an agent's
 * write failed halfway, or somebody hand-edited a day and left a quote
 * unterminated. Before B236 that one file threw out of `readAllEntries`, so
 * `getAllEntries`, `getDays` and everything built on them raised instead of
 * returning what they could — the whole trip disappeared behind one bad day.
 * These pin the fix: the bad file is skipped and logged, the rest of the trip
 * still reads. Same shape as `test/malformed-trips.test.ts` for `trip.md`.
 */

const SERVER_CFG =
  '{"site":{"name":"F","url":"https://example.test","defaultUser":"u"},"users":{"reserved":[]},"features":{}}';
const USER_CFG =
  '{"title":"F","tagline":"t","owner":{"name":"A B","nickname":"A"},"startLocation":"X","defaultLocale":"en","locales":["en"],"baseCurrency":"CHF","displayCurrencies":["CHF"],"units":"metric","features":{}}';

const GOOD_TRIP = JSON.stringify({
  id: "asia-2023",
  title: "A Trip",
  dates: { from: "2024-01-01", to: "2024-01-09" },
});

function journal(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "malformed-entries-"));
  fs.writeFileSync(path.join(dir, "config.json"), SERVER_CFG);
  fs.mkdirSync(path.join(dir, "u"), { recursive: true });
  fs.writeFileSync(path.join(dir, "u", "config.json"), USER_CFG);
  process.env.CONTENT_DIR = dir;
  return dir;
}

// NOT repointed at writeTripFixture: the username here is "u" — one
// character — which fails `isValidUsername`'s two-character minimum
// (`lib/users.ts`). `createTrip` (what writeTripFixture calls) refuses with
// `no_such_journal` for a user `getUsernames()` will not list, even though
// the folder and its config.json are right there. The hand-written trip.json
// never asked `getUser` anything, so it never noticed. A finding for B1630's
// report, not something the fixture should route around.
function writeTrip(dir: string): void {
  fs.mkdirSync(path.join(dir, "u", "trips", "asia-2023"), { recursive: true });
  fs.writeFileSync(path.join(dir, "u", "trips", "asia-2023", "trip.json"), GOOD_TRIP);
}

function writeEntry(dir: string, file: string, body: string): void {
  const entriesDir = path.join(dir, "u", "trips", "asia-2023", "entries");
  fs.mkdirSync(entriesDir, { recursive: true });
  fs.writeFileSync(path.join(entriesDir, file), body);
}

// Entries are v2 JSON now (B1630) — "malformed" means malformed JSON rather
// than malformed frontmatter.
const GOOD_ENTRY = (slug: string, title: string) =>
  JSON.stringify({ title, date: "2024-01-02", location: "Somewhere", content: "It happened.", status: "published" });

const BROKEN_ENTRY = `{"title": [unterminated`;

const DRAFT_ENTRY = JSON.stringify({
  status: "draft",
  title: "A Draft",
  date: "2024-01-04",
  content: "Still working on it.",
});

/** Silences the `[entries]` warnings these fixtures deliberately provoke. */
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  warn.mockRestore();
});

describe("readAllEntries", () => {
  test("a good entry is still read beside one that will not parse", () => {
    const dir = journal();
    writeTrip(dir);
    writeEntry(dir, "2024-01-02-faro.json", GOOD_ENTRY("faro", "Faro"));
    writeEntry(dir, "2024-01-03-broken.json", BROKEN_ENTRY);

    const entries = getAllEntries("u/asia-2023");
    expect(entries.map((e) => e.slug)).toEqual(["faro"]);
    expect(getDays("u/asia-2023")).toHaveLength(1);
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0][0])).toContain("2024-01-03-broken.json");
  });

  test("a trip with only a broken entry reads as empty, not thrown", () => {
    const dir = journal();
    writeTrip(dir);
    writeEntry(dir, "2024-01-03-broken.json", BROKEN_ENTRY);

    expect(() => getAllEntries("u/asia-2023")).not.toThrow();
    expect(getAllEntries("u/asia-2023")).toEqual([]);
  });
});

describe("listDrafts", () => {
  test("a broken entry does not blank out the review queue", () => {
    const dir = journal();
    writeTrip(dir);
    writeEntry(dir, "2024-01-03-broken.json", BROKEN_ENTRY);
    writeEntry(dir, "2024-01-04-draft.json", DRAFT_ENTRY);

    const drafts = listDrafts("u/asia-2023");
    expect(drafts.map((d) => d.slug)).toEqual(["draft"]);
  });
});

describe("isPublished", () => {
  test("a file that will not parse reads as published rather than throwing", () => {
    const dir = journal();
    writeTrip(dir);
    writeEntry(dir, "2024-01-03-broken.json", BROKEN_ENTRY);

    expect(() => isPublished("u/asia-2023", "broken")).not.toThrow();
    expect(isPublished("u/asia-2023", "broken")).toBe(true);
  });
});

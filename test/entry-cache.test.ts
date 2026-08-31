import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { createDraft, deleteEntry } from "@/lib/api/entries";
import { getAllEntries, getEntryBySlug } from "@/lib/entries";

/**
 * What the site serves after the application writes a file.
 *
 * Entries are cached per directory for the life of the process, which is right
 * for content that only changes when somebody edits a file by hand — and wrong
 * the moment the application writes one itself. It did, and nothing cleared
 * the cache: a day deleted through the API left the disk but went on being
 * served, its permalink answering 200 and MCP returning its full text, until
 * the server restarted.
 *
 * That is the confirmation gate failing at the last step. An owner deleting
 * something *because it should not be public* was told it was gone while it
 * was still up. Found by a tester with no access to any of this.
 */

let dir: string;
const REF = "alex/asia-2026";

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-cache-"));
  process.env.CONTENT_DIR = dir;
  fs.mkdirSync(path.join(dir, "alex", "trips", "asia-2026", "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "F", url: "https://e.test", defaultUser: "alex" }, users: {}, features: {} }),
  );
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "Alex", tagline: "t", travellers: [{ name: "A B", nickname: "A" }],
      startLocation: "X", defaultLocale: "en", locales: ["en"], baseCurrency: "CHF",
      displayCurrencies: ["CHF"], units: "metric", features: {},
    }),
  );
  fs.writeFileSync(
    path.join(dir, "alex", "trips", "asia-2026", "trip.md"),
    ["---", "id: asia-2026", 'title: "Asia"', 'start: "2026-01-01"', 'end: "2026-01-09"',
     "status: past", "visibility: public", "---", "", "Body.", ""].join("\n"),
  );
  clearConfigCache();
  clearUserCache();
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Publishes a day the way a person does: write it, then remove the marker. */
function publish(slug: string) {
  const dirPath = path.join(dir, "alex", "trips", "asia-2026", "entries");
  const file = fs.readdirSync(dirPath).find((f) => f.includes(slug))!;
  const full = path.join(dirPath, file);
  fs.writeFileSync(full, fs.readFileSync(full, "utf8").replace(/^status: draft\n/m, ""));
}

describe("after the application writes an entry", () => {
  test("a new draft is visible to a reader who asked for drafts", () => {
    // Warm the cache first — that is the state the bug needed.
    expect(getAllEntries(REF, { includeDrafts: true })).toEqual([]);
    createDraft(REF, { title: "New day", date: "2026-01-02", content: "Words." });
    expect(getAllEntries(REF, { includeDrafts: true }).map((e) => e.slug)).toEqual(["new-day"]);
  });

  test("a deleted draft stops being served", () => {
    createDraft(REF, { title: "Doomed", date: "2026-01-03", content: "Words." });
    expect(getEntryBySlug(REF, "doomed", { includeDrafts: true })).toBeDefined();

    expect(deleteEntry(REF, "doomed").ok).toBe(true);
    expect(getEntryBySlug(REF, "doomed", { includeDrafts: true })).toBeUndefined();
    expect(getAllEntries(REF, { includeDrafts: true })).toEqual([]);
  });

  /**
   * The case that made this urgent: something already on the site, taken down
   * on purpose. If the cache survives, the day the owner just removed is still
   * being served to everybody.
   */
  test("a deleted PUBLISHED day stops being served immediately", () => {
    createDraft(REF, { title: "Regrettable", date: "2026-01-04", content: "Words." });
    publish("regrettable");
    // Read it as the public would, warming the cache with the published copy.
    expect(getAllEntries(REF).map((e) => e.slug)).toEqual(["regrettable"]);

    const result = deleteEntry(REF, "regrettable", { allowPublished: true });
    expect(result.ok && result.published).toBe(true);
    expect(getAllEntries(REF)).toEqual([]);
    expect(getEntryBySlug(REF, "regrettable")).toBeUndefined();
  });
});

/**
 * Edits made by hand, not through the API.
 *
 * Publishing is a person deleting one line from one file — the whole
 * publishing model. The caches outlived that edit, so the day somebody had
 * just published did not reach the feed, the sitemap or the search index until
 * the server was restarted; and, in the direction that actually hurts, a trip
 * somebody had just made **private** went on being published in full.
 *
 * Both caches now carry a fingerprint of the files they were built from.
 */
describe("content edited on disk", () => {
  test("publishing a day by hand is picked up without a restart", () => {
    createDraft(REF, { title: "By hand", date: "2026-01-06", content: "Words." });
    expect(getAllEntries(REF)).toEqual([]); // still a draft, and cached as such

    publish("by-hand");
    expect(getAllEntries(REF).map((e) => e.slug)).toEqual(["by-hand"]);
  });

  test("un-publishing it again is picked up too", () => {
    createDraft(REF, { title: "Second thoughts", date: "2026-01-07", content: "Words." });
    publish("second-thoughts");
    expect(getAllEntries(REF)).toHaveLength(1);

    const dirPath = path.join(dir, "alex", "trips", "asia-2026", "entries");
    const file = path.join(dirPath, fs.readdirSync(dirPath)[0]);
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/^---\n/, "---\nstatus: draft\n"));
    expect(getAllEntries(REF)).toEqual([]);
  });

  /** A trip's visibility is the one that matters most. */
  test("a trip switched to private stops being readable, without a restart", async () => {
    const { getTrip } = await import("@/lib/trips");
    const file = path.join(dir, "alex", "trips", "asia-2026", "trip.md");
    expect(getTrip(REF)?.visibility).toBe("public");

    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("visibility: public", "visibility: private"));
    expect(getTrip(REF)?.visibility).toBe("private");
    expect(getTrip(REF)?.listed).toBe(false);
  });
});

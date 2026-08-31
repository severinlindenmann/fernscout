import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { getAllEntries, getAllMedia, getDays, getEntryBySlug, getTripStats } from "@/lib/entries";

/**
 * Drafts, and who they are for.
 *
 * The rule has not changed: an agent writes a draft and a person publishes it.
 * What changed is that the person can now *read* it on their own site before
 * deciding — so `includeDrafts` exists, and the thing worth testing is that it
 * is off unless somebody asks, on every reader.
 */

let dir: string;
const REF = "alex/asia-2023";

function entry(name: string, body: string, draft: boolean) {
  fs.writeFileSync(
    path.join(dir, "alex", "trips", "asia-2023", "entries", name),
    [
      "---",
      `title: "${body}"`,
      `date: "2026-01-0${name[9]}"`,
      'location: "Bangkok"',
      'country: "Thailand"',
      "lat: 13.7",
      "lng: 100.5",
      "gallery:",
      '  - src: "/media/asia-2023/x/01.jpg"',
      "    type: image",
      ...(draft ? ["status: draft"] : []),
      "---",
      "",
      body,
      "",
    ].join("\n"),
  );
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-drafts-"));
  process.env.CONTENT_DIR = dir;
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "F", url: "https://example.test", defaultUser: "alex" },
      users: { reserved: [] },
      features: {},
    }),
  );
  fs.mkdirSync(path.join(dir, "alex", "trips", "asia-2023", "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "Alex", tagline: "t", travellers: [{ name: "A B", nickname: "A" }],
      startLocation: "X", defaultLocale: "en", locales: ["en"],
      baseCurrency: "CHF", displayCurrencies: ["CHF"], units: "metric", features: {},
    }),
  );
  fs.writeFileSync(
    path.join(dir, "alex", "trips", "asia-2023", "trip.md"),
    ["---", "id: asia-2023", 'title: "Asia"', 'start: "2026-01-01"', 'end: "2026-01-09"',
     "status: past", "visibility: public", "---", "", "Body.", ""].join("\n"),
  );
  entry("2026-01-01-published.md", "Published", false);
  entry("2026-01-02-unpublished.md", "Unpublished", true);
  clearConfigCache();
  clearUserCache();
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("by default — every public reading path", () => {
  test("getAllEntries hides the draft", () => {
    expect(getAllEntries(REF).map((e) => e.title)).toEqual(["Published"]);
  });

  test("so do days, stats, media and slug lookup", () => {
    expect(getDays(REF)).toHaveLength(1);
    expect(getTripStats(REF).dayCount).toBe(1);
    expect(getAllMedia(REF)).toHaveLength(1);
    expect(getEntryBySlug(REF, "unpublished")).toBeUndefined();
  });
});

describe("with includeDrafts — the owner, on their own journal", () => {
  test("the draft is there, and flagged as one", () => {
    const entries = getAllEntries(REF, { includeDrafts: true });
    expect(entries.map((e) => e.title)).toEqual(["Published", "Unpublished"]);
    expect(entries.find((e) => e.title === "Unpublished")?.draft).toBe(true);
    // The published one must not be flagged, or the banner shows on everything.
    expect(entries.find((e) => e.title === "Published")?.draft).toBeUndefined();
  });

  test("days, stats, media and slug lookup follow", () => {
    const on = { includeDrafts: true };
    expect(getDays(REF, on)).toHaveLength(2);
    expect(getTripStats(REF, on).dayCount).toBe(2);
    expect(getAllMedia(REF, on)).toHaveLength(2);
    expect(getEntryBySlug(REF, "unpublished", on)?.draft).toBe(true);
  });

  /** One cache serves both views; asking for one must not poison the other. */
  test("asking for drafts does not leak them into the next public read", () => {
    expect(getAllEntries(REF, { includeDrafts: true })).toHaveLength(2);
    expect(getAllEntries(REF)).toHaveLength(1);
    expect(getAllEntries(REF, { includeDrafts: false })).toHaveLength(1);
  });
});

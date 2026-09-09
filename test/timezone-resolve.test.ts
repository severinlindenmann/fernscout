import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { clearMatterCache, forgetEntries, getEntryBySlug } from "@/lib/entries";
import { createDraft, editEntry } from "@/lib/api/entries";
import { fillDayTimezone } from "@/lib/api/timezoneBackfill";
import { timezoneForCoordinates } from "@/lib/timezone";

/**
 * B1090 — a day's zone worked out from where it happened, not left inert.
 *
 * Same fixture shape as test/weather.test.ts: a throwaway CONTENT_DIR with
 * one journal and one trip, so `createDraft`/`editEntry` write real files and
 * the read side (`getEntryBySlug`) is what the test checks against — the same
 * path a documented `GET` uses.
 */

let dir: string;
const ref = "ana/alps";

function writeInstance() {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "Fernscout", url: "https://example.test", defaultUser: "ana" },
      users: { reserved: [] },
      features: {},
    }),
  );
}

function writeJournal() {
  fs.mkdirSync(path.join(dir, "ana", "trips", "alps", "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "ana", "config.json"),
    JSON.stringify({
      title: "Ana's journal",
      tagline: "t",
      owner: { name: "A B", nickname: "A" },
      startLocation: "X",
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features: {},
    }),
  );
  fs.writeFileSync(
    path.join(dir, "ana", "trips", "alps", "trip.md"),
    [
      "---",
      'id: "alps"',
      'title: "Alps"',
      'start: "2026-08-20"',
      'end: "2026-09-10"',
      'status: "current"',
      'visibility: "public"',
      "---",
      "",
      "Intro.",
      "",
    ].join("\n"),
  );
  clearConfigCache();
  clearUserCache();
  clearMatterCache();
  forgetEntries(ref);
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-timezone-"));
  process.env.CONTENT_DIR = dir;
  writeInstance();
  writeJournal();
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("tz-lookup places Bangkok's coordinates in Asia/Bangkok", () => {
  expect(timezoneForCoordinates(13.7563, 100.5018)).toBe("Asia/Bangkok");
});

describe("write time — createDraft", () => {
  test("lat/lng with no timezone comes back carrying a resolved one", () => {
    const result = createDraft(ref, {
      title: "Bangkok Morning",
      date: "2026-08-26",
      content: "The prose.",
      lat: 13.7563,
      lng: 100.5018,
    } as never);
    expect(result.ok).toBe(true);

    const entry = getEntryBySlug(ref, "bangkok-morning", { includeDrafts: true });
    expect(entry?.timezone).toBe("Asia/Bangkok");
  });

  test("an explicit timezone is never overwritten by the resolver", () => {
    const result = createDraft(ref, {
      title: "Bangkok Morning",
      date: "2026-08-26",
      content: "The prose.",
      lat: 13.7563,
      lng: 100.5018,
      timezone: "Europe/Zurich",
    } as never);
    expect(result.ok).toBe(true);

    const entry = getEntryBySlug(ref, "bangkok-morning", { includeDrafts: true });
    expect(entry?.timezone).toBe("Europe/Zurich");
  });

  test("a day with no coordinates gets no zone, exactly as before", () => {
    const result = createDraft(ref, {
      title: "Somewhere Unplaced",
      date: "2026-08-26",
      content: "The prose.",
    } as never);
    expect(result.ok).toBe(true);

    const entry = getEntryBySlug(ref, "somewhere-unplaced", { includeDrafts: true });
    expect(entry?.timezone).toBeUndefined();
  });
});

describe("write time — editEntry", () => {
  function writeBareDay() {
    const file = path.join(dir, "ana", "trips", "alps", "entries", "2026-08-26-hoi-an.md");
    fs.writeFileSync(
      file,
      ["---", 'title: "Hoi An"', 'date: "2026-08-26"', "status: draft", "---", "", "The prose.", ""].join(
        "\n",
      ),
    );
    clearMatterCache();
    forgetEntries(ref);
  }

  test("an edit that supplies coordinates and no zone gets one resolved", () => {
    writeBareDay();
    const result = editEntry(ref, "hoi-an", { lat: 13.7563, lng: 100.5018 } as never);
    expect(result.ok).toBe(true);

    const entry = getEntryBySlug(ref, "hoi-an", { includeDrafts: true });
    expect(entry?.timezone).toBe("Asia/Bangkok");
  });

  test("an edit never overwrites a zone the day already carries", () => {
    writeBareDay();
    editEntry(ref, "hoi-an", { lat: 13.7563, lng: 100.5018 } as never);
    // Second edit moves the coordinates far away but names no timezone —
    // the zone recorded on the first edit must survive untouched.
    const result = editEntry(ref, "hoi-an", { lat: 47.3769, lng: 8.5417 } as never);
    expect(result.ok).toBe(true);

    const entry = getEntryBySlug(ref, "hoi-an", { includeDrafts: true });
    expect(entry?.timezone).toBe("Asia/Bangkok");
  });
});

describe("the backfill sweep", () => {
  function writeDay(frontmatter: string[], slug = "hoi-an") {
    const file = path.join(dir, "ana", "trips", "alps", "entries", `2026-08-26-${slug}.md`);
    fs.writeFileSync(file, ["---", ...frontmatter, "---", "", "The prose.", ""].join("\n"));
    clearMatterCache();
    forgetEntries(ref);
    return file;
  }

  test("fills a day with coordinates and no zone", () => {
    writeDay(['title: "Hoi An"', 'date: "2026-08-26"', "lat: 13.7563", "lng: 100.5018", "status: draft"]);
    expect(fillDayTimezone(ref, "hoi-an")).toBe("filled");
    expect(getEntryBySlug(ref, "hoi-an", { includeDrafts: true })?.timezone).toBe("Asia/Bangkok");
  });

  test("never overwrites a day that already names a zone", () => {
    writeDay([
      'title: "Hoi An"',
      'date: "2026-08-26"',
      "lat: 13.7563",
      "lng: 100.5018",
      'timezone: "Europe/Zurich"',
      "status: draft",
    ]);
    expect(fillDayTimezone(ref, "hoi-an")).toBe("already_recorded");
    expect(getEntryBySlug(ref, "hoi-an", { includeDrafts: true })?.timezone).toBe("Europe/Zurich");
  });

  test("leaves a day with no coordinates alone", () => {
    writeDay(['title: "Hoi An"', 'date: "2026-08-26"', "status: draft"]);
    expect(fillDayTimezone(ref, "hoi-an")).toBe("no_coordinates");
    expect(getEntryBySlug(ref, "hoi-an", { includeDrafts: true })?.timezone).toBeUndefined();
  });

  test("running the sweep twice changes nothing the second time", () => {
    const file = writeDay([
      'title: "Hoi An"',
      'date: "2026-08-26"',
      "lat: 13.7563",
      "lng: 100.5018",
      "status: draft",
    ]);
    expect(fillDayTimezone(ref, "hoi-an")).toBe("filled");
    const after = fs.readFileSync(file, "utf8");
    expect(fillDayTimezone(ref, "hoi-an")).toBe("already_recorded");
    expect(fs.readFileSync(file, "utf8")).toBe(after);
  });
});

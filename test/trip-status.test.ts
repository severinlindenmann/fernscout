import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { createDraft, publishDraft } from "@/lib/api/entries";
import { buildFeedXml } from "@/lib/feed";
import { buildSearchIndex } from "@/lib/search";
import { getAllEntries } from "@/lib/entries";
import { getCurrentTrip, getTrip, tripRef } from "@/lib/trips";
import { createTrip } from "@/lib/tripWrite";
import { buildStoryProps, showsCountdown } from "@/lib/tripView";

/**
 * B72 — a trip whose dates have passed, and the days published into it.
 *
 * Found live: an agent created a trip through the write API for 24–26 August,
 * wrote three days into it and published all three. Read on 1 September, the
 * trip's own page said "no days yet — this journey is still ahead", and the
 * days were in neither the feed nor the search index. Every day was correct,
 * on disk and at its own URL. One frontmatter word was hiding all of them.
 *
 * The word is `status`, and it was declared and never checked. These tests are
 * the reconstruction of that incident, twice over: once with the status the
 * API's own default wrote, and once with `status: upcoming` hand-written into
 * a trip.md, which is what the file the agent produced actually looked like.
 */

const DAY = {
  title: "Erster Tag",
  date: "2026-08-24",
  location: "Bellinzona",
  country: "Switzerland",
  content: "Ankunft am Morgen, GALLIVANTMARKER on the platform.",
};

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-trip-status-"));
  process.env.CONTENT_DIR = dir;
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "T", url: "https://t.test", defaultUser: "alex" }, features: {} }),
  );
  fs.mkdirSync(path.join(dir, "alex"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "Alex",
      tagline: "t",
      owner: { name: "A B", nickname: "A" },
      defaultLocale: "en",
      locales: ["en"],
    }),
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

/** A trip.md written by hand, the way the one in the incident read. */
function writeTripFile(id: string, front: string[]): string {
  const tripDir = path.join(dir, "alex", "trips", id);
  fs.mkdirSync(path.join(tripDir, "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(tripDir, "trip.md"),
    ["---", `id: ${id}`, ...front, "---", "", "Body.", ""].join("\n"),
  );
  return tripRef("alex", id);
}

/** One published day, exactly as an agent writes and a person publishes it. */
function publishOneDay(ref: string): void {
  const made = createDraft(ref, DAY);
  if (!made.ok) throw new Error(`could not write the draft: ${made.error}`);
  const published = publishDraft(ref, "erster-tag");
  if (!published.ok) throw new Error(`could not publish: ${published.error}`);
}

describe("a trip whose dates have passed", () => {
  const ref = "alex/testreise";

  beforeEach(() => {
    // The incident's own file: dates in the past, `status: upcoming`.
    writeTripFile("testreise", [
      'title: "Testreise"',
      'start: "2026-08-24"',
      'end: "2026-08-26"',
      "status: upcoming",
      "visibility: public",
      "listed: true",
    ]);
    publishOneDay(ref);
  });

  test("does not read as upcoming, whatever its frontmatter says", () => {
    expect(getTrip(ref)?.status).toBe("past");
  });

  test("does not draw a countdown over its published day", () => {
    expect(showsCountdown(getTrip(ref)!)).toBe(false);
  });

  test("has its day in the trip page's props", () => {
    const { index, days } = buildStoryProps(ref);
    expect(index.map((d) => d.date)).toEqual(["2026-08-24"]);
    expect(days.map((d) => d.lead.title)).toEqual(["Erster Tag"]);
  });

  test("has its day in the feed", () => {
    const xml = buildFeedXml("alex")!;
    expect(xml).toContain("GALLIVANTMARKER");
    // At the bare URL, because this is now the journal's only readable trip
    // and `getCurrentTrip` falls back to the most recent past one. While it
    // read as upcoming it was neither current nor past, so the journal had no
    // current trip and this item did not exist at all.
    expect(xml).toContain("https://t.test/alex/day/erster-tag");
  });

  test("has its day in the search index", () => {
    const hits = buildSearchIndex("alex")!.search("GALLIVANTMARKER");
    expect(hits.map((h) => h.id)).toContain("testreise/erster-tag");
  });

  test("is what the journal serves when no trip declares itself current", () => {
    // getCurrentTrip picks `current`, else the most recent past trip. An
    // upcoming trip is neither, which left the journal with no current trip at
    // all — and that is what sent /gallery, /map and /costs to a 404 (B73).
    expect(getCurrentTrip("alex")?.id).toBe("testreise");
  });
});

describe("a trip that has genuinely not started", () => {
  const ref = "alex/japan-2099";

  beforeEach(() => {
    writeTripFile("japan-2099", [
      'title: "Japan"',
      'start: "2099-04-01"',
      'end: "2099-05-15"',
      "visibility: public",
    ]);
  });

  test("reads as upcoming even though its file declares nothing", () => {
    // The mirror-image default: `parseStatus` read a missing status as `past`,
    // so the two write and read defaults disagreed. Neither consulted a date.
    expect(getTrip(ref)?.status).toBe("upcoming");
  });

  test("still draws its countdown", () => {
    expect(showsCountdown(getTrip(ref)!)).toBe(true);
  });

  test("keeps the countdown while the owner drafts days into it", () => {
    // A future-dated draft is how a planned route is written (lib/plan.ts).
    // It must not tip the page out of the countdown that draws that route.
    const made = createDraft(ref, { ...DAY, date: "2099-04-02" });
    if (!made.ok) throw new Error("expected the draft to be written");
    expect(getAllEntries(ref)).toHaveLength(0);
    expect(showsCountdown(getTrip(ref)!)).toBe(true);
  });

  test("loses the countdown the moment a day is published into it", () => {
    // Belt and braces: the status is right here, and a published day would
    // still win. TripCountdown's closing line is a hardcoded "no days yet".
    publishOneDay(ref);
    expect(showsCountdown(getTrip(ref)!)).toBe(false);
  });
});

describe("createTrip", () => {
  test("writes the status the dates imply, not a hardcoded upcoming", () => {
    const made = createTrip("alex", {
      id: "testreise",
      title: "Testreise",
      start: "2026-08-24",
      end: "2026-08-26",
      visibility: "public",
    });
    expect(made.ok).toBe(true);
    const file = fs.readFileSync(path.join(dir, "alex", "trips", "testreise", "trip.md"), "utf8");
    // The file a person opens says the same thing the site does.
    expect(file).toContain("status: past");
    expect(getTrip("alex/testreise")?.status).toBe("past");
  });

  test("writes upcoming for a trip that has not started", () => {
    createTrip("alex", { id: "japan-2099", title: "Japan", start: "2099-04-01", end: "2099-05-15" });
    const file = fs.readFileSync(path.join(dir, "alex", "trips", "japan-2099", "trip.md"), "utf8");
    expect(file).toContain("status: upcoming");
  });

  /**
   * B346. It used to write `accent: sky` into every trip, so a colour nobody
   * had chosen was indistinguishable from one somebody had — which left the
   * trips page unable to assign distinct colours without overriding real
   * choices, and every journal's trips the same blue.
   */
  test("writes no accent for a trip nobody coloured, and keeps one that is asked for", () => {
    createTrip("alex", { id: "nocolour", title: "No colour", start: "2099-01-01", end: "2099-01-02" });
    const plain = fs.readFileSync(path.join(dir, "alex", "trips", "nocolour", "trip.md"), "utf8");
    expect(plain).not.toContain("accent:");

    createTrip("alex", {
      id: "green-one",
      title: "Green one",
      start: "2099-01-01",
      end: "2099-01-02",
      accent: "green",
    });
    const chosen = fs.readFileSync(path.join(dir, "alex", "trips", "green-one", "trip.md"), "utf8");
    expect(chosen).toContain("accent: green");
  });

  test("still honours an explicit current", () => {
    createTrip("alex", {
      id: "unterwegs",
      title: "Unterwegs",
      start: "2026-08-24",
      end: "2026-08-26",
      status: "current",
    });
    expect(getTrip("alex/unterwegs")?.status).toBe("current");
  });
});

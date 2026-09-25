import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { getPlaces } from "@/lib/entries";
import { dayToJson, tripToJson, type DayFile, type TripFile } from "@/lib/api/v2/documents";

/**
 * B309 — `Place.entries` used to be `Entry[]`, prose and every language's
 * `translations` included, for a photograph tile's day and a slideshow
 * narration nobody had opened yet. It is now `PlaceEntry[]` (lib/types.ts):
 * the fields the map's detail panel and the slideshow actually read, plus a
 * pre-extracted `headline` per locale instead of the day's raw content —
 * the same move B87 made for `MediaTile`.
 *
 * This pins the shape rather than a rendered page, the same level B87's own
 * test pinned `MediaTile` at: a marked sentence written into a day's `content`
 * (and its German translation) must not survive into what `getPlaces`
 * returns, however it later reaches the client.
 */

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-place-entry-"));
  process.env.CONTENT_DIR = dir;
  fs.mkdirSync(path.join(dir, "u"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "u", "config.json"),
    JSON.stringify({
      title: "Test journal",
      owner: { name: "Test Person", nickname: "Test" },
      defaultLocale: "en",
      locales: ["en", "de"],
      baseCurrency: "CHF",
    }),
  );
  // Not on writeTripFixture (B1630): the journal here is "u", a one-character
  // username `isValidUsername` refuses — `createTrip` (the fixture's writer)
  // fails with `no_such_journal` before it ever gets to write anything.
  const trip: TripFile = {
    id: "t",
    title: "Test trip",
    dates: { from: "2026-09-01", to: "2026-09-01" },
    visibility: "private",
    people: [],
    intro: "Intro.",
  };
  fs.mkdirSync(path.join(dir, "u", "trips", "t"), { recursive: true });
  fs.writeFileSync(path.join(dir, "u", "trips", "t", "trip.json"), tripToJson(trip));
  // Not on writeDayFixture (B1630): `translations` is a real day field
  // (lib/api/v2/documents.ts's `DayFile`), not a frontmatter detail, but the
  // shared fixture does not expose it yet. Written through the production
  // serialiser so it cannot drift from what the reader parses.
  const day: DayFile = {
    slug: "faro",
    title: "Faro",
    date: "2026-09-01",
    location: "Faro",
    country: "Portugal",
    coordinates: { lat: 37.0179, lng: -7.9308 },
    content:
      "Marker-EN said the sailor. There is a great deal more prose after this sentence that nobody browsing the gallery has asked to read.",
    status: "published",
    translations: {
      de: {
        title: "Faro (de)",
        content: "Marker-DE said the sailor. Nobody needs the rest of this prose sent twice.",
      },
    },
  };
  fs.mkdirSync(path.join(dir, "u", "trips", "t", "entries"), { recursive: true });
  fs.writeFileSync(path.join(dir, "u", "trips", "t", "entries", "2026-09-01-faro.json"), dayToJson(day));
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("getPlaces projects entries to PlaceEntry", () => {
  test("does not carry the entry's content or translations", () => {
    const [place] = getPlaces("u/t");
    const [entry] = place.entries;
    expect(entry).not.toHaveProperty("content");
    expect(entry).not.toHaveProperty("translations");
    expect(entry).not.toHaveProperty("title");
    expect(JSON.stringify(place)).not.toContain("nobody browsing the gallery has asked to read");
    expect(JSON.stringify(place)).not.toContain("Nobody needs the rest of this prose sent twice");
  });

  test("headline carries only the day's first sentence, per locale", () => {
    const [place] = getPlaces("u/t");
    const [entry] = place.entries;
    expect(entry.headline.en).toBe("Marker-EN said the sailor.");
    expect(entry.headline.de).toBe("Marker-DE said the sailor.");
  });
});

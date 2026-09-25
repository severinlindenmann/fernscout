import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { getPlaces, getTripStats } from "@/lib/entries";
import { dayToJson, tripToJson, type DayFile, type TripFile } from "@/lib/api/v2/documents";

/**
 * B381 — a day with no `lat`/`lng` at all has nothing to plot, and must not
 * become a nameless place that inflates the stop and country counts. Distinct
 * from B339 (test/entries.test.ts, "days with coordinates but no place name
 * each keep their own place"): that is a day that *has* coordinates and no
 * name; this is a day with nothing at all — no coordinates, no name, no
 * country, the day somebody spends on a train with nothing to report.
 *
 * Its own temp `CONTENT_DIR` rather than the shared `test/fixtures/content`
 * tree: that tree's trip list is asserted verbatim by test/trips.test.ts, and
 * a fourth trip there breaks an unrelated test for a reason that has nothing
 * to do with this one.
 */

let dir: string;

// B1630: username "u" is one character — `isValidUsername` refuses it, so
// `writeTripFixture` (which goes through `createTrip`) fails with
// `no_such_journal`. Writes the v2 JSON directly instead, through the same
// production serialisers (`tripToJson`/`dayToJson`) the fixture helper uses
// internally.
function writeDay(slug: string, date: string, fields: Partial<DayFile>, body: string) {
  const day: DayFile = {
    slug,
    date,
    content: body,
    status: "published",
    ...fields,
  } as DayFile;
  fs.writeFileSync(
    path.join(dir, "u", "trips", "t", "entries", `${date}-${slug}.json`),
    dayToJson(day),
  );
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-no-coords-place-"));
  process.env.CONTENT_DIR = dir;
  fs.mkdirSync(path.join(dir, "u", "trips", "t", "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "u", "config.json"),
    JSON.stringify({
      title: "Test journal",
      owner: { name: "Test Person", nickname: "Test" },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
    }),
  );
  const trip: TripFile = {
    id: "t",
    title: "Test trip",
    dates: { from: "2026-09-01", to: "2026-09-04" },
    visibility: "private",
    people: [],
  };
  fs.writeFileSync(path.join(dir, "u", "trips", "t", "trip.json"), tripToJson(trip));

  writeDay(
    "ljubljana",
    "2026-09-01",
    { title: "Ljubljana", location: "Ljubljana", country: "Slovenia", coordinates: { lat: 46.0569, lng: 14.5058 } },
    "Arrived.",
  );
  writeDay(
    "ohrid",
    "2026-09-02",
    { title: "Ohrid", location: "Ohrid", country: "North Macedonia", coordinates: { lat: 41.1231, lng: 20.8016 } },
    "By the lake.",
  );
  // The blank day: title, date, prose — no coordinates, no location, no
  // country. Exactly what the ticket found on fernscout.ch.
  writeDay("train", "2026-09-03", { title: "On the train" }, "Nothing to report today.");
  writeDay(
    "skopje",
    "2026-09-04",
    { title: "Skopje", location: "Skopje", country: "North Macedonia", coordinates: { lat: 41.9981, lng: 21.4254 } },
    "Last stop.",
  );
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("a day with no coordinates", () => {
  test("is not a place — three located days plus one blank day still yields three places", () => {
    const places = getPlaces("u/t");
    expect(places.map((p) => p.location)).toEqual(["Ljubljana", "Ohrid", "Skopje"]);
  });

  test("stats agree with the stop list: three stops, two countries, not four and three", () => {
    const stats = getTripStats("u/t");
    expect(stats.dayCount).toBe(4);
    expect(stats.places).toBe(3);
    expect(stats.countries).toBe(2);
  });
});

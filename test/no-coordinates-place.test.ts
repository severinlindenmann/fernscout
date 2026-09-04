import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { getPlaces, getTripStats } from "@/lib/entries";

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

function writeDay(file: string, frontmatter: string, body: string) {
  fs.writeFileSync(
    path.join(dir, "u", "trips", "t", "entries", file),
    `---\n${frontmatter}---\n\n${body}\n`,
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
  fs.writeFileSync(
    path.join(dir, "u", "trips", "t", "trip.md"),
    ['---', 'id: t', 'title: "Test trip"', 'start: "2026-09-01"', 'end: "2026-09-04"', 'status: past', '---', '', 'Intro.', ''].join("\n"),
  );

  writeDay(
    "2026-09-01-ljubljana.md",
    ['title: "Ljubljana"', 'date: "2026-09-01"', 'location: "Ljubljana"', 'country: "Slovenia"', "lat: 46.0569", "lng: 14.5058"].join(
      "\n",
    ) + "\n",
    "Arrived.",
  );
  writeDay(
    "2026-09-02-ohrid.md",
    [
      'title: "Ohrid"',
      'date: "2026-09-02"',
      'location: "Ohrid"',
      'country: "North Macedonia"',
      "lat: 41.1231",
      "lng: 20.8016",
    ].join("\n") + "\n",
    "By the lake.",
  );
  // The blank day: title, date, prose — no lat, no lng, no location, no
  // country. Exactly what the ticket found on fernscout.ch.
  writeDay("2026-09-03-train.md", ['title: "On the train"', 'date: "2026-09-03"'].join("\n") + "\n", "Nothing to report today.");
  writeDay(
    "2026-09-04-skopje.md",
    [
      'title: "Skopje"',
      'date: "2026-09-04"',
      'location: "Skopje"',
      'country: "North Macedonia"',
      "lat: 41.9981",
      "lng: 21.4254",
    ].join("\n") + "\n",
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

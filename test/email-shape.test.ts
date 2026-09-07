import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isEmail } from "@/lib/auth";
import { isPersonEmail, getTrip } from "@/lib/trips";
import { parseUserConfig } from "@/lib/config";

/**
 * B247 — one predicate, three former copies.
 *
 * `lib/trips.ts` (a trip's `people:`), `lib/config.ts` (`owner.email`) and
 * `lib/auth`'s `isEmail` (who may ask for a code) each had their own regex,
 * and two of the three disagreed on the last segment: `lib/trips.ts` took a
 * single-character TLD (`a@b.c`), the other two required two. Since `people:`
 * decides who may hold a trip-scoped token and `isEmail` decides whether the
 * request for one is even accepted, that gap was a person on a trip who could
 * never get in. All three now defer to `isEmail`.
 */

const TABLE: Array<[string, boolean]> = [
  ["a@example.com", true],
  ["a.b+tag@example.co.uk", true],
  ["a@b.co", true],
  // The one address the three copies disagreed on: valid shape everywhere
  // except a trip's `people:` block, which used to accept it. Unifying on
  // the stricter `isEmail` tightens `people:` rather than loosening the
  // other two — nobody's existing address gets a single-letter TLD.
  ["a@b.c", false],
  ["not-an-email", false],
  ["missing-at.example.com", false],
  ["two@@example.com", false],
  ["trailing@dot.", false],
];

describe("isEmail", () => {
  test.each(TABLE)("%s -> %s", (address, expected) => {
    expect(isEmail(address)).toBe(expected);
  });
});

describe("lib/trips re-exports the same predicate", () => {
  test.each(TABLE)("%s -> %s", (address, expected) => {
    expect(isPersonEmail(address)).toBe(expected);
  });
});

describe("a trip's people: block and a journal's owner.email agree", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-email-shape-"));
    process.env.CONTENT_DIR = dir;
  });

  afterEach(() => {
    delete process.env.CONTENT_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("a people: entry shaped like a@b.c is dropped, same as owner.email would be", () => {
    const root = path.join(dir, "u", "trips", "t");
    fs.mkdirSync(path.join(root, "entries"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "trip.md"),
      [
        "---",
        'id: "t"',
        'title: "t"',
        'start: "2026-08-25"',
        'end: "2026-08-26"',
        'status: "past"',
        'visibility: "private"',
        "people:",
        '  - name: "R"',
        '    email: "a@b.c"',
        "---",
        "",
        "Intro.",
        "",
      ].join("\n"),
    );

    // The whole list is dropped on a malformed entry, so an address this
    // predicate refuses leaves the trip with nobody but its owner — the
    // same failure mode `parsePeople` already uses for any other bad entry.
    expect(getTrip("u/t")?.people).toEqual([]);

    expect(() =>
      parseUserConfig("u", {
        title: "T",
        tagline: "L",
        owner: { name: "A", nickname: "A", email: "a@b.c" },
        startLocation: "X",
        defaultLocale: "en",
        locales: ["en"],
        baseCurrency: "CHF",
        displayCurrencies: ["CHF"],
        units: "metric",
        features: {},
      }),
    ).toThrow(/owner\.email must be an email address/);
  });
});

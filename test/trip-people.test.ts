import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { getTrip, tripRef, MAX_TRIP_PEOPLE } from "@/lib/trips";
import {
  isPersonOn,
  peopleNamedIn,
  peopleOf,
  scopeAllows,
  tripWriteScope,
} from "@/lib/tripPeople";

/**
 * Who took the trip — read access and byline credit, both unchanged by
 * B2297. The list still fails **closed**: one malformed line drops the whole
 * block rather than silently admitting or excluding one person. A
 * half-parsed list of people is a half-parsed answer to who may read a
 * closed trip. (Write access is a different, narrower question since
 * B2297 — `peopleOf`/`tripWriteVerdict`, grant-only — see
 * `test/trip-write-verdict.test.ts`.)
 */

let dir: string;

// Not on writeTripFixture (B1630): every case in this file writes a
// deliberately malformed `people:` block (a bad email, a duplicate address,
// too many entries) to test the fail-closed *reader* — `createTrip`
// validates `people` and would refuse to write any of these at all. Same
// resistance as test/travellers-on-disk.test.ts and test/trip-reparse.test.ts.
// Malformed/raw JSON rather than malformed markdown: `getTrip` reads
// `trip.json` exclusively now (lib/trips.ts).
function writeTrip(id: string, people: unknown[]) {
  const tripDir = path.join(dir, "alex", "trips", id);
  fs.mkdirSync(tripDir, { recursive: true });
  fs.writeFileSync(
    path.join(tripDir, "trip.json"),
    JSON.stringify({
      id,
      title: id,
      dates: { from: "2026-01-01", to: "2026-01-05" },
      visibility: "public",
      intro: "Body.",
      ...(people.length ? { people } : {}),
    }),
  );
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-people-"));
  process.env.CONTENT_DIR = dir;
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "F", url: "https://example.test", defaultUser: "alex" },
      users: { reserved: [] },
      features: {},
    }),
  );
  fs.mkdirSync(path.join(dir, "alex", "trips"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "Alex", tagline: "t",
      owner: { name: "A B", nickname: "A", email: "alex@example.com" }, startLocation: "X",
      defaultLocale: "en", locales: ["en"], baseCurrency: "CHF",
      displayCurrencies: ["CHF"], units: "metric", features: {},
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

const trip = (id: string) => getTrip(tripRef("alex", id))!;

describe("the people block", () => {
  /**
   * No `DATABASE_URL` in this file, deliberately. `peopleOf` is the owner
   * plus the redeemed places (B33; `people:` is the byline only since
   * B2297), and the property that matters here is that the owner's own half
   * stands entirely on its own: with no database at all — a supported way to
   * run this site — the owner still writes their own trip.
   */
  test("a solo trip names nobody, and the owner is still on it", async () => {
    writeTrip("solo-2026", []);
    expect(trip("solo-2026").people).toEqual([]);
    expect(await peopleOf(trip("solo-2026"))).toEqual(["alex@example.com"]);
    expect(await isPersonOn(trip("solo-2026"), "alex@example.com")).toBe(true);
    expect(await isPersonOn(trip("solo-2026"), "robin@example.com")).toBe(false);
  });

  test("the file's own list is the whole answer when there is no database", () => {
    writeTrip("solo-2026", []);
    expect(peopleNamedIn(trip("solo-2026"))).toEqual(["alex@example.com"]);
  });

  test("addresses are lower-cased, because that is how they are compared", async () => {
    writeTrip("shared-2026", [{ name: "Robin", email: "Robin@Example.COM" }]);
    expect(trip("shared-2026").people).toEqual([{ name: "Robin", email: "robin@example.com" }]);
    expect(await isPersonOn(trip("shared-2026"), "  ROBIN@example.com ")).toBe(true);
  });

  test("ten is allowed", () => {
    writeTrip(
      "big-2026",
      Array.from({ length: MAX_TRIP_PEOPLE }, (_, i) => ({ name: `P${i}`, email: `p${i}@e.com` })),
    );
    expect(trip("big-2026").people).toHaveLength(MAX_TRIP_PEOPLE);
  });

  test("eleven is not, and the whole list is dropped rather than truncated", () => {
    writeTrip(
      "huge-2026",
      Array.from({ length: MAX_TRIP_PEOPLE + 1 }, (_, i) => ({ name: `P${i}`, email: `p${i}@e.com` })),
    );
    expect(trip("huge-2026").people).toEqual([]);
  });

  test.each([
    [{ name: "No address", email: "" }, "a missing address"],
    [{ name: "Bad", email: "not-an-address" }, "an address that is not one"],
    [{ email: "nameless@e.com" }, "a missing name"],
    ["just a string", "an entry that is not a mapping"],
  ] as [unknown, string][])("%s is rejected — %s", (entry) => {
    writeTrip("bad-2026", [entry]);
    expect(trip("bad-2026").people).toEqual([]);
  });

  test("a duplicate address drops the list, rather than picking one", () => {
    writeTrip("dupe-2026", [
      { name: "Robin", email: "robin@e.com" },
      { name: "Robin again", email: "ROBIN@e.com" },
    ]);
    expect(trip("dupe-2026").people).toEqual([]);
  });

  describe("a nickname on a person", () => {
    test("is read when given", () => {
      writeTrip("nick-1", [
        { name: "Robin Berger", email: "robin@example.com", nickname: "Robin" },
      ]);
      expect(trip("nick-1").people[0].nickname).toBe("Robin");
    });

    test("is absent rather than guessed from the name", () => {
      writeTrip("nick-2", [{ name: "Robin Berger", email: "robin@example.com" }]);
      expect(trip("nick-2").people[0].nickname).toBeUndefined();
    });

    test("drops the whole list when it is not text, as any bad entry does", () => {
      writeTrip("nick-3", [
        { name: "Robin Berger", email: "robin@example.com", nickname: 7 },
      ]);
      expect(trip("nick-3").people).toEqual([]);
    });
  });
});

/**
 * A token belongs to one trip unless it belongs to the journal. Being on
 * somebody's Vietnam trip is not a reason to be able to rewrite their
 * honeymoon.
 */
describe("what a scope reaches", () => {
  beforeEach(() => {
    writeTrip("vietnam-2026", [{ name: "Robin", email: "robin@e.com" }]);
    writeTrip("honeymoon-2027", []);
  });

  test("the journal's own scope reaches every trip in it", () => {
    expect(scopeAllows("write:content", trip("vietnam-2026"))).toBe(true);
    expect(scopeAllows("write:content", trip("honeymoon-2027"))).toBe(true);
  });

  test("a trip scope reaches that trip and no other", () => {
    const scope = tripWriteScope("vietnam-2026");
    expect(scopeAllows(scope, trip("vietnam-2026"))).toBe(true);
    expect(scopeAllows(scope, trip("honeymoon-2027"))).toBe(false);
  });

  test("no scope reaches nothing", () => {
    expect(scopeAllows(undefined, trip("vietnam-2026"))).toBe(false);
    expect(scopeAllows("", trip("vietnam-2026"))).toBe(false);
    expect(scopeAllows("read", trip("vietnam-2026"))).toBe(false);
  });
});

/**
 * Asking for less must give you less.
 *
 * Naming a trip when requesting an agent token used to be ignored for the
 * journal's owner: they asked for one trip and were silently handed
 * `write:content` for the whole journal. An owner wanting to bound what an
 * agent could reach could not, and was not told. Quietly granting more than
 * was asked for is the one answer that cannot be argued for.
 *
 * The scope string is what the route stores on the session, so this pins the
 * decision the route makes rather than the route itself.
 */
describe("a narrow request", () => {
  test("narrows the scope for the owner too, not only for a companion", async () => {
    // Both trips written before either is read: lib/trips.ts memoises per
    // content root, so a trip created after the first read is not seen.
    writeTrip("vietnam-2026", [{ name: "Robin", email: "robin@e.com" }]);
    writeTrip("honeymoon-2027", []);
    const t = trip("vietnam-2026");

    // Both addresses read/are named here — `isPersonOn` is the byline-and-
    // reading check, unaffected by B2297; either may ask for this trip
    // alone. (Whether "robin@e.com" could actually *write* through that
    // scope is `tripWriteVerdict`'s question, grant-only since B2297 —
    // `test/trip-write-verdict.test.ts`'s coverage.)
    for (const email of ["alex@example.com", "robin@e.com"]) {
      expect(await isPersonOn(t, email), email).toBe(true);
    }
    const scope = tripWriteScope(t.id);
    expect(scopeAllows(scope, t)).toBe(true);
    expect(scopeAllows(scope, trip("honeymoon-2027"))).toBe(false);
  });
});

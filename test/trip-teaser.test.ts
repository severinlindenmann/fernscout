import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isIndexable } from "@/lib/access";
import { clearConfigCache } from "@/lib/config";
import { getTrip } from "@/lib/trips";
import { clearUserCache } from "@/lib/users";
import { tripToJson, type TripFile } from "@/lib/api/v2/documents";

/**
 * `teaser:` — a closed trip saying that it exists. B587.
 *
 * Three things to hold, and the third is the one that would hurt: the key is
 * honoured on a closed trip, refused on a public one, and it moves *nothing*
 * about who may read the trip or what advertises it. `isIndexable` is the
 * sitemap and the feed; a teaser card is one page's own decision to name a
 * trip its owner asked to have named, and nothing else may follow from it.
 */

let dir: string;

// Not on writeTripFixture (B1630): the journal here is "u", a one-character
// username `isValidUsername` refuses — `createTrip` (the fixture's writer)
// fails with `no_such_journal` before it ever gets to write anything.
function write(
  id: string,
  opts: { visibility?: "private" | "guest" | "public"; listed?: boolean; teaser?: boolean } = {},
) {
  const folder = path.join(dir, "u", "trips", id);
  fs.mkdirSync(folder, { recursive: true });
  const trip: TripFile = {
    id,
    title: "T",
    dates: { from: "2026-01-01", to: "2026-01-05" },
    visibility: opts.visibility ?? "public",
    people: [],
    intro: "Intro.",
    ...(opts.listed !== undefined ? { listed: opts.listed } : {}),
    ...(opts.teaser ? { teaser: true } : {}),
  };
  fs.writeFileSync(path.join(folder, "trip.json"), tripToJson(trip));
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-teaser-"));
  process.env.CONTENT_DIR = dir;
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "T", url: "https://t.test", defaultUser: "u" }, features: {} }),
  );
  fs.mkdirSync(path.join(dir, "u"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "u", "config.json"),
    JSON.stringify({ title: "U", owner: { name: "A B", nickname: "A", email: "a@t.test" } }),
  );
  write("closed-2026", { visibility: "private", teaser: true });
  write("invited-2026", { visibility: "guest", teaser: true });
  write("open-2026", { visibility: "public", teaser: true });
  write("quiet-2026", { visibility: "public", listed: false, teaser: true });
  write("plain-2026", { visibility: "private" });
  clearConfigCache();
  clearUserCache();
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("teaser:", () => {
  test("is honoured on a private and on a guest trip", () => {
    expect(getTrip("u/closed-2026")?.teaser).toBe(true);
    expect(getTrip("u/invited-2026")?.teaser).toBe(true);
  });

  test("is absent when the file does not ask for it", () => {
    expect(getTrip("u/plain-2026")?.teaser).toBeUndefined();
  });

  test("is refused and logged on a public trip, advertised or not", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(getTrip("u/open-2026")?.teaser).toBeUndefined();
    expect(getTrip("u/quiet-2026")?.teaser).toBeUndefined();
    expect(warn.mock.calls.flat().join(" ")).toContain("teaser: true");
  });

  test("advertises nothing: the sitemap and the feed are unmoved", () => {
    for (const id of ["closed-2026", "invited-2026"]) {
      const trip = getTrip(`u/${id}`)!;
      expect(trip.teaser).toBe(true);
      expect(trip.listed).toBe(false);
      expect(isIndexable(trip)).toBe(false);
    }
  });
});

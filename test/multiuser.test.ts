import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache, loadServerConfig, loadUserConfig } from "@/lib/config";
import { mediaUrl, resolveMediaFile } from "@/lib/media";
import { getPlaces, getTripStats } from "@/lib/entries";
import { getAllTrips, getTrip, getTrips, parseTripRef, tripRef } from "@/lib/trips";
import { clearUserCache, getUser, getUsernames, isUsableUsername } from "@/lib/users";

/**
 * Isolation between users.
 *
 * The filesystem layout is the boundary, so these are tests about the boundary
 * holding rather than about any one feature working. A leak here is the worst
 * failure this project can have: somebody else's private trip on your page.
 */

let dir: string;

function writeUser(username: string, trips: Record<string, string>) {
  fs.mkdirSync(path.join(dir, username, "trips"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, username, "config.json"),
    JSON.stringify({
      title: `${username}'s journal`,
      tagline: "t",
      owner: { name: "A B", nickname: "A" },
      startLocation: "X",
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: username === "bea" ? "EUR" : "CHF",
      displayCurrencies: username === "bea" ? ["EUR"] : ["CHF"],
      units: "metric",
      features: { reactions: { enabled: true }, costs: { enabled: true } },
    }),
  );
  for (const [id, visibility] of Object.entries(trips)) {
    const tripPath = path.join(dir, username, "trips", id);
    fs.mkdirSync(path.join(tripPath, "media"), { recursive: true });
    fs.writeFileSync(
      path.join(tripPath, "trip.md"),
      [
        "---",
        `id: ${id}`,
        `title: "${id}"`,
        'start: "2026-01-01"',
        'end: "2026-01-05"',
        "status: past",
        `visibility: ${visibility}`,
        "---",
        "",
        "Body.",
        "",
      ].join("\n"),
    );
    fs.writeFileSync(path.join(tripPath, "media", "photo.jpg"), "not really a jpeg");
  }
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-mu-"));
  process.env.CONTENT_DIR = dir;
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: "ana" },
      users: { reserved: ["admin"] },
      features: {},
    }),
  );
  writeUser("ana", { "alps-2026": "public", "secret-2025": "guest" });
  writeUser("bea", { "peru-2026": "public" });
  clearConfigCache();
  clearUserCache();
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("users", () => {
  test("finds every user with a config", () => {
    expect(getUsernames()).toEqual(["ana", "bea"]);
  });

  test("skips a directory that is not a usable username", () => {
    fs.mkdirSync(path.join(dir, "Not A User"), { recursive: true });
    fs.mkdirSync(path.join(dir, "admin", "trips"), { recursive: true });
    fs.writeFileSync(path.join(dir, "admin", "config.json"), "{}");
    clearUserCache();
    expect(getUsernames()).toEqual(["ana", "bea"]);
  });

  test("skips a directory with no config", () => {
    fs.mkdirSync(path.join(dir, "cyd", "trips"), { recursive: true });
    clearUserCache();
    expect(getUsernames()).not.toContain("cyd");
  });

  test("rejects reserved and malformed usernames", () => {
    for (const bad of ["api", "_next", "media", "admin", "A", "-x", "x", ""]) {
      expect(isUsableUsername(bad)).toBe(false);
    }
    expect(isUsableUsername("ana")).toBe(true);
  });
});

describe("config is split by owner", () => {
  test("the server config carries no personal data", () => {
    const server = loadServerConfig();
    expect(server.site.name).toBe("R");
    expect(server.site).not.toHaveProperty("title");
    expect(server.site).not.toHaveProperty("owner");
  });

  test("each user keeps their own currency and title", () => {
    expect(loadUserConfig("ana").baseCurrency).toBe("CHF");
    expect(loadUserConfig("bea").baseCurrency).toBe("EUR");
    expect(getUser("ana")?.title).toBe("ana's journal");
    expect(getUser("bea")?.title).toBe("bea's journal");
  });
});

describe("trips never cross the boundary", () => {
  test("a user's trip list holds only their own", () => {
    expect(
      getTrips("ana")
        .map((t) => t.id)
        .sort(),
    ).toEqual(["alps-2026", "secret-2025"]);
    expect(getTrips("bea").map((t) => t.id)).toEqual(["peru-2026"]);
  });

  test("one user cannot reach another's trip by id", () => {
    expect(getTrip(tripRef("bea", "alps-2026"))).toBeUndefined();
    expect(getTrip(tripRef("bea", "secret-2025"))).toBeUndefined();
    expect(getTrip(tripRef("ana", "alps-2026"))?.username).toBe("ana");
  });

  test("every trip knows who owns it", () => {
    for (const trip of getAllTrips()) {
      expect(trip.ref).toBe(`${trip.username}/${trip.id}`);
      expect(getTrips(trip.username).map((t) => t.id)).toContain(trip.id);
    }
  });

  test("a ref cannot be forged with traversal", () => {
    for (const bad of ["../bea/peru-2026", "ana/../bea/peru-2026", "ana", "/ana/x", "ana/"]) {
      expect(getTrip(bad)).toBeUndefined();
    }
  });

  test("parseTripRef rejects anything it cannot vouch for", () => {
    expect(parseTripRef("ana/alps-2026")).toEqual({ username: "ana", tripId: "alps-2026" });
    for (const bad of ["ana", "/x", "a//b", "ana/../x", "ana/x/y"]) {
      expect(parseTripRef(bad)).toBeNull();
    }
  });
});

describe("media stays inside its owner", () => {
  test("resolves a file for the right user", () => {
    expect(resolveMediaFile("ana", ["alps-2026", "photo.jpg"])).toContain(
      path.join("ana", "trips", "alps-2026", "media", "photo.jpg"),
    );
  });

  test("refuses another user's media, even with a correct trip id", () => {
    expect(resolveMediaFile("bea", ["alps-2026", "photo.jpg"])).toBeNull();
    expect(resolveMediaFile("ana", ["peru-2026", "photo.jpg"])).toBeNull();
  });

  test("refuses traversal out of the user directory", () => {
    const attempts = [
      ["..", "bea", "trips", "peru-2026", "media", "photo.jpg"],
      ["alps-2026", "..", "..", "..", "..", "bea", "config.json"],
      ["alps-2026", "."],
    ];
    for (const segments of attempts) {
      expect(resolveMediaFile("ana", segments)).toBeNull();
    }
  });

  test("media URLs carry the username", () => {
    expect(mediaUrl("ana/alps-2026", "photo.jpg")).toBe("/ana/media/alps-2026/photo.jpg");
  });
});

describe("reaction keys carry their owner", () => {
  /**
   * `reactions` scopes by qualified trip ref rather than by `owner_id` (see
   * lib/db/owner.ts). That is safe *only* while every ref reaching it is
   * qualified — a bare `asia-2023` from two journals would collide on the same
   * day slug and merge two families' votes.
   */
  test("the API rejects a trip id that is not qualified", () => {
    // getTrip is what the reactions route gates on before recording anything.
    expect(getTrip("alps-2026")).toBeUndefined();
    expect(getTrip("secret-2025")).toBeUndefined();
    expect(getTrip(tripRef("ana", "alps-2026"))).toBeDefined();
  });

  test("two users' trips never produce the same ref", () => {
    const refs = getAllTrips().map((t) => t.ref);
    expect(new Set(refs).size).toBe(refs.length);
    for (const ref of refs) expect(ref).toContain("/");
  });
});

/**
 * Every reader in `lib/entries` resolves a directory from `<user>/<tripId>`.
 * Handed a bare id it finds no directory and answers "no entries" rather than
 * throwing, which is the right answer for a trip that does not exist and a
 * silent one for a caller that simply forgot the username. That mistake has
 * now shipped twice — a 400 from the reactions endpoint, and a trips index on
 * which every trip had zero days, zero countries and no route on the map — so
 * the trap is pinned here.
 */
describe("entries are read by qualified ref", () => {
  function writeEntry(username: string, tripId: string) {
    const entries = path.join(dir, username, "trips", tripId, "entries");
    fs.mkdirSync(entries, { recursive: true });
    fs.writeFileSync(
      path.join(entries, "2026-01-02-a-pass.md"),
      [
        "---",
        'title: "A pass"',
        'date: "2026-01-02"',
        'location: "Susten"',
        'country: "Switzerland"',
        "lat: 46.7",
        "lng: 8.4",
        "---",
        "",
        "Body.",
        "",
      ].join("\n"),
    );
  }

  test("a trip's ref finds its days; its bare id finds nothing", () => {
    writeEntry("ana", "alps-2026");
    const trip = getTrip(tripRef("ana", "alps-2026"))!;
    expect(trip.ref).toBe("ana/alps-2026");

    expect(getTripStats(trip.ref).dayCount).toBe(1);
    expect(getPlaces(trip.ref)).toHaveLength(1);

    expect(getTripStats(trip.id).dayCount).toBe(0);
    expect(getPlaces(trip.id)).toEqual([]);
  });

  test("one user's ref never reaches another user's trip of the same name", () => {
    writeEntry("ana", "alps-2026");
    fs.mkdirSync(path.join(dir, "bea", "trips", "alps-2026"), { recursive: true });
    expect(getPlaces(tripRef("bea", "alps-2026"))).toEqual([]);
  });
});

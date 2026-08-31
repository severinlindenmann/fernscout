import { afterEach, beforeEach, describe, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { getTrip, getTrips, getCurrentTrip, getTripIds, currentTripRef } from "@/lib/trips";

const SERVER_CFG = '{"site":{"name":"F","url":"https://example.test","defaultUser":"u"},"users":{"reserved":[]},"features":{}}';
const USER_CFG = '{"title":"F","tagline":"t","owner":{"name":"A B","nickname":"A"},"startLocation":"X","defaultLocale":"en","locales":["en"],"baseCurrency":"CHF","displayCurrencies":["CHF"],"units":"metric","features":{"reactions":{"enabled":true},"costs":{"enabled":true}}}';

const FIXTURES = path.join(process.cwd(), "test", "fixtures", "content");

beforeEach(() => {
  process.env.CONTENT_DIR = FIXTURES;
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
});

describe("getTrips", () => {
  test("reads every well-formed trip and skips the broken one", () => {
    expect(getTripIds("u").sort()).toEqual(["alpha-2023", "beta-2026", "gamma-2027"]);
  });

  test("orders current, then upcoming ascending, then past descending", () => {
    expect(getTrips("u").map((t) => t.id)).toEqual(["beta-2026", "gamma-2027", "alpha-2023"]);
  });

  test("parses the body as the intro", () => {
    expect(getTrip("u/alpha-2023")?.intro).toBe("The first one.");
  });

  test("parses translations", () => {
    expect(getTrip("u/beta-2026")?.translations?.de?.title).toBe("Beta, unterwegs");
  });

  test("defaults a missing accent to sky", () => {
    // gamma declares green; alpha declares coral. Both are honoured.
    expect(getTrip("u/gamma-2027")?.accent).toBe("green");
    expect(getTrip("u/alpha-2023")?.accent).toBe("coral");
  });

  test("returns undefined for an unknown id", () => {
    expect(getTrip("u/nope")).toBeUndefined();
  });

  test("never returns a trip whose id disagrees with its folder", () => {
    expect(getTrips("u").every((t) => getTripIds("u").includes(t.id))).toBe(true);
  });
});

describe("getCurrentTrip", () => {
  test("returns the trip declaring status: current", () => {
    expect(getCurrentTrip("u")?.id).toBe("beta-2026");
    expect(currentTripRef("u")).toBe("u/beta-2026");
  });

  test("falls back to the latest-ending past trip when none is current", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trips-"));
    fs.writeFileSync(path.join(dir, "config.json"), SERVER_CFG);
    fs.mkdirSync(path.join(dir, "u"), { recursive: true });
    fs.writeFileSync(path.join(dir, "u", "config.json"), USER_CFG);
    fs.mkdirSync(path.join(dir, "u", "trips", "only-2020"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "u", "trips", "only-2020", "trip.md"),
      '---\nid: only-2020\ntitle: "Only"\nstart: "2020-01-01"\nend: "2020-01-09"\nstatus: past\n---\n\nDone.\n',
    );
    process.env.CONTENT_DIR = dir;
    expect(getCurrentTrip("u")?.id).toBe("only-2020");
  });

  test("when several claim current, the latest start wins and the rest read as past", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trips-"));
    fs.writeFileSync(path.join(dir, "config.json"), SERVER_CFG);
    fs.mkdirSync(path.join(dir, "u"), { recursive: true });
    fs.writeFileSync(path.join(dir, "u", "config.json"), USER_CFG);
    for (const [id, start] of [["one-2024", "2024-01-01"], ["two-2025", "2025-01-01"]]) {
      fs.mkdirSync(path.join(dir, "u", "trips", id), { recursive: true });
      fs.writeFileSync(
        path.join(dir, "u", "trips", id, "trip.md"),
        `---\nid: ${id}\ntitle: "${id}"\nstart: "${start}"\nend: "${start}"\nstatus: current\n---\n\nx\n`,
      );
    }
    process.env.CONTENT_DIR = dir;
    expect(getCurrentTrip("u")?.id).toBe("two-2025");
    expect(getTrip("u/one-2024")?.status).toBe("past");
  });
});

describe("no content at all", () => {
  test("returns an empty list rather than throwing", () => {
    process.env.CONTENT_DIR = path.join(os.tmpdir(), "definitely-not-here");
    expect(getTrips("u")).toEqual([]);
    expect(getCurrentTrip("u")).toBeUndefined();
  });
});

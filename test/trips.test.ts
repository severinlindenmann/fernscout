import { afterEach, beforeEach, describe, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import {
  accentsFor,
  getTrip,
  getTrips,
  getCurrentTrip,
  getTripIds,
  currentTripRef,
} from "@/lib/trips";
import type { Trip, TripAccent } from "@/lib/types";

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
    expect(getTripIds("u").sort()).toEqual([
      "alpha-2023",
      "beta-2026",
      "gamma-2027",
      "unnamed-2025",
    ]);
  });

  test("orders current, then upcoming ascending, then past descending", () => {
    expect(getTrips("u").map((t) => t.id)).toEqual([
      "beta-2026",
      "gamma-2027",
      "unnamed-2025",
      "alpha-2023",
    ]);
  });

  test("parses the body as the intro", () => {
    expect(getTrip("u/alpha-2023")?.intro).toBe("The first one.");
  });

  test("parses translations", () => {
    expect(getTrip("u/beta-2026")?.translations?.de?.title).toBe("Beta, unterwegs");
  });

  test("reads the accent the trip declares, and leaves a missing one unset", () => {
    // gamma declares green; alpha declares coral. Both are honoured.
    expect(getTrip("u/gamma-2027")?.accent).toBe("green");
    expect(getTrip("u/alpha-2023")?.accent).toBe("coral");
    // B346: absent is its own answer, not sky. `accentsFor` is what turns it
    // into a colour, so that a journal's trips differ from each other.
    expect(getTrip("u/unnamed-2025")?.accent).toBeUndefined();
  });

  test("puts the owner on a trip-relative cover", () => {
    // trip.md writes "/media/<trip>/…" so a trip folder is self-contained and
    // copyable — `npm run seed:example` does exactly that. Handing that path
    // to the browser unprefixed is a 404 on the trip card and in the OG image.
    expect(getTrip("u/beta-2026")?.cover).toBe("/u/media/beta-2026/one/01.jpg");
  });

  test("leaves an already-absolute cover alone", () => {
    expect(getTrip("u/gamma-2027")?.cover).toBe("/brand/placeholder.jpg");
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

/**
 * B346. Every scaffolded trip carried `accent: sky` — `lib/tripWrite.ts` wrote
 * it whether or not anybody had chosen a colour, and `parseAccent` defaulted a
 * missing one to sky too. A journal's trips were therefore uniformly blue, and
 * no code could assign a distinct colour without also overriding the ones an
 * owner had actually picked. It only became visible when B344 removed the
 * lifetime map's route lines and left colour as the sole thing separating one
 * trip's pins from another's.
 */
describe("accentsFor", () => {
  function trip(ref: string, accent?: TripAccent): Trip {
    return { ref, accent } as Trip;
  }

  test("trips with no preference each get a different colour", () => {
    const got = accentsFor([trip("u/a"), trip("u/b"), trip("u/c")]);

    expect(new Set(got.values()).size).toBe(3);
  });

  test("a colour the owner chose is kept, and not handed to anybody else", () => {
    const got = accentsFor([trip("u/a", "coral"), trip("u/b"), trip("u/c")]);

    expect(got.get("u/a")).toBe("coral");
    expect(got.get("u/b")).not.toBe("coral");
    expect(got.get("u/c")).not.toBe("coral");
  });

  test("more trips than colours repeats rather than inventing one", () => {
    const trips = ["a", "b", "c", "d", "e", "f", "g"].map((id) => trip(`u/${id}`));
    const got = accentsFor(trips);

    expect(got.size).toBe(7);
    // Every trip has a real accent from the palette — none undefined, none
    // mixed at runtime.
    for (const colour of got.values()) {
      expect(["sky", "yellow", "green", "coral", "navy"]).toContain(colour);
    }
  });

  test("every colour being claimed still leaves something to hand out", () => {
    const claimed: TripAccent[] = ["sky", "yellow", "green", "coral", "navy"];
    const got = accentsFor([...claimed.map((c, i) => trip(`u/c${i}`, c)), trip("u/spare")]);

    expect(got.get("u/spare")).toBeDefined();
  });

  test("one trip is still assigned a colour", () => {
    expect(accentsFor([trip("u/only")]).get("u/only")).toBeDefined();
  });
});

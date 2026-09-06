import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { getTrip, tripRef } from "@/lib/trips";
import { createTrip } from "@/lib/tripWrite";
import { PERFECT_TRIP_EXAMPLE, TRIP_FIELDS } from "@/lib/api/agentCopy";

/**
 * B530 — the published trip example was the four fields a trip is *refused*
 * for lacking, so the other ten were invisible at the moment an agent wrote
 * the call. B335 found and fixed the same thing for a day one call later.
 *
 * Two ways this can rot, and both are checked here rather than left to be
 * noticed: an example that documents a field the code does not accept, and a
 * field added to `NewTrip` that nobody documents. The second is how
 * `travellers` came to be missing from a sentence that counted two of it
 * (B526).
 */

const example = () => JSON.parse(PERFECT_TRIP_EXAMPLE.join("\n")) as Record<string, unknown>;

/**
 * Every key of `NewTrip`, read from the source.
 *
 * There is no runtime list to compare against — a TypeScript type is gone by
 * the time this runs — and the alternative to reading the file is a third
 * hand-maintained copy of the same list, which is the thing this test exists
 * to prevent. `test/depersonalised.test.ts` scans source for the same reason.
 */
function newTripKeys(): string[] {
  const source = fs.readFileSync(path.join(process.cwd(), "lib/tripWrite.ts"), "utf8");
  const block = source.slice(
    source.indexOf("export type NewTrip = {"),
    source.indexOf("\n};", source.indexOf("export type NewTrip = {")),
  );
  return [...block.matchAll(/^ {2}(\w+)\??:/gm)].map((m) => m[1]);
}

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-trip-shape-"));
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
      title: "Alex",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: "alex@example.com" },
      startLocation: "X",
      defaultLocale: "en",
      locales: ["en", "de"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features: {},
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

describe("the published trip example", () => {
  test("is valid JSON, so it can be copied as it stands", () => {
    expect(() => example()).not.toThrow();
  });

  test("carries every field of NewTrip except the two deliberately held back", () => {
    const documented = new Set(TRIP_FIELDS.map((f) => f.key));
    for (const key of newTripKeys()) {
      expect(documented, `${key} is a field of NewTrip and is not in TRIP_FIELDS`).toContain(key);
    }
    const shown = new Set(Object.keys(example()));
    for (const key of newTripKeys()) {
      // `test` is left out because an example is a thing people copy, and
      // `"test": true` copied by accident puts a banner on a real journey.
      if (key === "test") continue;
      expect(shown, `${key} is a field of NewTrip and is not in the example`).toContain(key);
    }
  });

  test("documents nothing the create call does not take", () => {
    // `cover` is the one row that documents an *absence*, and says so.
    const real = new Set([...newTripKeys(), "cover"]);
    for (const field of TRIP_FIELDS) {
      expect(real, `TRIP_FIELDS documents ${field.key}, which NewTrip has no field for`).toContain(
        field.key,
      );
    }
  });

  test("marks exactly the four fields a trip is refused for lacking", () => {
    expect(TRIP_FIELDS.filter((f) => f.required).map((f) => f.key)).toEqual([
      "id",
      "title",
      "start",
      "end",
    ]);
  });

  test("is accepted as it stands, and every field of it reads back", () => {
    const made = createTrip("alex", example() as never);
    expect(made.ok, made.ok ? "" : `${made.error}: ${made.message}`).toBe(true);

    const trip = getTrip(tripRef("alex", "japan-2027"))!;
    expect(trip.title).toBe("Japan");
    expect(trip.tagline).toBe("six weeks by train");
    expect(trip.status).toBe("current");
    expect(trip.visibility).toBe("public");
    expect(trip.listed).toBe(false);
    expect(trip.accent).toBe("sky");
    expect(trip.costsVisibility).toBe("guests");
    expect(trip.people.map((p) => p.email)).toEqual(["ana@example.test"]);
    expect(trip.travellers).toHaveLength(1);
    expect(trip.rates.JPY).toBe(0.0058);
    expect(trip.translations?.de?.tagline).toBe("sechs Wochen mit dem Zug");
    expect(fs.readFileSync(path.join(dir, "alex", "trips", "japan-2027", "trip.md"), "utf8")).toContain(
      "Six weeks from Kyushu to Hokkaido",
    );
  });

  test("does not carry test: true, which an example would teach by being copied", () => {
    expect(Object.keys(example())).not.toContain("test");
  });
});

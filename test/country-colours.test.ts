import { describe, expect, test } from "vitest";
import colours from "@/lib/countryColours.json";
import adjacency from "@/lib/countryAdjacency.json";

/**
 * B2491, decision 1. `lib/countryColours.json` and `lib/countryAdjacency.json`
 * are generated once by `scripts/build-country-colours.mts` against the
 * *whole world's* border graph, in a fixed (alphabetical ISO2) order — never
 * from a journal's own visited subset, which is what the retired
 * `lib/flagColours.ts` (B370, B375) did, and why adding a trip there could
 * recolour every country already on the map.
 */
const map = colours as Record<string, string>;
const graph = adjacency as Record<string, string[]>;

describe("the generated country colour table", () => {
  test("gives every country in the adjacency graph a colour", () => {
    for (const code of Object.keys(graph)) {
      expect(map[code], code).toBeDefined();
      expect(map[code]).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  test("no two bordering countries share a colour", () => {
    const collisions: string[] = [];
    for (const [code, neighbours] of Object.entries(graph)) {
      for (const n of neighbours) {
        if (map[code] === map[n]) collisions.push(`${code}-${n}`);
      }
    }
    expect(collisions).toEqual([]);
  });

  /**
   * The whole point of colouring the world once rather than the visited
   * subset: a table built from "every country already coloured, in
   * alphabetical order" never reorders or reconsiders a country that was
   * already assigned when a new one is added after it alphabetically —
   * codes sorting after any real ISO2 (like a hypothetical "ZZ") cannot
   * disturb anything before it, since the build only ever reads *earlier*
   * neighbours' colours when it is a later code's own turn.
   */
  test("is keyed by ISO 3166-1 alpha-2 codes only, sorted deterministically", () => {
    const codes = Object.keys(map);
    expect(codes).toEqual([...codes].sort());
    for (const code of codes) expect(code).toMatch(/^[A-Z]{2}$/);
  });

  test("known neighbours land on different colours (Switzerland and its four)", () => {
    for (const n of graph.CH ?? []) {
      expect(map[n]).not.toBe(map.CH);
    }
  });
});

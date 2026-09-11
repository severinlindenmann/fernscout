import { describe, expect, test } from "vitest";
import { AREAS, TOOLS } from "@/lib/helper/tools";

/**
 * B1053 — the registry stopped fitting in one turn's choosing, not its
 * budget. `test/helper-thread.test.ts`'s ceiling test still measures the
 * whole registry's bytes, on purpose (a caller who wants the whole list
 * still gets one), but nothing before this asserted the thing the ticket
 * actually asked for: that **a single turn is offered a materially smaller
 * set than the registry's total**, because that is the number the honesty
 * counters answer to, not the byte count.
 *
 * `answerInThread` always includes the hub area (`trips` — nearly every
 * other tool resolves a trip id off it) plus whichever one area the
 * area-pick round chooses, plus the one `switch_area` escape hatch. That is
 * asserted here as "hub + the single largest other area + one", which is
 * the worst case any ordinary turn can reach without a `switch_area` call.
 */
describe("a turn is offered one area's tools, not the whole registry", () => {
  test("every area partitions the registry — nothing is in two areas, nothing is missing", () => {
    const seen = new Set<string>();
    for (const area of AREAS) {
      for (const tool of area.tools) {
        expect(seen.has(tool.name), `${tool.name} is in two areas`).toBe(false);
        seen.add(tool.name);
      }
    }
    expect(seen.size).toBe(TOOLS.length);
  });

  test("the worst case a turn sends — hub area + one other + the escape hatch — is well under half the registry", () => {
    const HUB = "trips";
    const hub = AREAS.find((area) => area.key === HUB);
    expect(hub, "the hub area named in lib/helper/model.ts must exist").toBeTruthy();
    const largestOther = Math.max(...AREAS.filter((area) => area.key !== HUB).map((area) => area.tools.length));
    const worstCase = (hub?.tools.length ?? 0) + largestOther + 1; // +1 is switch_area itself

    expect(
      worstCase,
      "a turn's tool count should stay well under half the registry — if this creeps back up, an area has grown too large on its own",
    ).toBeLessThan(TOOLS.length / 2);

    // Named so the two numbers cannot silently drift apart without a person
    // reading this comment — update both together if an area's tool count
    // changes enough to move the worst case.
    expect(worstCase).toBe(20);
    expect(TOOLS.length).toBe(47);
  });
});

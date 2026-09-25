import { describe, expect, it } from "vitest";
import { WindowLedger } from "@/lib/dayLoader";

/**
 * Which days the story page asks for, and — the part that was broken — which
 * ones it is still allowed to ask for again.
 *
 * The reader sees this as a day stuck on "this day is loading…" forever. The
 * page had asked for it, the request was cancelled before it was answered, and
 * nothing ever asked again, because the index was still marked as requested.
 */

/** A trip of `n` days with `loaded` already in hand. */
function ledger(loaded: number[] = []) {
  const have = new Set(loaded);
  return {
    it: new WindowLedger(),
    has: (i: number) => have.has(i),
    arrive: (start: number, end: number) => {
      for (let i = start; i < end; i++) have.add(i);
    },
  };
}

describe("WindowLedger", () => {
  it("plans the days either side of the reader, clipped to the trip", () => {
    const { it: l, has } = ledger();
    expect(l.plan({ centre: 10, length: 100, radius: 2, has })).toEqual({
      start: 8,
      end: 13,
    });
    // Neither end runs off the trip.
    expect(new WindowLedger().plan({ centre: 0, length: 100, radius: 2, has })).toEqual({
      start: 0,
      end: 3,
    });
    expect(new WindowLedger().plan({ centre: 99, length: 100, radius: 2, has })).toEqual({
      start: 97,
      end: 100,
    });
  });

  it("skips days already in hand, and asks for nothing when none are missing", () => {
    const { it: l, has } = ledger([8, 9, 10, 11, 12]);
    expect(l.plan({ centre: 10, length: 100, radius: 2, has })).toBeNull();
  });

  it("asks for one range covering the gap, not one request per day", () => {
    // 9 and 11 are in hand; 8, 10 and 12 are not. One request, 8…13.
    const { it: l, has } = ledger([9, 11]);
    expect(l.plan({ centre: 10, length: 100, radius: 2, has })).toEqual({
      start: 8,
      end: 13,
    });
  });

  it("does not ask twice for a range it has already claimed", () => {
    const { it: l, has } = ledger();
    const first = l.plan({ centre: 10, length: 100, radius: 2, has })!;
    l.claim(first);
    expect(l.plan({ centre: 10, length: 100, radius: 2, has })).toBeNull();
  });

  it("asks again for a claim that was given back", () => {
    // The regression. A request that is aborted — React remounting the effect
    // in development, or the reader moving on while it is in flight — is never
    // answered, so the days in it must go back to being askable. They did not,
    // and day one of every trip sat on its placeholder forever.
    const { it: l, has } = ledger();
    const first = l.plan({ centre: 0, length: 4, radius: 2, has })!;
    l.claim(first);
    l.release(first);
    expect(l.plan({ centre: 0, length: 4, radius: 2, has })).toEqual(first);
  });

  it("keeps asking for the days a released request never delivered", () => {
    const { it: l, has, arrive } = ledger([1, 2, 3]);
    // The window around day 0 of a four-day trip: only day 0 is missing.
    const first = l.plan({ centre: 0, length: 4, radius: 2, has })!;
    expect(first).toEqual({ start: 0, end: 1 });
    l.claim(first);
    l.release(first);

    const second = l.plan({ centre: 0, length: 4, radius: 2, has })!;
    l.claim(second);
    arrive(second.start, second.end);
    expect(l.plan({ centre: 0, length: 4, radius: 2, has })).toBeNull();
  });
});

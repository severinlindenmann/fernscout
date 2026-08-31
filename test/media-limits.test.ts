import { describe, expect, test } from "vitest";
import {
  DEFAULT_MEDIA_LIMITS,
  narrowest,
  parseMediaLimits,
  type MediaLimits,
} from "@/lib/mediaLimits";

/**
 * How big a journal is allowed to be, and who decides.
 *
 * The shipped numbers suit a personal journal on a small VPS and are wrong for
 * plenty of people in both directions. Two levels, composing the way
 * capabilities do: the server's are a **ceiling** and a user may only narrow
 * their own. On a shared instance the person paying for the disk decides its
 * size; on a single-user one they are the same person.
 */

describe("reading a media block", () => {
  test("an absent block is the shipped defaults", () => {
    expect(parseMediaLimits(undefined)).toEqual(DEFAULT_MEDIA_LIMITS);
    expect(parseMediaLimits(null)).toEqual(DEFAULT_MEDIA_LIMITS);
    expect(parseMediaLimits({})).toEqual(DEFAULT_MEDIA_LIMITS);
  });

  test("each field can be set on its own", () => {
    const limits = parseMediaLimits({ itemsPerDay: 5, imageBytes: 1024 });
    expect(limits.itemsPerDay).toBe(5);
    expect(limits.imageBytes).toBe(1024);
    // Everything untouched keeps its default rather than becoming undefined.
    expect(limits.videoSeconds).toBe(DEFAULT_MEDIA_LIMITS.videoSeconds);
  });

  /** Zero is not a limit, it is a typo that would refuse every upload. */
  test.each([0, -1, "lots", null, Number.NaN, Infinity])("%s is ignored", (bad) => {
    expect(parseMediaLimits({ itemsPerDay: bad }).itemsPerDay).toBe(
      DEFAULT_MEDIA_LIMITS.itemsPerDay,
    );
  });

  test("a quota is off unless asked for, and null turns it back off", () => {
    expect(parseMediaLimits({}).perUserBytes).toBeNull();
    expect(parseMediaLimits({ perUserBytes: 1_000 }).perUserBytes).toBe(1_000);
    expect(parseMediaLimits({ perUserBytes: null }, { ...DEFAULT_MEDIA_LIMITS, perUserBytes: 5 })
      .perUserBytes).toBeNull();
  });
});

describe("a user's allowance against the server's", () => {
  const ceiling: MediaLimits = {
    imageBytes: 10_000,
    imageEdge: 4000,
    videoBytes: 20_000,
    videoSeconds: 60,
    itemsPerDay: 10,
    perUserBytes: 1_000_000,
  };

  test("a user may ask for less", () => {
    const asked = { ...ceiling, itemsPerDay: 3, imageBytes: 5_000 };
    expect(narrowest(ceiling, asked)).toMatchObject({ itemsPerDay: 3, imageBytes: 5_000 });
  });

  /** The point of a ceiling: asking for more is a preference, not a grant. */
  test("a user may not ask for more", () => {
    const asked = { ...ceiling, itemsPerDay: 500, imageBytes: 999_999, perUserBytes: null };
    const result = narrowest(ceiling, asked);
    expect(result.itemsPerDay).toBe(10);
    expect(result.imageBytes).toBe(10_000);
    // A user who declines a quota does not thereby escape the server's.
    expect(result.perUserBytes).toBe(1_000_000);
  });

  test("a server with no quota takes the user's, if they set one", () => {
    const open = { ...ceiling, perUserBytes: null };
    expect(narrowest(open, { ...ceiling, perUserBytes: 500 }).perUserBytes).toBe(500);
    expect(narrowest(open, { ...ceiling, perUserBytes: null }).perUserBytes).toBeNull();
  });
});

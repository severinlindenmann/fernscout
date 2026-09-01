import { describe, expect, test } from "vitest";
import { isIndexable, isOpenToLink } from "@/lib/access";
import type { Trip } from "@/lib/types";

/**
 * private / public / guest, and the two words they replaced.
 *
 * The older pair were answering a different question. `password` said *how*
 * somebody gets in — a question the software no longer asks anybody, since
 * B39 removed trip passwords; `unlisted` said the trip is not advertised. Who is let in
 * and whether it is advertised are separate axes, and conflating them is how
 * "unlisted" stopped meaning anything. Both still parse — see
 * test/visibility.test.ts, which reads real fixture files — and this pins what
 * the three words mean once parsed.
 */

function trip(over: Partial<Trip> = {}): Trip {
  return {
    id: "t", username: "u", ref: "u/t", rates: {}, title: "T",
    start: "2026-01-01", end: "2026-01-05", status: "past",
    people: [], accent: "sky", intro: "",
    visibility: "public", listed: true, costsVisibility: "public",
    ...over,
  } as Trip;
}

describe("who a trip is for", () => {
  test("public opens to a bare link; private and guest do not", () => {
    expect(isOpenToLink(trip({ visibility: "public" }))).toBe(true);
    expect(isOpenToLink(trip({ visibility: "guest" }))).toBe(false);
    expect(isOpenToLink(trip({ visibility: "private" }))).toBe(false);
  });

  test("only a public *and* listed trip is advertised", () => {
    expect(isIndexable(trip({ visibility: "public", listed: true }))).toBe(true);
    expect(isIndexable(trip({ visibility: "public", listed: false }))).toBe(false);
    expect(isIndexable(trip({ visibility: "guest", listed: true }))).toBe(false);
    expect(isIndexable(trip({ visibility: "private", listed: true }))).toBe(false);
  });

  /**
   * `isRestricted` — "everything that is not public" — went with the passwords
   * (B39). It only ever gated the cookie check, and as a name it invited the
   * mistake the gate must not make: `guest` and `private` are *not* the same
   * closed, and one call that answers for both is how they get conflated.
   * `isOpenToLink` above is the negative that survived, and `mayReadTrip` asks
   * about the two closed values separately.
   */
  test("guest and private are not one closed", () => {
    expect(isOpenToLink(trip({ visibility: "guest" }))).toBe(false);
    expect(isOpenToLink(trip({ visibility: "private" }))).toBe(false);
  });
});

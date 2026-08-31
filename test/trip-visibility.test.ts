import { describe, expect, test } from "vitest";
import { isIndexable, isOpenToLink, isRestricted } from "@/lib/access";
import type { Trip } from "@/lib/types";

/**
 * private / public / guest, and the two words they replaced.
 *
 * The older pair were answering a different question. `password` said *how*
 * somebody gets in; `unlisted` said the trip is not advertised. Who is let in
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

  test("everything that is not public has a gate", () => {
    expect(isRestricted(trip({ visibility: "public" }))).toBe(false);
    expect(isRestricted(trip({ visibility: "guest" }))).toBe(true);
    expect(isRestricted(trip({ visibility: "private" }))).toBe(true);
  });
});

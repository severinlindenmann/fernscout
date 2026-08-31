import { describe, expect, test } from "vitest";
import type { Trip } from "@/lib/types";

/**
 * What the access panel is allowed to say.
 *
 * `resolveViewer` reads a session and a database, so the reasoning it does —
 * *which* trips, and *why* each one — is extracted here and tested on its own.
 * The property that matters is that the panel never widens access: it reports
 * what `mayReadTrip` would already allow, and being told about a trip you
 * cannot open is the same leak as showing it in a list.
 */

function trip(over: Partial<Trip>): Trip {
  return {
    id: "t", username: "alex", ref: "alex/t", rates: {}, title: "T",
    start: "2026-01-01", end: "2026-01-05", status: "past", people: [],
    accent: "sky", intro: "", visibility: "public", listed: true,
    costsVisibility: "public", ...over,
  } as Trip;
}

/** Mirrors the decision in lib/viewer.ts, which is what the panel renders. */
function through(
  t: Trip,
  opts: { owner: boolean; email: string | null; guest: boolean; granted?: Set<string> },
): "public" | "traveller" | "guest" | null {
  const onIt =
    opts.owner ||
    (opts.email !== null && t.people.some((p) => p.email === opts.email));
  if (onIt) return "traveller";
  if (t.visibility === "public" && t.listed) return "public";
  if (t.visibility === "guest" && (opts.guest || opts.granted?.has(t.id))) return "guest";
  return null;
}

const stranger = { owner: false, email: null, guest: false };
const robin = { owner: false, email: "robin@e.com", guest: false };
const withRobin = { people: [{ name: "Robin", email: "robin@e.com" }] };

describe("which trips a reader is told about", () => {
  test("a public, listed trip is shown to anyone", () => {
    expect(through(trip({}), stranger)).toBe("public");
  });

  /** The old `unlisted`: reachable by link, never advertised — including
   * here, because a list of them is exactly what "unlisted" excludes. */
  test("a public but unlisted trip is not advertised, even to a guest", () => {
    expect(through(trip({ listed: false }), stranger)).toBeNull();
    expect(through(trip({ listed: false }), { ...robin, guest: true })).toBeNull();
  });

  test("a private trip is shown only to the people who took it", () => {
    const t = trip({ visibility: "private", listed: false, ...withRobin });
    expect(through(t, stranger)).toBeNull();
    expect(through(t, { owner: false, email: "kim@e.com", guest: true })).toBeNull();
    expect(through(t, robin)).toBe("traveller");
  });

  test("a guest trip needs an invitation, or having been there", () => {
    const t = trip({ visibility: "guest", listed: false, ...withRobin });
    expect(through(t, stranger)).toBeNull();
    expect(through(t, { owner: false, email: "kim@e.com", guest: true })).toBe("guest");
    expect(through(t, robin)).toBe("traveller");
  });

  test("a grant to one trip does not name another", () => {
    const granted = new Set(["other-trip"]);
    expect(through(trip({ visibility: "guest", listed: false }), { ...stranger, granted }))
      .toBeNull();
  });

  test("the owner is told about all of them, as a traveller", () => {
    const owner = { owner: true, email: "alex@e.com", guest: false };
    expect(through(trip({ visibility: "private", listed: false }), owner)).toBe("traveller");
    expect(through(trip({ visibility: "guest", listed: false }), owner)).toBe("traveller");
    expect(through(trip({ listed: false }), owner)).toBe("traveller");
  });

  /** Being on the trip is the better answer when both are true. */
  test("having been there beats having been invited", () => {
    const t = trip({ visibility: "guest", listed: false, ...withRobin });
    expect(through(t, { ...robin, guest: true })).toBe("traveller");
  });
});

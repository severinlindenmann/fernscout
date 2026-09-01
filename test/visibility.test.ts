import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { isIndexable } from "@/lib/access";
import { getTrip, getTrips } from "@/lib/trips";

/** A fixture set of its own: adding trips to the shared one would move the
 * goalposts for every other trips test. */
const FIXTURES = path.join(process.cwd(), "test", "fixtures", "visibility");

beforeEach(() => {
  process.env.CONTENT_DIR = FIXTURES;
});
afterEach(() => {
  delete process.env.CONTENT_DIR;
});

describe("visibility parsing", () => {
  test("defaults to public when not declared", () => {
    expect(getTrip("u/open-2021")?.visibility).toBe("public");
    expect(getTrip("u/open-2021")?.costsVisibility).toBe("public");
  });

  /**
   * The two older words still parse — nobody's trip.md has to change — but
   * they were answering a different question and are mapped onto the one the
   * three new words answer. `password` said *how* a guest proves it, which is
   * no longer a question anybody is asked (B39), so it reads as `guest`;
   * `unlisted` is a public trip that is simply not advertised.
   */
  test("the older words map onto the axis that replaced them", () => {
    expect(getTrip("u/delta-2025")?.visibility).toBe("guest");
    expect(getTrip("u/delta-2025")?.listed).toBe(false);
    expect(getTrip("u/delta-2025")?.costsVisibility).toBe("guests");

    expect(getTrip("u/epsilon-2024")?.visibility).toBe("public");
    expect(getTrip("u/epsilon-2024")?.listed).toBe(false);
  });

  test("a public trip with nothing declared is listed", () => {
    expect(getTrip("u/open-2021")?.listed).toBe(true);
  });

  /**
   * The line no longer parses into anything the software honours, and that is
   * exactly why it must not be ignored quietly: an owner who left it there
   * believes the trip is still locked by it. The parser reports it, and
   * `instrumentation.ts` refuses to boot on it.
   */
  test("a leftover passwordHash: is reported as a field nothing consumes", () => {
    expect(getTrip("u/delta-2025")).not.toHaveProperty("passwordHash");
    expect(getTrip("u/delta-2025")?.unknownFields).toContain("passwordHash");
    expect(getTrip("u/open-2021")?.unknownFields).toBeUndefined();
  });

  /** The important one: a typo must never publish a private trip. */
  test("an unrecognised visibility falls back to the most restrictive reading", () => {
    expect(getTrip("u/zeta-2022")?.visibility).toBe("private");
    expect(getTrip("u/zeta-2022")?.listed).toBe(false);
    expect(getTrip("u/zeta-2022")?.costsVisibility).toBe("guests");
  });
});

describe("the enumeration surfaces", () => {
  const restricted = ["delta-2025", "epsilon-2024", "zeta-2022"];

  test("every restricted trip is excluded from anything indexable", () => {
    const indexable = getTrips("u").filter(isIndexable).map((t) => t.id);
    for (const id of restricted) expect(indexable).not.toContain(id);
  });

  test("public trips are still indexable", () => {
    const indexable = getTrips("u").filter(isIndexable).map((t) => t.id);
    expect(indexable).toContain("open-2021");
  });

  test("getTrips still returns restricted trips for server-side use", () => {
    // They must exist — the gate needs them in order to refuse them by name.
    // What matters is that every *listing* surface filters, which is what the
    // isIndexable check above covers.
    const all = getTrips("u").map((t) => t.id);
    for (const id of restricted) expect(all).toContain(id);
  });
});

describe("what the trip gate covers", () => {
  /**
   * A closed *current trip* must not take the rest of a journal
   * with it. The gate used to live in the user layout, which hid that person's
   * other trips, their search page, and the invite and contact pages a reader
   * needs in order to ask for access at all — so the only route to access was
   * behind the thing you needed access for.
   *
   * The gate now lives in the (trip) route group. This test pins the file
   * layout, because the blast radius is decided by where the layout sits and
   * nothing else would notice it moving.
   */
  test("the gate is in the (trip) group, not the user layout", () => {
    const app = path.join(process.cwd(), "app", "[user]");
    expect(fs.existsSync(path.join(app, "(trip)", "layout.tsx"))).toBe(true);

    const gateLayout = fs.readFileSync(path.join(app, "(trip)", "layout.tsx"), "utf8");
    expect(gateLayout).toContain("TripGate");

    const userLayout = fs.readFileSync(path.join(app, "layout.tsx"), "utf8");
    expect(userLayout).not.toContain("TripGate");
  });

  test("only the trip's own pages sit inside the gate", () => {
    const group = path.join(process.cwd(), "app", "[user]", "(trip)");
    const gated = fs.readdirSync(group).sort();
    expect(gated).toEqual(["costs", "day", "gallery", "layout.tsx", "map", "page.tsx"]);

    // These must stay outside it, or a private trip hides them too.
    const user = path.join(process.cwd(), "app", "[user]");
    for (const outside of ["trips", "search", "contacts", "media"]) {
      expect(fs.existsSync(path.join(user, outside))).toBe(true);
    }
  });
});

/**
 * The boot refusal, which is the other half of `unknownFields` above.
 *
 * B39 removed trip passwords, and the check that used to run here was the
 * mirror image of this one — it failed the boot when a `guest` trip had *no*
 * hash. (It never actually fired: it filtered to trips that had a hash and
 * then looked for ones that did not.) Inverting it matters because the removal
 * **widens** access on exactly the trips that were most deliberately closed: a
 * trip that was `guest` plus a password is now open to every guest of the
 * journal, which may be more people than the password ever reached. Nothing in
 * the file says so, so the server refuses to start until somebody has looked.
 */
describe("a leftover trip password stops the boot", () => {
  test("refuses, and names the trip and the widening", async () => {
    const { assertNoTripPasswords } = await import("@/instrumentation");
    const stale = getTrip("u/delta-2025")!;

    expect(() => assertNoTripPasswords([stale])).toThrow(/delta-2025/);
    expect(() => assertNoTripPasswords([stale])).toThrow(/visibility/);
    expect(() => assertNoTripPasswords(getTrips("u").filter((t) => t.id !== "delta-2025"))).not.toThrow();
  });

  test("says nothing about a trip with clean frontmatter", async () => {
    const { assertNoTripPasswords } = await import("@/instrumentation");
    expect(() => assertNoTripPasswords([getTrip("u/open-2021")!])).not.toThrow();
  });
});

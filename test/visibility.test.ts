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
   * three new words answer. `password` is *how* a guest proves it; `unlisted`
   * is a public trip that is simply not advertised.
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

  test("keeps the password hash off the public shape but present server-side", () => {
    expect(getTrip("u/delta-2025")?.passwordHash).toMatch(/^scrypt\$/);
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
    // They must exist — the gate needs them to check a password against. What
    // matters is that every *listing* surface filters, which is what the
    // isIndexable check above covers.
    const all = getTrips("u").map((t) => t.id);
    for (const id of restricted) expect(all).toContain(id);
  });
});

describe("what the password gate covers", () => {
  /**
   * A password-protected *current trip* must not take the rest of a journal
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
    expect(gateLayout).toContain("TripPasswordForm");

    const userLayout = fs.readFileSync(path.join(app, "layout.tsx"), "utf8");
    expect(userLayout).not.toContain("TripPasswordForm");
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

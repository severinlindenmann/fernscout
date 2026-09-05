import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
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

/**
 * `listed:` — the key that was documented in `AGENTS.md`, offered by the
 * `add-a-trip` skill, accepted by `POST /api/v1/<user>/trips` and written into
 * every trip.md `createTrip` produced, and read by nothing at all. B51.
 *
 * It reads now, in one direction. The whole of the design is that it can take
 * advertising away and can never grant it, so the value on a `Trip` is never
 * wider than `visibility:` alone would have made it and the three consumers —
 * `isIndexable`, `listableTrips`, `resolveViewer` — cannot be widened by a
 * frontmatter key. And it is never about *access*: nothing here changes who
 * `mayReadTrip` lets in.
 */
describe("the listed: key", () => {
  test("listed: false on a public trip is the old unlisted, exactly", () => {
    const written = getTrip("u/eta-2023")!;
    const legacy = getTrip("u/epsilon-2024")!;

    expect(written.visibility).toBe("public");
    expect(written.listed).toBe(false);
    // The acceptance line: the two spellings are one behaviour, not two.
    expect([written.visibility, written.listed]).toEqual([legacy.visibility, legacy.listed]);
    expect(isIndexable(written)).toBe(isIndexable(legacy));
    expect(isIndexable(written)).toBe(false);
  });

  test("listed: true is honoured where the visibility already advertises the trip", () => {
    expect(getTrip("u/mu-2023")?.listed).toBe(true);
    expect(isIndexable(getTrip("u/mu-2023")!)).toBe(true);
  });

  /**
   * The direction that must not work. A trip closed by `visibility:` stays
   * unadvertised however loudly the file asks, so the key cannot be used to
   * put a private trip's title in a sitemap or a switcher — and it is not the
   * gate either, which is the sentence to keep: `listed` never widens access,
   * because nothing consults it to decide who may read.
   */
  test("listed: true cannot advertise a trip its visibility does not", () => {
    for (const id of ["theta-2023", "iota-2023", "kappa-2023"]) {
      const trip = getTrip(`u/${id}`)!;
      expect(trip.listed, `${id} is advertised`).toBe(false);
      expect(isIndexable(trip), `${id} is indexable`).toBe(false);
    }
    // And the visibility itself is untouched by the key: it decides access,
    // and `listed:` has no say in it.
    expect(getTrip("u/theta-2023")?.visibility).toBe("private");
    expect(getTrip("u/iota-2023")?.visibility).toBe("guest");
    expect(getTrip("u/kappa-2023")?.visibility).toBe("public");
  });

  /**
   * `listed: "no"` is a string, because YAML 1.2 does not read `no` as false.
   * Anything that is not a boolean falls back to what `visibility:` said —
   * which here is "advertised" — rather than being coerced, since coercing a
   * truthy string is how a trip somebody tried to hide ends up in the sitemap.
   */
  test("a listed: that is not a boolean is refused, not coerced", () => {
    expect(getTrip("u/lambda-2023")?.listed).toBe(true);
  });

  test("listed: is a known field, so it is never reported as one nothing consumes", () => {
    for (const id of ["eta-2023", "theta-2023", "lambda-2023"]) {
      expect(getTrip(`u/${id}`)?.unknownFields, id).toBeUndefined();
    }
  });

  /**
   * Refused *out loud*. A key silently dropped is what this task was: the
   * author's belief about their own trip and the software's reading of it came
   * apart, and nothing said so.
   */
  test("refusing a listed: says which trip and why", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-listed-"));
    fs.writeFileSync(
      path.join(dir, "config.json"),
      JSON.stringify({ siteName: "T", url: "http://localhost:3000", defaultUser: "u" }),
    );
    fs.mkdirSync(path.join(dir, "u", "trips", "nu-2023", "entries"), { recursive: true });
    fs.writeFileSync(path.join(dir, "u", "config.json"), JSON.stringify({ title: "T" }));
    fs.writeFileSync(
      path.join(dir, "u", "trips", "nu-2023", "trip.md"),
      ['---', 'id: nu-2023', 'title: "Nu"', 'start: "2023-01-01"', 'end: "2023-01-02"',
        "visibility: private", "listed: true", "---", "", "Intro.", ""].join("\n"),
    );

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      process.env.CONTENT_DIR = dir;
      expect(getTrip("u/nu-2023")?.listed).toBe(false);
      const said = warn.mock.calls.map((c) => String(c[0])).join("\n");
      expect(said).toContain("nu-2023");
      expect(said).toContain("listed: true");
      expect(said).toContain("can only narrow");
    } finally {
      warn.mockRestore();
      process.env.CONTENT_DIR = FIXTURES;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the enumeration surfaces", () => {
  const restricted = [
    "delta-2025",
    "epsilon-2024",
    "zeta-2022",
    // Written with the key rather than the older word — same answer.
    "eta-2023",
    "theta-2023",
    "iota-2023",
    "kappa-2023",
  ];

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
    // "photobook" joined this list deliberately (Task 10): the current-trip
    // photobook page lives at app/[user]/(trip)/photobook, and a trip's own
    // photobook is exactly the kind of trip's-own-page this gate is for — a
    // private trip must hide it same as its gallery. The trip-scoped
    // equivalent, app/[user]/trips/[trip]/photobook, is a different route
    // outside this group and gates itself via mayReadTrip.
    expect(gated).toEqual(["costs", "day", "gallery", "layout.tsx", "map", "page.tsx", "photobook"]);

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

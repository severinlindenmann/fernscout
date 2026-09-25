import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Trip } from "@/lib/types";

/**
 * `tripWriteVerdict` — the decision B98 added, in isolation.
 *
 * The end-to-end proof that revocation stops a write is in
 * `test/write-revocation.test.ts`. What is asserted here is the shape of the
 * answer, and one thing that would otherwise go unnoticed until it showed up
 * as latency: **the owner's own write costs no database query.**
 *
 * `write:content` is on the commonest path in the system and an owner cannot
 * revoke themselves, so there is nothing to look up. The database module is
 * mocked rather than merely absent, so "did not ask" is asserted directly
 * instead of inferred from a result that could have come from either branch.
 */

const db = vi.hoisted(() => ({ calls: 0 }));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...actual,
    getDatabaseOrNull: async () => {
      db.calls += 1;
      return null;
    },
  };
});

vi.mock("@/lib/users", () => ({
  getUser: (username: string) =>
    username === "ana"
      ? { owner: { email: "ana@example.test" } }
      : null,
}));

function trip(id: string, people: string[] = []): Trip {
  return {
    id,
    username: "ana",
    ref: `ana/${id}`,
    title: id,
    people: people.map((email) => ({ name: "P", email })),
  } as unknown as Trip;
}

beforeEach(() => {
  db.calls = 0;
});

describe("the journal's owner", () => {
  test("is allowed, and nothing is looked up", async () => {
    const { tripWriteVerdict } = await import("@/lib/tripPeople");
    expect(await tripWriteVerdict("write:content", "ana@example.test", trip("japan-2027"))).toBe(
      "allowed",
    );
    expect(db.calls).toBe(0);
  });
});

describe("a trip-scoped token", () => {
  test("naming another trip is out_of_scope, and is not told the trip exists", async () => {
    const { tripWriteVerdict } = await import("@/lib/tripPeople");
    // Refused on the scope alone, before anything is asked about the person:
    // "not your trip" has to be indistinguishable from "no such trip", or a
    // scoped token could enumerate a journal by guessing ids.
    expect(
      await tripWriteVerdict("write:trip:bus-2026", "robin@example.test", trip("secret-2026")),
    ).toBe("out_of_scope");
    expect(db.calls).toBe(0);
  });

  test("is allowed while the name is in people:", async () => {
    const { tripWriteVerdict } = await import("@/lib/tripPeople");
    expect(
      await tripWriteVerdict(
        "write:trip:bus-2026",
        "robin@example.test",
        trip("bus-2026", ["robin@example.test"]),
      ),
    ).toBe("allowed");
  });

  test("is revoked once the name is gone, even though the scope still names the trip", async () => {
    const { tripWriteVerdict } = await import("@/lib/tripPeople");
    // The distinction the whole task is about: the scope string is unchanged
    // and a week old, and the answer changed anyway.
    expect(
      await tripWriteVerdict("write:trip:bus-2026", "robin@example.test", trip("bus-2026")),
    ).toBe("revoked");
  });
});

describe("a token with no scope at all", () => {
  test("is out_of_scope rather than revoked", async () => {
    const { tripWriteVerdict } = await import("@/lib/tripPeople");
    expect(await tripWriteVerdict(undefined, "robin@example.test", trip("bus-2026"))).toBe(
      "out_of_scope",
    );
    expect(await tripWriteVerdict("", "robin@example.test", trip("bus-2026"))).toBe("out_of_scope");
  });
});

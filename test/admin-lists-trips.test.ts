import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Trip } from "@/lib/types";

/**
 * B584 — the instance's admin address sees a journal's closed trips *listed*,
 * not only when it opens one.
 *
 * `mayReadTrip` has asked `isOwner` since B480, so the admin could open every
 * trip in every journal; `listableTrips` asked only `isPersonOnWith`, which
 * answers yes for the journal's own owner (`peopleNamedIn` heads every trip's
 * people with the owner's address) and no for the admin. The result on
 * fernscout.ch was an empty `/severin/trips` for the admin, with the page
 * explaining it as `listed: false` — a trip that was actually `private` and
 * openable by the person reading.
 *
 * Mocked at the two questions `listableTrips` asks about a session rather than
 * driven through a real one: what is under test is the filter's own branch,
 * and `test/access-gate.test.ts` is where the whole table is exercised for
 * real sessions.
 */

const { isOwner, isJournalGuest, resolveAccess } = vi.hoisted(() => ({
  isOwner: vi.fn(async () => false),
  isJournalGuest: vi.fn(async () => false),
  resolveAccess: vi.fn(async () => ({ email: "admin@example.test" })),
}));

vi.mock("@/lib/contacts/session", () => ({ isOwner, isJournalGuest, journalReader: vi.fn() }));
vi.mock("@/lib/auth/handshake", () => ({ resolveAccess }));
vi.mock("@/lib/tripPeople", () => ({
  isPersonOn: vi.fn(),
  // Nobody's address is in anybody's `people:` here — that is the whole case.
  isPersonOnWith: () => false,
  redeemedTripsFor: async () => new Set<string>(),
}));

function trip(id: string, visibility: string, listed = true): Trip {
  return { id, ref: `ana/${id}`, username: "ana", visibility, listed } as unknown as Trip;
}

const TRIPS = [
  trip("open-2026", "public"),
  trip("quiet-2026", "public", false),
  trip("invited-2026", "guest"),
  trip("secret-2026", "private"),
];

async function listed() {
  const { listableTrips } = await import("@/lib/tripGate");
  return (await listableTrips(TRIPS)).map((t) => t.id);
}

beforeEach(() => {
  isOwner.mockResolvedValue(false);
});
afterEach(() => {
  vi.resetModules();
});

describe("who sees a closed trip listed", () => {
  test("somebody who may open every trip in the journal sees them all listed", async () => {
    isOwner.mockResolvedValue(true);
    expect(await listed()).toEqual(["open-2026", "invited-2026", "secret-2026"]);
  });

  test("and `listed: false` still hides a public trip from them", async () => {
    isOwner.mockResolvedValue(true);
    expect(await listed()).not.toContain("quiet-2026");
  });

  test("a signed-in stranger still sees only the advertised public trip", async () => {
    expect(await listed()).toEqual(["open-2026"]);
  });
});

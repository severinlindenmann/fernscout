import { afterAll, beforeAll, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * `allTombstones()` must not conflate the two shapes B1073 is about: a whole
 * journal deleted (`.deleted/<user>.json`) and a single trip of a journal that
 * is still here (`.deleted/<user>/<trip>.json`). Misreading the second as the
 * first is exactly what prompted the ticket.
 */

let dir: string;

function stone(kind: "journal" | "trip", extra: Record<string, unknown> = {}) {
  return {
    kind,
    username: "anna",
    title: "A trip",
    deletedAt: "2026-01-02T03:04:05Z",
    requestedBy: "anna@example.test",
    held: { files: 1, bytes: 1 },
    notice: { lang: "en", title: "Gone", body: "Gone.", homeLabel: "Home", homeHref: "/" },
    ...extra,
  };
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-tombstones-"));
  process.env.CONTENT_DIR = dir;
  fs.mkdirSync(path.join(dir, ".deleted"), { recursive: true });
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("allTombstones", () => {
  test("reads a deleted journal and a deleted trip of a live journal as distinct kinds", async () => {
    fs.writeFileSync(
      path.join(dir, ".deleted", "gone.json"),
      JSON.stringify(stone("journal", { username: "gone" })),
    );
    fs.mkdirSync(path.join(dir, ".deleted", "anna"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, ".deleted", "anna", "old-trip.json"),
      JSON.stringify(stone("trip", { tripId: "old-trip" })),
    );

    const { allTombstones } = await import("@/lib/adminConsole");
    const stones = allTombstones();

    expect(stones).toHaveLength(2);
    const journal = stones.find((one) => one.kind === "journal");
    const trip = stones.find((one) => one.kind === "trip");
    expect(journal?.username).toBe("gone");
    expect(trip?.username).toBe("anna");
    expect(trip?.tripId).toBe("old-trip");
  });
});

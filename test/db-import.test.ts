import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { importJsonStores, describeImport } from "@/lib/db/importJson";
import type { DatabaseHandle } from "@/lib/db";
import { dbReactionRepo } from "@/lib/repos/reactionsDb";
import { clearTables, dialectCases, dropEverything, freshDatabase } from "./support/dialects";

/**
 * The one-shot `.data/*.json` → database import (ROADMAP B3).
 *
 * The fixture is deliberately the shape of a real file that has been through
 * the trip migration: mostly scoped keys, one left-over bare key from before
 * trips existed, and one voter who appears under both.
 */
const REACTIONS_FIXTURE = {
  "asia-2023:zurich-departure": {
    "52966e65-e591-489b-8c03-b1f6cb423504": "❤️",
    "test-voter-xyz": "🤩",
  },
  "asia-2023:bangkok-arrival": {
    "52966e65-e591-489b-8c03-b1f6cb423504": "🤩",
  },
  "algarve-2024:faro": {
    "another-voter": "😂",
  },
  // Cast before the site had trips: belongs to whichever trip was running.
  "hanoi": {
    "52966e65-e591-489b-8c03-b1f6cb423504": "❤️",
  },
};

const PUSH_FIXTURE = {
  "https://push.example/abc": {
    endpoint: "https://push.example/abc",
    keys: { p256dh: "p1", auth: "a1" },
    created: "2026-07-14",
    agent: "Firefox/142",
  },
  "https://push.example/def": {
    endpoint: "https://push.example/def",
    keys: { p256dh: "p2", auth: "a2" },
    created: "2026-08-02",
  },
};

function writeFixtures(dir: string, reactions: unknown, push: unknown) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "reactions.json"), JSON.stringify(reactions, null, 2));
  fs.writeFileSync(path.join(dir, "push-subscriptions.json"), JSON.stringify(push, null, 2));
}

describe.each(dialectCases())("importing the JSON stores into $name", ({ target }) => {
  let handle: DatabaseHandle;
  const dirs: string[] = [];

  function tempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-import-"));
    dirs.push(dir);
    return dir;
  }

  beforeEach(async () => {
    handle ??= await freshDatabase(target);
    await clearTables(handle);
  });

  afterAll(async () => {
    if (handle) {
      await dropEverything(handle);
      await handle.destroy();
    }
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  });

  test("imports every vote, including the pre-trips keys", async () => {
    const dir = tempDir();
    writeFixtures(dir, REACTIONS_FIXTURE, PUSH_FIXTURE);

    const report = await importJsonStores(handle, {
      currentTripId: "asia-2023",
      directory: dir,
    });

    expect(report.reactions).toEqual({
      found: 5,
      imported: 5,
      alreadyPresent: 0,
      unusable: 0,
    });

    const repo = dbReactionRepo(handle);
    expect(await repo.getAllCounts("asia-2023")).toEqual({
      "asia-2023:zurich-departure": { "❤️": 1, "🤩": 1 },
      "asia-2023:bangkok-arrival": { "🤩": 1 },
      // The bare `hanoi` key was attributed to the trip that was running.
      "asia-2023:hanoi": { "❤️": 1 },
    });
    expect(await repo.getAllCounts("algarve-2024")).toEqual({
      "algarve-2024:faro": { "😂": 1 },
    });
    expect(await repo.getVotesFor("52966e65-e591-489b-8c03-b1f6cb423504", "asia-2023")).toEqual({
      "asia-2023:zurich-departure": "❤️",
      "asia-2023:bangkok-arrival": "🤩",
      "asia-2023:hanoi": "❤️",
    });
  });

  test("imports push subscriptions, endpoint and keys intact", async () => {
    const dir = tempDir();
    writeFixtures(dir, {}, PUSH_FIXTURE);

    const report = await importJsonStores(handle, {
      currentTripId: "asia-2023",
      directory: dir,
    });
    expect(report.pushSubscriptions).toMatchObject({ found: 2, imported: 2 });

    const rows = await handle.db
      .selectFrom("push_subscriptions")
      .select(["endpoint", "p256dh", "auth", "user_agent", "created_at", "owner_id"])
      .orderBy("endpoint")
      .execute();
    expect(rows).toEqual([
      {
        endpoint: "https://push.example/abc",
        p256dh: "p1",
        auth: "a1",
        user_agent: "Firefox/142",
        created_at: "2026-07-14T00:00:00.000Z",
        owner_id: "owner",
      },
      {
        endpoint: "https://push.example/def",
        p256dh: "p2",
        auth: "a2",
        user_agent: null,
        created_at: "2026-08-02T00:00:00.000Z",
        owner_id: "owner",
      },
    ]);
  });

  test("running it twice imports nothing the second time", async () => {
    const dir = tempDir();
    writeFixtures(dir, REACTIONS_FIXTURE, PUSH_FIXTURE);
    const options = { currentTripId: "asia-2023", directory: dir };

    await importJsonStores(handle, options);
    const again = await importJsonStores(handle, options);

    expect(again.reactions).toEqual({
      found: 5,
      imported: 0,
      alreadyPresent: 5,
      unusable: 0,
    });
    expect(again.pushSubscriptions).toMatchObject({ imported: 0, alreadyPresent: 2 });

    const total = await handle.db
      .selectFrom("reactions")
      .select((eb) => eb.fn.countAll().as("n"))
      .executeTakeFirstOrThrow();
    expect(Number(total.n)).toBe(5);
  });

  test("a vote already changed in the database is not overwritten by the file", async () => {
    const dir = tempDir();
    writeFixtures(dir, REACTIONS_FIXTURE, {});
    const options = { currentTripId: "asia-2023", directory: dir };
    await importJsonStores(handle, options);

    const repo = dbReactionRepo(handle);
    await repo.vote("asia-2023", "zurich-departure", "test-voter-xyz", "😂");

    await importJsonStores(handle, options);
    expect(await repo.getVotesFor("test-voter-xyz", "asia-2023")).toEqual({
      "asia-2023:zurich-departure": "😂",
    });
  });

  test("a dry run writes nothing but reports what it would do", async () => {
    const dir = tempDir();
    writeFixtures(dir, REACTIONS_FIXTURE, PUSH_FIXTURE);

    const report = await importJsonStores(handle, {
      currentTripId: "asia-2023",
      directory: dir,
      dryRun: true,
    });
    expect(report.reactions.imported).toBe(5);
    expect(describeImport(report)).toContain("dry run");

    const total = await handle.db
      .selectFrom("reactions")
      .select((eb) => eb.fn.countAll().as("n"))
      .executeTakeFirstOrThrow();
    expect(Number(total.n)).toBe(0);
  });

  test("missing files are normal, not an error", async () => {
    const dir = tempDir();
    const report = await importJsonStores(handle, {
      currentTripId: "asia-2023",
      directory: dir,
    });
    expect(report.files).toEqual({ reactions: null, pushSubscriptions: null });
    expect(report.reactions.found).toBe(0);
    expect(describeImport(report)).toContain("nothing to do");
  });

  test("junk in the file is counted and skipped, not fatal", async () => {
    const dir = tempDir();
    writeFixtures(
      dir,
      {
        "asia-2023:hoi-an": { v1: "❤️", v2: "🍕" },
        "asia-2023:hue": "not an object",
      },
      { "https://push.example/x": { endpoint: "https://push.example/x" } },
    );

    const report = await importJsonStores(handle, {
      currentTripId: "asia-2023",
      directory: dir,
    });
    expect(report.reactions).toEqual({
      found: 2,
      imported: 1,
      alreadyPresent: 0,
      unusable: 2,
    });
    expect(report.pushSubscriptions).toMatchObject({ imported: 0, unusable: 1 });
    expect(describeImport(report)).toContain("unusable");
  });

  test("a corrupt file is an error the operator has to see", async () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, "reactions.json"), "{ not json");
    await expect(
      importJsonStores(handle, { currentTripId: "asia-2023", directory: dir }),
    ).rejects.toThrow(/not valid JSON/);
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import type { DatabaseHandle, DatabaseTarget } from "@/lib/db";
import { dbPushRepo } from "@/lib/repos/pushDb";
import { filePushRepo } from "@/lib/repos/pushFile";
import { dbReactionRepo } from "@/lib/repos/reactionsDb";
import { fileReactionRepo } from "@/lib/repos/reactionsFile";
import type { PushRepo, ReactionRepo } from "@/lib/repos/types";
import { clearTables, dialectCases, dropEverything, freshDatabase } from "./support/dialects";

/**
 * One behaviour suite, run against every backend.
 *
 * This is the test that makes the seam real: if the JSON file store and the
 * database disagree about what a vote means, the no-database deployment and
 * the real one are different products. Running the identical assertions
 * against all of them (file, SQLite, and Postgres when `POSTGRES_TEST_URL` is
 * set) is the only way that stays true.
 */

type Backend = {
  name: string;
  reactions(): ReactionRepo;
  push(): PushRepo;
  reset(): Promise<void>;
  teardown(): Promise<void>;
};

function fileBackend(): Backend {
  const previousDataDir = process.env.DATA_DIR;
  const dirs: string[] = [];
  return {
    name: "file store",
    reactions: fileReactionRepo,
    push: filePushRepo,
    async reset() {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-repo-"));
      dirs.push(dir);
      process.env.DATA_DIR = dir;
    },
    async teardown() {
      if (previousDataDir === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = previousDataDir;
      for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

function dbBackend(dialect: { name: string; target: DatabaseTarget }): Backend {
  let handle: DatabaseHandle | null = null;
  return {
    name: dialect.name,
    reactions: () => dbReactionRepo(handle!),
    push: () => dbPushRepo(handle!),
    async reset() {
      handle ??= await freshDatabase(dialect.target);
      await clearTables(handle);
    },
    async teardown() {
      if (!handle) return;
      await dropEverything(handle);
      await handle.destroy();
      handle = null;
    },
  };
}

const backends: Backend[] = [fileBackend(), ...dialectCases().map(dbBackend)];

// One teardown for the file, not one per `describe` — the same backend object
// serves both suites below, and tearing it down after the first would hand the
// second a closed connection.
afterAll(async () => {
  for (const backend of backends) await backend.teardown();
});

describe.each(backends)("reactions on the $name", (backend) => {
  beforeEach(() => backend.reset());

  test("an empty store has no counts", async () => {
    expect(await backend.reactions().getAllCounts("asia-2023")).toEqual({});
    expect(await backend.reactions().getVotesFor("v1", "asia-2023")).toEqual({});
  });

  test("a vote is counted and remembered", async () => {
    const repo = backend.reactions();
    expect(await repo.vote("asia-2023", "hoi-an", "v1", "❤️")).toEqual({
      counts: { "❤️": 1 },
      mine: "❤️",
    });
    expect(await repo.getAllCounts("asia-2023")).toEqual({
      "asia-2023:hoi-an": { "❤️": 1 },
    });
    expect(await repo.getVotesFor("v1", "asia-2023")).toEqual({
      "asia-2023:hoi-an": "❤️",
    });
  });

  test("voters are tallied per emoji", async () => {
    const repo = backend.reactions();
    await repo.vote("asia-2023", "hoi-an", "v1", "❤️");
    await repo.vote("asia-2023", "hoi-an", "v2", "❤️");
    await repo.vote("asia-2023", "hoi-an", "v3", "😂");
    expect(await repo.getAllCounts("asia-2023")).toEqual({
      "asia-2023:hoi-an": { "❤️": 2, "😂": 1 },
    });
  });

  test("changing your mind moves the count, it doesn't add one", async () => {
    const repo = backend.reactions();
    await repo.vote("asia-2023", "hoi-an", "v1", "❤️");
    expect(await repo.vote("asia-2023", "hoi-an", "v1", "🤩")).toEqual({
      counts: { "🤩": 1 },
      mine: "🤩",
    });
    expect(await repo.getVotesFor("v1", "asia-2023")).toEqual({
      "asia-2023:hoi-an": "🤩",
    });
  });

  test("picking the same emoji again takes it back", async () => {
    const repo = backend.reactions();
    await repo.vote("asia-2023", "hoi-an", "v1", "❤️");
    expect(await repo.vote("asia-2023", "hoi-an", "v1", "❤️")).toEqual({
      counts: {},
      mine: null,
    });
    expect(await repo.getAllCounts("asia-2023")).toEqual({});
    expect(await repo.getVotesFor("v1", "asia-2023")).toEqual({});
  });

  test("counts are scoped to one trip", async () => {
    const repo = backend.reactions();
    await repo.vote("asia-2023", "hoi-an", "v1", "❤️");
    await repo.vote("algarve-2024", "faro", "v1", "😂");
    expect(await repo.getAllCounts("asia-2023")).toEqual({
      "asia-2023:hoi-an": { "❤️": 1 },
    });
    expect(await repo.getAllCounts("algarve-2024")).toEqual({
      "algarve-2024:faro": { "😂": 1 },
    });
  });

  test("a reader's own votes span every trip — one browser, one voter id", async () => {
    const repo = backend.reactions();
    await repo.vote("asia-2023", "hoi-an", "v1", "❤️");
    await repo.vote("algarve-2024", "faro", "v1", "😂");
    expect(await repo.getVotesFor("v1", "asia-2023")).toEqual({
      "asia-2023:hoi-an": "❤️",
      "algarve-2024:faro": "😂",
    });
  });

  test("day slugs may repeat across trips without colliding", async () => {
    const repo = backend.reactions();
    await repo.vote("asia-2023", "arrival", "v1", "❤️");
    await repo.vote("algarve-2024", "arrival", "v2", "❤️");
    expect(await repo.getAllCounts("asia-2023")).toEqual({
      "asia-2023:arrival": { "❤️": 1 },
    });
  });
});

describe.each(backends)("push subscriptions on the $name", (backend) => {
  const sub = {
    username: "ana",
    endpoint: "https://push.example/abc",
    keys: { p256dh: "p", auth: "a" },
    created: "2026-08-01",
    agent: "Firefox",
  };

  beforeEach(() => backend.reset());

  test("saving then listing round-trips the subscription", async () => {
    const repo = backend.push();
    await repo.save(sub);
    expect(await repo.list("ana")).toEqual([{ ...sub, contactId: null }]);
  });

  test("re-subscribing the same browser updates rather than duplicating", async () => {
    const repo = backend.push();
    await repo.save(sub);
    await repo.save({ ...sub, created: "2026-08-30", keys: { p256dh: "p2", auth: "a2" } });
    const all = await repo.list("ana");
    expect(all).toHaveLength(1);
    expect(all[0].keys).toEqual({ p256dh: "p2", auth: "a2" });
    // First seen wins: a refreshed subscription is not a new reader.
    expect(all[0].created).toBe("2026-08-01");
  });

  test("removing one endpoint leaves the others", async () => {
    const repo = backend.push();
    await repo.save(sub);
    await repo.save({ ...sub, endpoint: "https://push.example/def" });
    await repo.remove("ana", [sub.endpoint]);
    expect((await repo.list("ana")).map((s) => s.endpoint)).toEqual([
      "https://push.example/def",
    ]);
  });

  test("removing several at once is one call", async () => {
    const repo = backend.push();
    await repo.save(sub);
    await repo.save({ ...sub, endpoint: "https://push.example/def" });
    await repo.remove("ana", [sub.endpoint, "https://push.example/def"]);
    expect(await repo.list("ana")).toEqual([]);
  });

  test("removing nothing is not an error", async () => {
    await expect(backend.push().remove("ana", [])).resolves.toBeUndefined();
  });

  test("subscriptions are scoped to one journal — a deployment can serve several", async () => {
    const repo = backend.push();
    await repo.save(sub);
    await repo.save({ ...sub, username: "other" });
    expect((await repo.list("ana")).map((s) => s.username)).toEqual(["ana"]);
    expect((await repo.list("other")).map((s) => s.username)).toEqual(["other"]);
  });

  test("the same endpoint subscribing to two journals stays two rows", async () => {
    const repo = backend.push();
    await repo.save(sub);
    await repo.save({ ...sub, username: "other" });
    // Removing it for one journal must not touch the other's row for the
    // same endpoint — otherwise one reader could un-notify a stranger.
    await repo.remove("ana", [sub.endpoint]);
    expect(await repo.list("ana")).toEqual([]);
    expect((await repo.list("other")).map((s) => s.endpoint)).toEqual([sub.endpoint]);
  });
});

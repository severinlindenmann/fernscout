import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { closeDatabase, getDatabase, isDatabaseConfigured } from "@/lib/db";
import { getAllCounts, vote } from "@/lib/reactions";
import { listSubscriptions, saveSubscription } from "@/lib/push";

/**
 * Which backend the application actually gets.
 *
 * The two acceptance criteria this file exists for: the app runs with no
 * database at all, and when there is one, nothing above `lib/repos` has to be
 * told about it.
 */

const env = { ...process.env };
const dirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-select-"));
  dirs.push(dir);
  process.env.DATA_DIR = dir;
  return dir;
}

afterEach(async () => {
  await closeDatabase();
  process.env = { ...env };
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("with no DATABASE_URL", () => {
  test("there is no database, and that is not an error", () => {
    delete process.env.DATABASE_URL;
    expect(isDatabaseConfigured()).toBe(false);
  });

  test("reactions still work, on the JSON file store", async () => {
    const dir = tempDir();
    delete process.env.DATABASE_URL;

    await vote("asia-2023", "hoi-an", "v1", "❤️");
    expect(await getAllCounts("asia-2023")).toEqual({
      "asia-2023:hoi-an": { "❤️": 1 },
    });
    expect(fs.existsSync(path.join(dir, "reactions.json"))).toBe(true);
  });

  test("push subscriptions still work, on the JSON file store", async () => {
    const dir = tempDir();
    delete process.env.DATABASE_URL;

    await saveSubscription({
      username: "ana",
      endpoint: "https://push.example/abc",
      keys: { p256dh: "p", auth: "a" },
      created: "2026-08-01",
    });
    expect(await listSubscriptions("ana")).toHaveLength(1);
    expect(fs.existsSync(path.join(dir, "push-subscriptions.json"))).toBe(true);
  });
});

describe("with a sqlite DATABASE_URL", () => {
  test("the same calls go to the database and leave no JSON behind", async () => {
    const dir = tempDir();
    process.env.DATABASE_URL = `sqlite:${path.join(dir, "fernscout.db")}`;

    await vote("asia-2023", "hoi-an", "v1", "❤️");
    expect(await getAllCounts("asia-2023")).toEqual({
      "asia-2023:hoi-an": { "❤️": 1 },
    });

    expect(fs.existsSync(path.join(dir, "fernscout.db"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "reactions.json"))).toBe(false);
  });

  test("a bare `sqlite:` puts the file in DATA_DIR", async () => {
    const dir = tempDir();
    process.env.DATABASE_URL = "sqlite:";

    const handle = await getDatabase();
    expect(handle.dialect).toBe("sqlite");
    expect(fs.existsSync(path.join(dir, "fernscout.db"))).toBe(true);
  });

  test("the connection is opened once and migrated once", async () => {
    tempDir();
    process.env.DATABASE_URL = "sqlite:";
    const first = await getDatabase();
    const second = await getDatabase();
    expect(second).toBe(first);
  });

  test("pointing DATABASE_URL somewhere else does not hand back the old handle", async () => {
    const dir = tempDir();
    process.env.DATABASE_URL = `sqlite:${path.join(dir, "one.db")}`;
    const first = await getDatabase();

    process.env.DATABASE_URL = `sqlite:${path.join(dir, "two.db")}`;
    const second = await getDatabase();
    expect(second).not.toBe(first);
    expect(fs.existsSync(path.join(dir, "two.db"))).toBe(true);
  });

  test("the tables are migrated in before the first read", async () => {
    tempDir();
    process.env.DATABASE_URL = "sqlite:";
    // No explicit migrate call anywhere in this test.
    expect(await getAllCounts("asia-2023")).toEqual({});
  });
});

describe("with an unusable DATABASE_URL", () => {
  test("it reports as unconfigured rather than crashing a request", () => {
    process.env.DATABASE_URL = "mysql://localhost/x";
    expect(isDatabaseConfigured()).toBe(false);
  });

  test("but opening it throws, so it can never be silently ignored", async () => {
    process.env.DATABASE_URL = "mysql://localhost/x";
    await expect(getDatabase()).rejects.toThrow();
  });
});

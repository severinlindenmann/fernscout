import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { forget, history, liveSession, remember, sessionId } from "@/lib/helper/thread";

/**
 * B1054 — the live conversation outlives the process, because a second door
 * (WhatsApp, and a browser reopened after a restart) needs exactly that.
 *
 * The acceptance line, verified directly: "a conversation reopened … after a
 * server restart continues … without a live model." A restart is simulated
 * the only honest way available in a test — dropping the in-memory cache
 * `globalThis` holds — while the database, which is what actually survives
 * a restart, is left alone.
 */

let dir: string;

/** Simulate a process restart: the cache is gone, the database is not. */
function restart(): void {
  delete (globalThis as { __fsHelperThreads?: unknown }).__fsHelperThreads;
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-thread-durable-"));
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  forget("alex");
  restart();
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await closeDatabase();
  forget("alex");
  restart();
  delete process.env.DATABASE_URL;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("a thread survives losing the process", () => {
  test("the same session id and turns come back after a restart", async () => {
    remember("alex", "wie heisst meine reise", "Die Reise heisst Die Reise.");
    const before = await sessionId("alex");
    // The write is fire-and-forget — give it a tick to land before the
    // "restart" reads it back.
    await new Promise((resolve) => setTimeout(resolve, 20));

    restart();

    expect(await sessionId("alex")).toBe(before);
    expect(await history("alex")).toEqual([
      { role: "user", text: "wie heisst meine reise", origin: "web" },
      { role: "assistant", text: "Die Reise heisst Die Reise.", origin: "web" },
    ]);
    expect(await liveSession("alex")).toBe(before);
  });

  test("a different journal's thread is untouched", async () => {
    remember("alex", "said", "answered");
    await new Promise((resolve) => setTimeout(resolve, 20));
    restart();
    expect(await history("somebody-else")).toEqual([]);
    expect(await liveSession("somebody-else")).toBeNull();
  });

  test("forget removes the durable copy too, not only the cache", async () => {
    remember("alex", "said", "answered");
    await new Promise((resolve) => setTimeout(resolve, 20));
    forget("alex");
    await new Promise((resolve) => setTimeout(resolve, 20));
    restart();
    expect(await liveSession("alex")).toBeNull();
  });
});

describe("the TTL is per channel", () => {
  test("a WhatsApp turn keeps the thread live well past the web room's own window", async () => {
    remember("alex", "erzähl mir vom tag", "Klar, wie war er?", "whatsapp");
    await new Promise((resolve) => setTimeout(resolve, 20));
    restart();
    // 5 hours: past the web room's 4-hour window, inside WhatsApp's 24.
    const fiveHoursAgo = Date.now() - 5 * 60 * 60 * 1000;
    const { db } = (await getDatabase())!;
    await db
      .updateTable("helper_threads")
      .set({ touched_at: new Date(fiveHoursAgo).toISOString() })
      .where("owner_id", "=", "alex")
      .execute();

    expect(await liveSession("alex")).not.toBeNull();
  });
});

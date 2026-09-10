import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { forget, history, note, remember, sessionId } from "@/lib/helper/thread";

/**
 * B1243 — a pressed write's note must survive reopening the same
 * conversation on a cold cache.
 *
 * `adopt()` (B1168) is a no-op when the session being reopened is already
 * the warm in-memory thread — the ordinary case on a single long-running
 * process. But the turns it is *handed* to reconstruct from, when it is not
 * a no-op, come from `helper_sessions` (`turnsIn`), which never carries a
 * note (`proposed()`/`wrote()` write only to `helper_threads`). A cold
 * cache — the first request on a fresh process, a worker that has not
 * touched this journal yet, a restart between a press and the next look at
 * `/agent` — used to rebuild the thread from that note-free log even when
 * the durable row (`helper_threads`) still held the session in full,
 * silently dropping the very fact a pressed write exists to record.
 */

let dir: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-thread-adopt-"));
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  forget("adopt-notes-journal");
  await closeDatabase();
  delete process.env.DATABASE_URL;
  fs.rmSync(dir, { recursive: true, force: true });
});

const USER = "adopt-notes-journal";

describe("reopening the live WhatsApp conversation on a cold cache", () => {
  test("keeps the written note the analytics log never carried", async () => {
    remember(USER, "put the photo on the first day", "Putting the photo onto the day.", "whatsapp");
    note(USER, '[written: attach_files {"trip":"japan-2027","slug":"2027-03-01","attached":1,"skipped":0}]', "whatsapp");
    const id = await sessionId(USER, "whatsapp");
    const before = await history(USER);
    expect(before.some((turn) => turn.role === "note" && turn.text.includes("written: attach_files"))).toBe(true);

    // `persist()` is fire-and-forget — give it a tick to land before the
    // cache is cleared, the same as a real process would have by the time a
    // second request arrives.
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Simulate a cold cache: the in-memory copy is gone (a fresh process, or
    // a worker that never touched this journal), but the durable row — the
    // one this same press wrote through to — is still on disk.
    const anchor = globalThis as { __fsHelperThreads?: Map<string, unknown> };
    anchor.__fsHelperThreads?.delete(USER);

    // What the /agent page hands `adopt()` when it reopens `?c=<id>`: the
    // `helper_sessions` reconstruction, said/answered only, no notes.
    await import("@/lib/helper/thread").then(({ adopt }) =>
      adopt(USER, id, [{ said: "put the photo on the first day", answered: "Putting the photo onto the day.", origin: "whatsapp" }]),
    );

    const after = await history(USER);
    expect(after.some((turn) => turn.role === "note" && turn.text.includes("written: attach_files"))).toBe(true);
  });
});

import { afterEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { dropEverything, postgresConfigured } from "./support/dialects";
import {
  clearIdempotencyStore,
  fingerprintOf,
  idempotencyKey,
  recall,
  remember,
} from "@/lib/idempotency";

/**
 * B718 — a metered write replayed after a restart must not be charged twice.
 *
 * `clearIdempotencyStore()` is the restart: it empties the per-process `Map`
 * and touches nothing else, which is exactly what a new Node process starts
 * with. A `recall` that still answers `"replay"` afterwards is answering out
 * of the database, and the caller returns the first answer without spending a
 * second credit or calling the model again. The old in-memory-only store fails
 * every assertion below that follows a `clearIdempotencyStore()`.
 *
 * **Both dialects, because SQLite would never have told us.**
 * `idempotencyKey` joins with a NUL byte (B297), `better-sqlite3` stores one in
 * a text column happily, and Postgres refuses the statement outright — a
 * refusal `record`'s deliberate `catch` would have swallowed, leaving the
 * durable half silently doing nothing on the one dialect production runs.
 * `rowIdFor` hashes instead. The Postgres leg runs in CI; on a laptop see
 * POSTGRES_HOWTO in test/support/dialects.ts.
 */
let dir: string;

async function open(url?: string): Promise<void> {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-idem-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = url ?? `sqlite:${path.join(dir, "idem.db")}`;
  const handle = await getDatabase();
  if (url) {
    // Postgres test databases are reused between runs.
    await dropEverything(handle);
    await migrateToLatest(handle);
  }
  clearIdempotencyStore();
}

afterEach(async () => {
  await closeDatabase();
  clearIdempotencyStore();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  fs.rmSync(dir, { recursive: true, force: true });
});

const key = idempotencyKey("alice", "helper.write-day", "abc");
const args = { notes: "we walked to the harbour", facts: { date: "2026-09-08" } };

describe("the idempotency store, with a database", () => {
  test("a replay after a restart returns the first answer", async () => {
    await open();
    const answer = { ok: true, title: "The harbour", spent: 1 };
    await remember(key, fingerprintOf(args), answer);

    clearIdempotencyStore();

    const again = await recall<typeof answer>(key, fingerprintOf(args));
    expect(again.kind).toBe("replay");
    expect(again.kind === "replay" && again.value).toEqual(answer);
  });

  test("the same key with different arguments is still a conflict after a restart", async () => {
    await open();
    await remember(key, fingerprintOf(args), { ok: true, title: "The harbour" });

    clearIdempotencyStore();

    const other = await recall(key, fingerprintOf({ ...args, notes: "a different day" }));
    expect(other.kind).toBe("conflict");
  });

  test("an unrelated key is fresh, so a new call still does its work", async () => {
    await open();
    await remember(key, fingerprintOf(args), { ok: true });

    clearIdempotencyStore();

    const fresh = await recall(
      idempotencyKey("alice", "helper.write-day", "xyz"),
      fingerprintOf(args),
    );
    expect(fresh.kind).toBe("fresh");
  });

  test("one journal's key cannot be replayed as another's", async () => {
    await open();
    await remember(key, fingerprintOf(args), { ok: true });

    clearIdempotencyStore();

    const bob = await recall(idempotencyKey("bob", "helper.write-day", "abc"), fingerprintOf(args));
    expect(bob.kind).toBe("fresh");
  });

  test("the row names the journal, and holds a hash rather than the key", async () => {
    await open();
    await remember(key, fingerprintOf(args), { ok: true });
    const { db } = await getDatabase();
    const rows = await db.selectFrom("idempotency").select(["id", "owner_id"]).execute();
    expect(rows).toHaveLength(1);
    expect(rows[0].owner_id).toBe("alice");
    expect(rows[0].id).toMatch(/^[0-9a-f]{64}$/);
  });

  test("no key means nothing is stored and every call is fresh", async () => {
    await open();
    await remember(null, fingerprintOf(args), { ok: true });
    const { db } = await getDatabase();
    const rows = await db.selectFrom("idempotency").select(["id"]).execute();
    expect(rows).toHaveLength(0);
    expect((await recall(null, fingerprintOf(args))).kind).toBe("fresh");
  });
});

describe.runIf(postgresConfigured())("the same, on Postgres", () => {
  test("a replay after a restart returns the first answer", async () => {
    await open(process.env.POSTGRES_TEST_URL);
    const answer = { ok: true, title: "The harbour", spent: 1 };
    await remember(key, fingerprintOf(args), answer);

    clearIdempotencyStore();

    const again = await recall<typeof answer>(key, fingerprintOf(args));
    expect(again.kind).toBe("replay");
    expect(again.kind === "replay" && again.value).toEqual(answer);
  });
});

describe("the idempotency store, with no database", () => {
  test("still replays within the process, which is what it always did", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-idem-"));
    process.env.CONTENT_DIR = dir;
    delete process.env.DATABASE_URL;
    clearIdempotencyStore();

    const own = idempotencyKey("alice", "create_day", "abc");
    await remember(own, fingerprintOf({ a: 1 }), { slug: "a-day" });
    const again = await recall<{ slug: string }>(own, fingerprintOf({ a: 1 }));
    expect(again.kind).toBe("replay");
    expect(again.kind === "replay" && again.value.slug).toBe("a-day");
  });
});

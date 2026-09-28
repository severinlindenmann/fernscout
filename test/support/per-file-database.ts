import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * B2496 — CI's sqlite leg pointed every test file at one `./test.db`. A
 * file that writes to the database without pinning its own DATABASE_URL
 * (as test/push.test.ts learned to) leaves rows behind for the next file:
 * an earlier file's owner push subscription for `ana` made a reader-only
 * case in test/first-trip.test.ts push on 27 Sep, red from 13:28 to
 * 3a53711 across four merges.
 *
 * Give every file its own sqlite file instead of a shared one. Only
 * rewrites a real on-disk sqlite URL — `sqlite::memory:` is already
 * per-handle and isolated, and Postgres/unset are untouched (B2496 is not
 * doing per-file Postgres schemas). A test that sets its own DATABASE_URL
 * in beforeEach/beforeAll still wins; this only changes the value seen
 * before any test file's own code runs.
 */
const url = process.env.DATABASE_URL ?? "";
if (url.startsWith("sqlite:") && !url.includes(":memory:")) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-vitest-"));
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
}

/**
 * B2552 — Postgres: every worker gets its own database, created by
 * test/support/pg-workers.ts, so files run in parallel instead of one at a
 * time. Rewrites POSTGRES_TEST_URL, and DATABASE_URL when it is the same
 * URL (as on CI's postgres leg), from `<db>` to `<db>_w<VITEST_POOL_ID>`.
 */
const poolId = process.env.VITEST_POOL_ID;
const perWorker = (value: string): string => {
  const parsed = new URL(value);
  parsed.pathname = `${parsed.pathname}_w${poolId}`;
  return parsed.toString();
};
const pgUrl = process.env.POSTGRES_TEST_URL?.trim();
if (pgUrl && poolId) {
  process.env.POSTGRES_TEST_URL = perWorker(pgUrl);
  if (url.trim() === pgUrl) process.env.DATABASE_URL = perWorker(pgUrl);
}

/**
 * And every file starts on an empty schema, the Postgres half of B2496: a
 * worker runs many files in turn against its one database, and a file that
 * writes without cleaning up must not leave rows for whichever file that
 * worker happens to take next.
 */
if (pgUrl && poolId) {
  const { Client } = await import("pg");
  const client = new Client({ connectionString: process.env.POSTGRES_TEST_URL });
  await client.connect();
  try {
    await client.query("drop schema if exists public cascade; create schema public");
  } finally {
    await client.end();
  }
}

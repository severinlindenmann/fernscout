import os from "node:os";
import type { TestProject } from "vitest/node";

/**
 * B2552 — one Postgres database per vitest worker, so the Postgres leg can
 * run files in parallel. Every file that opts into POSTGRES_TEST_URL wipes
 * the schema on the way in; with one shared database that forced the whole
 * suite to run one file at a time (807s in CI).
 *
 * Creates `<db>_w1 … <db>_wN` next to the database POSTGRES_TEST_URL names;
 * test/support/per-file-database.ts points each worker at its own by
 * VITEST_POOL_ID (1…maxWorkers). Does nothing without POSTGRES_TEST_URL.
 */
export default async function setup(project: TestProject): Promise<void> {
  const url = process.env.POSTGRES_TEST_URL?.trim();
  if (!url) return;

  const workers = Math.max(Number(project.config.maxWorkers) || 0, os.availableParallelism());
  const base = new URL(url).pathname.slice(1);
  const { Client } = await import("pg");
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    for (let id = 1; id <= workers; id += 1) {
      try {
        await client.query(`create database "${base}_w${id}"`);
      } catch (error) {
        // 42P04: already exists, from an earlier run. Reused, like the base.
        if ((error as { code?: string }).code !== "42P04") throw error;
      }
    }
  } finally {
    await client.end();
  }
}

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Migrator } from "kysely/migration";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { clearConfigCache } from "@/lib/config";
import { closeDatabase, getDatabase, newId, nowIso } from "@/lib/db";
import { migrationProvider } from "@/lib/db/migrations";
import { migrateToLatest } from "@/lib/db/migrate";
import { dialectCases, dropEverything } from "./support/dialects";

/**
 * B987 — the migration that changed what a stored credit means, and B997 —
 * how it is run.
 *
 * The unit change is safe only if the data moves with it: a balance in
 * hundredths beside a ledger still in whole credits is a journal whose receipt
 * no longer adds up, and `auditOwner` would report a discrepancy on every
 * journal on the instance.
 *
 * **Driven through the migrator, never by calling `up()` by hand.** The first
 * version of this file did the latter, passed, and shipped a migration that
 * failed on the live Postgres the moment it ran: Kysely wraps each migration
 * in a transaction and the migration opened a second one, which the driver
 * refuses. Calling `up(db)` with a plain Kysely instance tests the SQL and
 * not the contract with the thing that runs it — and the contract was what
 * broke. So this migrates *to the migration before this one*, seeds rows in
 * whole credits, and then migrates the rest of the way.
 *
 * **And it runs on both dialects**, which is the other half of the same
 * lesson: SQLite's driver tolerated the nested transaction and Postgres did
 * not, so a SQLite-only run of this file is green against the exact migration
 * that took the deploy down. CI runs the Postgres leg
 * (`.github/workflows/ci.yml`); on a laptop see `POSTGRES_HOWTO` in
 * test/support/dialects.ts.
 */
const BEFORE = "026-helper-sessions";

let dir = "";

async function setup(dialect: string): Promise<void> {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-hundredths-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL =
    dialect === "postgres"
      ? process.env.POSTGRES_TEST_URL!
      : `sqlite:${path.join(dir, "credits.db")}`;
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "R", url: "https://example.test" } }),
  );
  clearConfigCache();

  const handle = await getDatabase();
  // Postgres test databases are reused between runs, so whatever a previous
  // file left behind would be migrated *from* rather than a clean slate.
  if (dialect === "postgres") await dropEverything(handle);
  const migrator = new Migrator({ db: handle.db, provider: migrationProvider });
  const { error } = await migrator.migrateTo(BEFORE);
  if (error) throw error;
}

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  clearConfigCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** A journal as it stood before the migration: whole credits, everywhere. */
async function seed(): Promise<void> {
  const { db } = await getDatabase();
  await db
    .insertInto("credits")
    .values([
      { owner_id: "alex", balance: 7, updated_at: nowIso() },
      { owner_id: "quinn", balance: 0, updated_at: nowIso() },
    ])
    .execute();
  await db
    .insertInto("credit_ledger")
    .values([
      {
        id: newId(),
        owner_id: "alex",
        delta: 10,
        reason: "grant",
        ref: null,
        note: null,
        created_at: nowIso(),
      },
      {
        id: newId(),
        owner_id: "alex",
        delta: -3,
        reason: "day_mail",
        ref: "alex/t/d",
        note: null,
        created_at: nowIso(),
      },
    ])
    .execute();
}

async function rows(): Promise<{ balances: number[]; deltas: number[] }> {
  const { db } = await getDatabase();
  const balances = await db.selectFrom("credits").select("balance").orderBy("owner_id").execute();
  const deltas = await db.selectFrom("credit_ledger").select("delta").orderBy("delta").execute();
  return {
    balances: balances.map((r) => Number(r.balance)),
    deltas: deltas.map((r) => Number(r.delta)),
  };
}

describe.each(dialectCases().map((c) => c.name))("027-credits-hundredths (%s)", (dialect) => {
  beforeEach(() => setup(dialect));

  test("runs through the migrator at all — B997", async () => {
    await seed();
    // The failure this exists for is not a wrong number, it is an exception:
    // "calling the transaction method for a Transaction is not supported".
    await expect(migrateToLatest(await getDatabase())).resolves.toBeDefined();
  });

  test("multiplies every balance and every ledger delta by a hundred", async () => {
    await seed();
    await migrateToLatest(await getDatabase());
    expect(await rows()).toEqual({ balances: [700, 0], deltas: [-300, 1000] });
  });

  test("the ledger still sums to the balance afterwards — the property that makes it safe", async () => {
    await seed();
    await migrateToLatest(await getDatabase());
    const { auditOwner } = await import("@/lib/credits");
    const audit = await auditOwner("alex");
    expect(audit.ok).toBe(true);
    // And it reports in credits, not in the unit it stores.
    expect(audit.balance).toBe(7);
  });

  test("an empty instance migrates too — no rows is not a special case", async () => {
    await expect(migrateToLatest(await getDatabase())).resolves.toBeDefined();
    expect(await rows()).toEqual({ balances: [], deltas: [] });
  });
});

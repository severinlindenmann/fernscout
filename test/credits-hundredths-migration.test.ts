import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { closeDatabase, getDatabase, newId, nowIso } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { clearConfigCache } from "@/lib/config";
import { up, down } from "@/lib/db/migrations/027-credits-hundredths";

/**
 * B987 — the migration that changed what a stored credit means.
 *
 * The unit change is safe only if the data moves with it: a balance in
 * hundredths beside a ledger still in whole credits is a journal whose receipt
 * no longer adds up, and `auditOwner` would start reporting a discrepancy on
 * every journal on the instance. This runs the statements against real rows
 * rather than trusting that a `* 100` in a template string is a `* 100`.
 *
 * It ran once for real, against balances people had paid for.
 */
let dir = "";

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-hundredths-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "credits.db")}`;
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "R", url: "https://example.test" } }),
  );
  clearConfigCache();
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  clearConfigCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

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

describe("027-credits-hundredths", () => {
  test("multiplies every balance and every ledger delta by a hundred", async () => {
    await seed();
    const { db } = await getDatabase();
    await up(db);
    expect(await rows()).toEqual({ balances: [700, 0], deltas: [-300, 1000] });
  });

  test("the ledger still sums to the balance afterwards — the property that makes it safe", async () => {
    await seed();
    const { db } = await getDatabase();
    await up(db);
    const { auditOwner } = await import("@/lib/credits");
    const audit = await auditOwner("alex");
    expect(audit.ok).toBe(true);
    // And it reports in credits, not in the unit it stores.
    expect(audit.balance).toBe(7);
  });

  test("down divides back, and rounds towards zero rather than inventing credits", async () => {
    await seed();
    const { db } = await getDatabase();
    await up(db);
    // A charge only possible after the migration: two hundredths.
    await db
      .updateTable("credits")
      .set({ balance: 698 })
      .where("owner_id", "=", "alex")
      .execute();
    await down(db);
    const after = await rows();
    // 6.98 credits comes back as 6, never as 7: a rollback may cost somebody
    // the fraction, and must never hand them one they did not buy.
    expect(after.balances[0]).toBe(6);
  });
});

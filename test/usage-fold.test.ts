import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase, newId, nowIso } from "@/lib/db";
import { foldUsageOlderThan, lifetimeCostRappen, recordUsage, usageSince } from "@/lib/usage";

/**
 * B2605: `usage` rows are kept forever and nothing folds the old ones into a
 * per-owner monthly total.
 *
 * Two things worth proving: a row genuinely older than the retention window
 * is folded and gone, and the one figure that is supposed to mean "ever" —
 * `lifetimeCostRappen` — reads the same number before and after that fold,
 * because it adds the two tables rather than trusting whichever one still
 * happens to hold a given row.
 */

let dir: string;

async function insertAt(createdAt: string, costRappen: number): Promise<void> {
  const { db } = (await getDatabase())!;
  await db
    .insertInto("usage")
    .values({
      id: newId(),
      owner_id: "alex",
      provider: "anthropic",
      model: "test-model",
      operation: "write_day",
      cost_rappen: costRappen,
      created_at: createdAt,
    })
    .execute();
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-usage-fold-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  fs.mkdirSync(path.join(dir, "alex"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({ title: "Alex", owner: { name: "Alex", nickname: "Alex", email: "alex@example.test" } }),
  );
  clearConfigCache();
  clearUserCache();
  await getDatabase();
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("foldUsageOlderThan", () => {
  test("a row older than the cutoff is folded into usage_monthly_totals and deleted; a newer one is untouched", async () => {
    await insertAt("2024-01-15T00:00:00.000Z", 50);
    await insertAt("2024-01-20T00:00:00.000Z", 30);
    await insertAt(nowIso(), 10); // well inside the window

    const cutoff = "2024-06-01T00:00:00.000Z";
    const result = await foldUsageOlderThan(cutoff);
    expect(result.groups).toBe(1); // one owner/month/provider group: alex/2024-01/anthropic
    expect(result.deletedRows).toBe(2);

    const remaining = await usageSince("1970-01-01T00:00:00.000Z");
    expect(remaining.reduce((sum, t) => sum + t.calls, 0)).toBe(1);

    const { db } = (await getDatabase())!;
    const folded = await db.selectFrom("usage_monthly_totals").selectAll().execute();
    expect(folded).toHaveLength(1);
    expect(folded[0]).toMatchObject({ owner_id: "alex", month: "2024-01", provider: "anthropic", cost_rappen: 80, calls: 2 });
  });

  test("folding twice adds onto the same month rather than overwriting it", async () => {
    await insertAt("2024-01-05T00:00:00.000Z", 20);
    await foldUsageOlderThan("2024-06-01T00:00:00.000Z");
    await insertAt("2024-01-25T00:00:00.000Z", 20);
    // Row inserted "after" the first fold but still dated inside the already-
    // folded month — the shape a month that ages out over several nights
    // actually takes.
    await foldUsageOlderThan("2024-06-01T00:00:00.000Z");

    const { db } = (await getDatabase())!;
    const folded = await db.selectFrom("usage_monthly_totals").selectAll().execute();
    expect(folded).toHaveLength(1);
    expect(folded[0]).toMatchObject({ cost_rappen: 40, calls: 2 });
  });

  test("the owner's lifetime cost is unchanged by the fold", async () => {
    await insertAt("2024-01-15T00:00:00.000Z", 50);
    await insertAt("2024-01-20T00:00:00.000Z", 30);
    await recordUsage({ owner: "alex", provider: "anthropic", model: "no-such-model", operation: "write_day" }); // unpriced, costs 0
    await insertAt(nowIso(), 10);

    const before = await lifetimeCostRappen("alex");
    expect(before).toBe(90);

    await foldUsageOlderThan("2024-06-01T00:00:00.000Z");

    const after = await lifetimeCostRappen("alex");
    expect(after).toBe(before);
  });

  test("with no database, folding and the lifetime total are no-ops rather than errors", async () => {
    await closeDatabase();
    delete process.env.DATABASE_URL;
    clearConfigCache();
    await expect(foldUsageOlderThan("2024-06-01T00:00:00.000Z")).resolves.toEqual({ groups: 0, deletedRows: 0 });
    await expect(lifetimeCostRappen("alex")).resolves.toBe(0);
  });
});

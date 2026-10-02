import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase, newId, nowIso } from "@/lib/db";
import { journalFullCostRappen } from "@/lib/instanceCosts";
import { recordUsage } from "@/lib/usage";

/**
 * B2606: WhatsApp and print costs live in `whatsapp_sends`/`print_orders`,
 * their own counters outside `usage` (so a second `usage` row for the same
 * send can never double-count it in `Dashboard.totalRappen` — see the note
 * on `PROVIDERS` in lib/usage.ts). `journalFullCostRappen` is the one
 * function that reads all three places for a single journal; the two
 * instance-wide readers (`sendCounts`/`printCosts`) keep working exactly as
 * before, scoped by an owner filter that defaults to off.
 */

let dir: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-journal-cost-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", operatorEmail: "op@example.test" },
      users: { reserved: [] },
      features: {},
      costs: {
        models: { "test-model": { inputPerMillionRappen: 80, outputPerMillionRappen: 400 } },
        transcriptionPerThousandMinutesRappen: 0,
        fixedMonthly: [],
        whatsappPerMessageRappen: { marketing: 10 },
      },
    }),
  );
  for (const name of ["alex", "bo"]) {
    fs.mkdirSync(path.join(dir, name), { recursive: true });
    fs.writeFileSync(
      path.join(dir, name, "config.json"),
      JSON.stringify({ title: name, owner: { name, nickname: name, email: `${name}@example.test` } }),
    );
  }
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

const SINCE = "2000-01-01T00:00:00.000Z";

describe("journalFullCostRappen", () => {
  test("sums AI usage, WhatsApp sends and print orders for one journal, and ignores another's", async () => {
    await recordUsage({
      owner: "alex",
      provider: "anthropic",
      model: "test-model",
      operation: "write_day",
      inputTokens: 1_000_000, // 80 rappen at the test price
    });

    const { db } = (await getDatabase())!;
    await db
      .insertInto("whatsapp_sends")
      .values({ id: newId(), owner_id: "alex", category: "marketing", template: "reply", sent_at: nowIso() })
      .execute(); // 10 rappen
    await db
      .insertInto("print_orders")
      .values({
        id: newId(),
        owner_id: "alex",
        kind: "postcard",
        provider: "dry-run",
        cost_minor: 390,
        currency: "CHF",
        created_at: nowIso(),
        updated_at: nowIso(),
      })
      .execute(); // 390 rappen (CHF needs no cross-rate)

    // Another journal's spend must never leak into alex's total.
    await recordUsage({ owner: "bo", provider: "anthropic", model: "test-model", operation: "write_day", inputTokens: 1_000_000 });

    const alex = await journalFullCostRappen("alex", SINCE);
    expect(alex).toBe(80 + 10 + 390);

    const bo = await journalFullCostRappen("bo", SINCE);
    expect(bo).toBe(80);
  });

  test("a journal with nothing costs nothing", async () => {
    expect(await journalFullCostRappen("alex", SINCE)).toBe(0);
  });
});

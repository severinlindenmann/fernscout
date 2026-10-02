import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { recordComposeOutcome, wordEditDistance } from "@/lib/helper/composeOutcome";

/**
 * B2693 — which variant, kept/edited/discarded, and a capped word-level
 * edit distance, beside the existing per-user cost record. Never the text:
 * `compose_outcomes` has no text column at all (`062-compose-outcomes.ts`),
 * so there is nothing here that could leak the composed or saved words.
 */

describe("wordEditDistance — a capped word-level Levenshtein, never the text itself", () => {
  test("zero for identical text", () => {
    expect(wordEditDistance("train to Ljubljana", "train to Ljubljana")).toBe(0);
  });
  test("counts one changed word as one", () => {
    expect(wordEditDistance("a quiet day", "a rainy day")).toBe(1);
  });
  test("counts an inserted word as one", () => {
    expect(wordEditDistance("train to Ljubljana", "train slowly to Ljubljana")).toBe(1);
  });
  test("is capped so a huge paste cannot blow up the loop", () => {
    const a = Array.from({ length: 500 }, (_, i) => `w${i}`).join(" ");
    const b = Array.from({ length: 500 }, (_, i) => `x${i}`).join(" ");
    expect(wordEditDistance(a, b, 50)).toBe(50);
  });
  test("empty strings diff to zero", () => {
    expect(wordEditDistance("", "")).toBe(0);
  });
});

let dir: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-compose-outcome-"));
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.DATABASE_URL;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("recordComposeOutcome — counts only, never the text", () => {
  test("records variant, outcome and a capped edit distance", async () => {
    await recordComposeOutcome("alex", "story", "edited", 7);
    const { db } = (await getDatabase())!;
    const rows = await db.selectFrom("compose_outcomes").selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ owner_id: "alex", variant: "story", outcome: "edited", edit_distance: 7 });
  });

  test("the row holds no text column at all — nothing to leak", async () => {
    await recordComposeOutcome("alex", "close", "kept", 0);
    const { db } = (await getDatabase())!;
    const row = await db.selectFrom("compose_outcomes").selectAll().executeTakeFirstOrThrow();
    const columns = Object.keys(row);
    expect(columns).toEqual(["id", "owner_id", "variant", "outcome", "edit_distance", "occurred_at"]);
    for (const value of Object.values(row)) {
      // Nothing stored is a prose sentence — ids, kinds, numbers and an
      // ISO timestamp only.
      expect(String(value).split(/\s+/).length).toBeLessThan(4);
    }
  });

  test("a negative or fractional distance is never stored as given", async () => {
    await recordComposeOutcome("alex", "none", "discarded", -3.7);
    const { db } = (await getDatabase())!;
    const row = await db.selectFrom("compose_outcomes").selectAll().executeTakeFirstOrThrow();
    expect(row.edit_distance).toBe(0);
  });
});

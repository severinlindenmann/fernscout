import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import {
  claimOrder,
  getPhotobookOrder,
  markPrinted,
  type PhotobookPayload,
} from "@/lib/photobook/orders";
import { storeInboxFile, listInbox } from "@/lib/inbox";
import { cleanupPlan, runCleanup } from "@/lib/storageCleanup";
import { storageBreakdown, journalBytes } from "@/lib/storageQuota";

/**
 * Getting space back without deleting anybody's journey — B664.
 *
 * The property that matters is what *survives*. A cleanup an owner cannot
 * trust is one they never press, and the one thing that must never happen is
 * a photograph disappearing because somebody wanted their photobook PDFs off
 * the disk.
 */

let dir: string;

/**
 * Just enough of an order to have a row and a status.
 *
 * `options` is a whole `BookOptions` in production and none of it is read
 * here — what is under test is which *status* a directory may be removed for,
 * so the cast is the honest shape of this fixture rather than a hundred lines
 * of book settings nothing looks at.
 */
const PAYLOAD = { trip: "alex/asia-2026", options: {}, pages: 20, volumes: 1, credits: 130 } as unknown as PhotobookPayload;

async function setup(): Promise<void> {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-cleanup-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://e.test", defaultUser: "alex" },
      users: { reserved: [] },
      features: {},
    }),
  );
  fs.mkdirSync(path.join(dir, "alex"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({ title: "Alex", owner: { name: "A B", nickname: "A", email: "a@e.test" } }),
  );
  clearConfigCache();
  clearUserCache();

  const { migrateToLatest } = await import("@/lib/db/migrate");
  await migrateToLatest(await getDatabase());
}

/** `n` bytes at `content/alex/<...parts>`. */
function write(bytes: number, ...parts: string[]): string {
  const file = path.join(dir, "alex", ...parts);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.alloc(bytes));
  return file;
}

beforeEach(setup);

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("what a cleanup takes", () => {
  test("a printed book's PDFs go; its record stays, marked", async () => {
    await claimOrder("alex", "ord-00001", PAYLOAD);
    await markPrinted("alex", "ord-00001", { ...PAYLOAD, files: ["book-interior.pdf"] });
    write(4_000, "photobooks", "ord-00001", "book-interior.pdf");

    const plan = await cleanupPlan("alex");
    expect(plan.photobooks).toBe(4_000);
    expect(plan.files).toBe(1);

    await runCleanup("alex");

    expect(fs.existsSync(path.join(dir, "alex", "photobooks", "ord-00001"))).toBe(false);
    // The row survives — the price, the date and the fact it was printed are
    // history — and is marked so nothing offers a download that would 404.
    const order = await getPhotobookOrder("alex", "ord-00001");
    expect(order?.status).toBe("printed");
    expect(order?.payload.pruned).toBe(true);
    expect(order?.payload.files).toEqual([]);
  });

  /**
   * A `submitted` row is a build in progress. Pulling its directory out from
   * under it is the one way this could break something that was working.
   */
  test("a book still building is never touched", async () => {
    await claimOrder("alex", "ord-00002", PAYLOAD);
    write(9_000, "photobooks", "ord-00002", "book-interior.pdf");

    expect((await cleanupPlan("alex")).photobooks).toBe(0);
    await runCleanup("alex");
    expect(fs.existsSync(path.join(dir, "alex", "photobooks", "ord-00002"))).toBe(true);
  });

  test("postcard sheets go", async () => {
    write(2_000, "postcards", "pc_1", "front.pdf");
    expect((await cleanupPlan("alex")).postcards).toBe(2_000);
    await runCleanup("alex");
    expect(fs.existsSync(path.join(dir, "alex", "postcards", "pc_1"))).toBe(false);
  });
});

describe("what a cleanup never takes", () => {
  test("photographs, days and trips are untouched", async () => {
    const photo = write(5_000, "trips", "asia-2026", "media", "day-1", "01.jpg");
    const original = write(9_000, "trips", "asia-2026", "originals", "day-1", "01.jpg");
    const day = write(500, "trips", "asia-2026", "entries", "2026-01-01-a-day.md");
    write(1_000, "postcards", "pc_1", "front.pdf");

    await runCleanup("alex");

    for (const file of [photo, original, day]) expect(fs.existsSync(file)).toBe(true);
  });

  /**
   * Staged photographs are somebody's uploads, not generated output, and
   * deleting them on a button press is the irreversible thing this codebase is
   * careful about. They are not in scope even with `staged`.
   */
  test("staged photographs stay, with or without the second answer", async () => {
    storeInboxFile("alex", "media", "a.jpg", Buffer.alloc(3_000), {});
    storeInboxFile("alex", "files", "bank.csv", Buffer.alloc(1_000), {});

    expect((await cleanupPlan("alex")).stagedFiles).toBe(0);
    expect((await cleanupPlan("alex", true)).stagedFiles).toBe(1_000);

    await runCleanup("alex", true);
    expect(listInbox("alex").media).toHaveLength(1);
    expect(listInbox("alex").files).toHaveLength(0);
  });

  test("without the second answer, staged documents stay too", async () => {
    storeInboxFile("alex", "files", "bank.csv", Buffer.alloc(1_000), {});
    await runCleanup("alex");
    expect(listInbox("alex").files).toHaveLength(1);
  });

  test("a cleanup with nothing to take is not an error", async () => {
    const plan = await cleanupPlan("alex");
    expect(plan.bytes).toBe(0);
    expect((await runCleanup("alex")).done).toBe(true);
  });
});

describe("the breakdown", () => {
  /** A breakdown that quietly loses a few megabytes is one nobody can reason
   * from — `other` is what makes the rows add up. */
  test("the rows sum to what the ceiling is measured against", () => {
    write(5_000, "trips", "asia-2026", "media", "day-1", "01.jpg");
    write(2_000, "photobooks", "ord_1", "book.pdf");
    write(1_000, "postcards", "pc_1", "front.pdf");
    storeInboxFile("alex", "media", "a.jpg", Buffer.alloc(3_000), {});

    const rows = storageBreakdown("alex");
    expect(rows.reduce((n, row) => n + row.bytes, 0)).toBe(journalBytes("alex"));
    // `config.json` is real bytes nobody's trip owns, and lands in `other`.
    expect(rows.find((row) => row.key === "other")!.bytes).toBeGreaterThan(0);
  });

  test("each thing an owner could act on has its own row", () => {
    write(2_000, "photobooks", "ord_1", "book.pdf");
    storeInboxFile("alex", "media", "a.jpg", Buffer.alloc(3_000), {});

    const rows = storageBreakdown("alex");
    expect(rows.find((row) => row.key === "photobooks")!.bytes).toBe(2_000);
    expect(rows.find((row) => row.key === "inbox")!.bytes).toBeGreaterThanOrEqual(3_000);
  });
});

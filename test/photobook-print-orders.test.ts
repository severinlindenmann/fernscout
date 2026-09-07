import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { DEFAULT_OPTIONS } from "@/lib/photobook/options";
import {
  claimForPrint,
  claimOrder,
  getPhotobookOrder,
  markPrinted,
  markPrintFailed,
  type PhotobookPayload,
} from "@/lib/photobook/orders";

const OWNER = "alex";
const PAYLOAD: PhotobookPayload = {
  trip: "alex/asia-2026",
  options: DEFAULT_OPTIONS,
  pages: 52,
  volumes: 1,
  credits: 194,
};

let dir: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-photobook-print-orders-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "orders.db")}`;
  delete process.env.AUTH_DEV_CODE;

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test" },
      users: { reserved: [] },
      features: {
        credits: { enabled: true },
        photobook: { enabled: true, provider: "dry-run" },
      },
    }),
  );
  fs.mkdirSync(path.join(dir, OWNER), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Alex",
      owner: { name: "Alex A", nickname: "Alex", email: "alex@example.test" },
      features: {
        photobook: { enabled: true },
      },
    }),
  );

  clearConfigCache();
  clearUserCache();
  const { migrateToLatest } = await import("@/lib/db/migrate");
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("print state on the order row", () => {
  test("lets exactly one of two simultaneous presses claim the print", async () => {
    const id = "print-one-1234";
    await claimOrder(OWNER, id, PAYLOAD);
    await markPrinted(OWNER, id, PAYLOAD);
    const [a, b] = await Promise.all([claimForPrint(OWNER, id), claimForPrint(OWNER, id)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });

  test("refuses to claim a book that was never built", async () => {
    const id = "print-two-1234";
    await claimOrder(OWNER, id, PAYLOAD); // status: submitted
    expect(await claimForPrint(OWNER, id)).toBe(false);
  });

  test("refuses to claim another journal's order", async () => {
    const id = "print-three-123";
    await claimOrder(OWNER, id, PAYLOAD);
    await markPrinted(OWNER, id, PAYLOAD);
    expect(await claimForPrint("someone-else", id)).toBe(false);
  });

  test("returns a failed print to printed, so it can be tried again", async () => {
    const id = "print-four-1234";
    await claimOrder(OWNER, id, PAYLOAD);
    await markPrinted(OWNER, id, PAYLOAD);
    await claimForPrint(OWNER, id);
    await markPrintFailed(OWNER, id, PAYLOAD, "refused");
    const row = await getPhotobookOrder(OWNER, id);
    expect(row?.status).toBe("printed");
    expect(row?.payload.print?.failure).toBe("refused");
  });
});

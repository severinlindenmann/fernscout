import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { DEFAULT_OPTIONS } from "@/lib/photobook/options";
import {
  ORDER_ID_RE,
  claimOrder,
  getPhotobookOrder,
  markFailed,
  markPrinted,
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-photobook-orders-"));
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

describe("photobook orders", () => {
  test("an order id is a plain token", () => {
    expect(ORDER_ID_RE.test("abc12345")).toBe(true);
    expect(ORDER_ID_RE.test("../../etc/passwd")).toBe(false);
    expect(ORDER_ID_RE.test("a")).toBe(false);
  });

  test("claiming writes a submitted order the owner can read back", async () => {
    expect(await claimOrder(OWNER, "order-one-1234", PAYLOAD)).toBe(true);
    const order = await getPhotobookOrder(OWNER, "order-one-1234");
    expect(order?.status).toBe("submitted");
    expect(order?.payload.credits).toBe(194);
  });

  test("a second press of the same button claims nothing", async () => {
    expect(await claimOrder(OWNER, "order-two-1234", PAYLOAD)).toBe(true);
    expect(await claimOrder(OWNER, "order-two-1234", PAYLOAD)).toBe(false);
  });

  test("another journal cannot read the order by guessing its id", async () => {
    await claimOrder(OWNER, "order-three-123", PAYLOAD);
    expect(await getPhotobookOrder("sam", "order-three-123")).toBeNull();
  });

  test("printed and failed are recorded with the payload", async () => {
    await claimOrder(OWNER, "order-four-1234", PAYLOAD);
    await markPrinted(OWNER, "order-four-1234", { ...PAYLOAD, files: ["interior.pdf", "cover.pdf"] });
    expect((await getPhotobookOrder(OWNER, "order-four-1234"))?.status).toBe("printed");

    await claimOrder(OWNER, "order-five-1234", PAYLOAD);
    await markFailed(OWNER, "order-five-1234", PAYLOAD, "render threw");
    const failed = await getPhotobookOrder(OWNER, "order-five-1234");
    expect(failed?.status).toBe("failed");
    expect(failed?.payload.failure).toBe("render threw");
  });

  test("nothing under app/api can reach the order builder", () => {
    // The same guarantee test/postcard-orders.test.ts makes about sendOrder,
    // for the same reason: an agent must not be able to spend credits.
    const offenders: string[] = [];
    const walk = (root: string) => {
      for (const item of fs.readdirSync(root, { withFileTypes: true })) {
        const full = path.join(root, item.name);
        if (item.isDirectory()) walk(full);
        else if (item.name.endsWith(".ts") || item.name.endsWith(".tsx")) {
          const text = fs.readFileSync(full, "utf8");
          if (text.includes("photobook/build") || text.includes("photobook/orders")) {
            offenders.push(full);
          }
        }
      }
    };
    walk(path.join(process.cwd(), "app", "api"));
    expect(offenders).toEqual([]);
  });
});

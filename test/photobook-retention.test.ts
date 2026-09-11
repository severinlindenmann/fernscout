import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache, loadUserConfig } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { orderDir } from "@/lib/photobook/build";
import { DEFAULT_OPTIONS } from "@/lib/photobook/options";
import {
  claimOrder,
  getPhotobookOrder,
  markBuilt,
  type PhotobookPayload,
} from "@/lib/photobook/orders";
import { pruneOldPhotobooks } from "@/lib/photobook/retention";

/**
 * B483: nothing bounded the PDFs a photobook order writes, and nothing ever
 * deleted them. `pruneOldPhotobooks` is the fix — this is the test that fails
 * without it and passes with it.
 */

const OWNER = "alex";
const PAYLOAD: PhotobookPayload = {
  trip: "alex/asia-2026",
  options: DEFAULT_OPTIONS,
  pages: 52,
  volumes: 1,
  credits: 194,
};

let dir: string;

/** A finished order: a row in `printed`, and a directory with a real file in
 * it, the way `buildPhotobook` leaves one. */
async function writeOrder(id: string, createdAt: string): Promise<void> {
  await claimOrder(OWNER, id, PAYLOAD);
  await markBuilt(OWNER, id, { ...PAYLOAD, files: [`${id}-interior.pdf`] });
  const handle = await getDatabase();
  await handle.db
    .updateTable("print_orders")
    .set({ created_at: createdAt, updated_at: createdAt })
    .where("id", "=", id)
    .execute();
  fs.mkdirSync(orderDir(OWNER, id), { recursive: true });
  fs.writeFileSync(path.join(orderDir(OWNER, id), `${id}-interior.pdf`), "pdf bytes");
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-photobook-retention-"));
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
      features: { photobook: { enabled: true } },
      media: { photobookOrdersPerUser: 2 },
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

describe("pruning old photobooks", () => {
  test("a journal narrowed to 2 keeps only the newest 2 orders' files", async () => {
    await writeOrder("order-oldest-1", "2020-01-01T00:00:00.000Z");
    await writeOrder("order-middle-1", "2020-01-02T00:00:00.000Z");
    await writeOrder("order-newer-1", "2020-01-03T00:00:00.000Z");
    await writeOrder("order-newest-1", "2020-01-04T00:00:00.000Z");

    expect(loadUserConfig(OWNER).media.photobookOrdersPerUser).toBe(2);

    await pruneOldPhotobooks(OWNER);

    expect(fs.existsSync(orderDir(OWNER, "order-oldest-1"))).toBe(false);
    expect(fs.existsSync(orderDir(OWNER, "order-middle-1"))).toBe(false);
    expect(fs.existsSync(orderDir(OWNER, "order-newer-1"))).toBe(true);
    expect(fs.existsSync(orderDir(OWNER, "order-newest-1"))).toBe(true);

    const pruned = await getPhotobookOrder(OWNER, "order-oldest-1");
    expect(pruned?.status).toBe("built"); // still a real, paid-for order
    expect(pruned?.payload.pruned).toBe(true);
    expect(pruned?.payload.files).toEqual([]);

    const kept = await getPhotobookOrder(OWNER, "order-newest-1");
    expect(kept?.payload.files).toEqual(["order-newest-1-interior.pdf"]);
  });

  test("an order still building is never touched, however old its neighbours are", async () => {
    await writeOrder("order-old-2", "2020-01-01T00:00:00.000Z");
    await writeOrder("order-mid-2", "2020-01-02T00:00:00.000Z");
    // Claimed but never printed — a build genuinely in flight.
    await claimOrder(OWNER, "order-building-2", PAYLOAD);
    const handle = await getDatabase();
    await handle.db
      .updateTable("print_orders")
      .set({ created_at: "2019-01-01T00:00:00.000Z" })
      .where("id", "=", "order-building-2")
      .execute();
    fs.mkdirSync(orderDir(OWNER, "order-building-2"), { recursive: true });
    fs.writeFileSync(path.join(orderDir(OWNER, "order-building-2"), "partial.pdf"), "partial");

    await pruneOldPhotobooks(OWNER);

    // Not `printed`, so never a candidate — pruning only ever looks at
    // finished orders, which is what makes it safe to run beside a build.
    expect(fs.existsSync(orderDir(OWNER, "order-building-2"))).toBe(true);
  });

  test("null opts a journal all the way out", async () => {
    fs.writeFileSync(
      path.join(dir, OWNER, "config.json"),
      JSON.stringify({
        title: "Alex",
        owner: { name: "Alex A", nickname: "Alex", email: "alex@example.test" },
        features: { photobook: { enabled: true } },
        media: { photobookOrdersPerUser: null },
      }),
    );
    clearConfigCache();
    clearUserCache();

    await writeOrder("order-a-3", "2020-01-01T00:00:00.000Z");
    await writeOrder("order-b-3", "2020-01-02T00:00:00.000Z");
    await writeOrder("order-c-3", "2020-01-03T00:00:00.000Z");

    await pruneOldPhotobooks(OWNER);

    expect(fs.existsSync(orderDir(OWNER, "order-a-3"))).toBe(true);
    expect(fs.existsSync(orderDir(OWNER, "order-b-3"))).toBe(true);
    expect(fs.existsSync(orderDir(OWNER, "order-c-3"))).toBe(true);
  });
});

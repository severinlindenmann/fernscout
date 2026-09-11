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
  claimOrder as claimPhotobookOrder,
  markBuilt,
  markPrintFailed,
  recordPrint,
  type PhotobookPayload,
} from "@/lib/photobook/orders";
import { createOrder as createPostcardOrder } from "@/lib/postcard/orders";
import { listAllOrders } from "@/lib/orders";

/**
 * `listAllOrders` is what `/[user]/orders` and the preview on `/[user]/account`
 * both read — B1452. The one case worth its own test: a photobook print
 * Gelato refused. `markPrintFailed` puts the row's own `status` column back
 * to `built` (so the book can be sent to print again) and records the
 * refusal only in `payload.print.failure` — the same place
 * `app/[user]/photobooks/[id]/page.tsx` already reads it. A row built from
 * `status` alone reports "built" for an order the owner was told was
 * refused, which is what a person actually saw on fernscout.ch.
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

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-orders-"));
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
        postcards: { enabled: true, provider: "dry-run" },
      },
    }),
  );
  fs.mkdirSync(path.join(dir, OWNER), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Alex",
      owner: { name: "Alex A", nickname: "Alex", email: "alex@example.test" },
      features: { photobook: { enabled: true }, postcards: { enabled: true } },
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

describe("listAllOrders", () => {
  test("a refused print shows as refused, not as built", async () => {
    await claimPhotobookOrder(OWNER, "book-one-1234", PAYLOAD);
    await markBuilt(OWNER, "book-one-1234", { ...PAYLOAD, files: ["interior.pdf"] });
    await claimForPrint(OWNER, "book-one-1234");
    await recordPrint(
      OWNER,
      "book-one-1234",
      {
        ...PAYLOAD,
        files: ["interior.pdf"],
        print: {
          contactId: "c1",
          quotedCredits: 50,
          quotedAt: new Date(0).toISOString(),
          shipmentMethodUid: "standard",
        },
      },
      "gelato-ref-1",
    );
    await markPrintFailed(OWNER, "book-one-1234", PAYLOAD, "refused");

    const rows = await listAllOrders(OWNER);
    const row = rows.find((r) => r.id === "book-one-1234");
    expect(row?.status).toBe("refused");
  });

  test("a built book with no print attempt still shows as built", async () => {
    await claimPhotobookOrder(OWNER, "book-two-1234", PAYLOAD);
    await markBuilt(OWNER, "book-two-1234", { ...PAYLOAD, files: ["interior.pdf"] });

    const rows = await listAllOrders(OWNER);
    expect(rows.find((r) => r.id === "book-two-1234")?.status).toBe("built");
  });

  test("both kinds are merged, newest first", async () => {
    await claimPhotobookOrder(OWNER, "book-three-1234", PAYLOAD);
    const postcard = await createPostcardOrder(OWNER, {
      provider: "dry-run",
      trip: "alex/asia-2026",
      day: "2026-01-01-day",
      photo: "photo.jpg",
      message: "hi",
      from: "Us",
      recipients: ["contact-1"],
      locale: "en",
    });
    expect(postcard).not.toBeNull();

    const rows = await listAllOrders(OWNER);
    expect(rows.map((r) => r.kind).sort()).toEqual(["photobook", "postcard"]);
    // Sorted newest first by `createdAt`, whichever of the two that is.
    expect(rows[0].createdAt >= rows[1].createdAt).toBe(true);
  });
});

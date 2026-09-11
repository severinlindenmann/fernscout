import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { troubles } from "@/lib/adminConsole";
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

  // B1165. The live case this closes: two paid orders came back "refused"
  // with no account of why beyond `journalctl`.
  test("keeps the provider's own message beside the failure code", async () => {
    const id = "print-five-1234";
    await claimOrder(OWNER, id, PAYLOAD);
    await markPrinted(OWNER, id, PAYLOAD);
    await claimForPrint(OWNER, id);
    await markPrintFailed(
      OWNER,
      id,
      PAYLOAD,
      "refused",
      "To be able to place an order please complete the company information in the portal.",
    );
    const row = await getPhotobookOrder(OWNER, id);
    expect(row?.payload.print?.providerMessage).toBe(
      "To be able to place an order please complete the company information in the portal.",
    );
  });

  test("a refused, retryable order still reaches the operator's attention band", async () => {
    // The row stays `printed` (B1348's conditional claim needs it retryable),
    // so `troubles()`'s original `WHERE status = 'failed'` alone never saw
    // it — this asserts the second pass over `printed` rows does.
    const id = "print-six-1234";
    await claimOrder(OWNER, id, PAYLOAD);
    await markPrinted(OWNER, id, PAYLOAD);
    await claimForPrint(OWNER, id);
    await markPrintFailed(OWNER, id, PAYLOAD, "refused", "complete the company information");

    const found = await troubles("2020-01-01");
    const mine = found.find((t) => t.ref === id);
    expect(mine).toBeDefined();
    expect(mine?.owner).toBe(OWNER);
    // The provider's own words, for the operator — never shown to the owner.
    expect(mine?.detail).toContain("complete the company information");
  });

  test("a book still on its way to the printer is not a trouble", async () => {
    const id = "print-seven-1234";
    await claimOrder(OWNER, id, PAYLOAD);
    await markPrinted(OWNER, id, PAYLOAD);
    // No `markPrintFailed` — this order has no `print.failure` at all, so the
    // second pass over `printed` rows must not invent one.
    const found = await troubles("2020-01-01");
    expect(found.find((t) => t.ref === id)).toBeUndefined();
  });
});

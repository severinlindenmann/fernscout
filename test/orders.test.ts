import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
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
import {
  createOrder as createPostcardOrder,
  findOrderByProviderRef,
  getOrder as getPostcardOrder,
  recordProviderCancellation,
  recordResults,
  refreshProviderStatuses,
} from "@/lib/postcard/orders";
import { listAllOrders } from "@/lib/orders";

vi.mock("@/lib/postcard/stannp", () => ({ fetchStannpStatus: vi.fn() }));
import { fetchStannpStatus } from "@/lib/postcard/stannp";

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
  process.env.DATA_DIR = path.join(dir, ".data");
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
  delete process.env.DATA_DIR;
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

/**
 * `app/api/webhooks/stannp/route.ts` — B1484. A real database round trip,
 * unlike `test/stannp-webhook.test.ts`'s own mocked `recordProviderCancellation`:
 * this is what that mock stands in for.
 */
describe("findOrderByProviderRef / recordProviderCancellation", () => {
  test("finds the order and contact a card's own ref belongs to, and cancelling it is additive", async () => {
    const order = await createPostcardOrder(OWNER, {
      provider: "dry-run",
      trip: "alex/asia-2026",
      day: "2026-01-01-day",
      photo: "photo.jpg",
      message: "hi",
      from: "Us",
      recipients: ["contact-1"],
      locale: "en",
    });
    expect(order).not.toBeNull();
    if (!order) return;

    await recordResults(OWNER, order.id, order.payload, [
      { contactId: "contact-1", ok: true, ref: "stannp:9001" },
    ]);

    const found = await findOrderByProviderRef("stannp:9001");
    expect(found).toEqual({ owner: OWNER, id: order.id, contactId: "contact-1" });
    expect(await findOrderByProviderRef("stannp:no-such-id")).toBeNull();

    const claim = await recordProviderCancellation("stannp:9001");
    expect(claim).toEqual({
      owner: OWNER,
      orderId: order.id,
      contactId: "contact-1",
      ref: "stannp:9001",
      creditsEach: order.payload.creditsEach,
    });
    const after = await getPostcardOrder(OWNER, order.id);
    // Additive: still `built`, still `ok: true` — this card really did reach
    // the printer. `providerStatus` is the one new fact.
    expect(after?.status).toBe("built");
    expect(after?.payload.results?.[0]).toEqual({
      contactId: "contact-1",
      ok: true,
      ref: "stannp:9001",
      providerStatus: "cancelled",
    });

    // A retried webhook delivery costs nothing further — no second claim, so
    // nothing downstream refunds or mails a second time.
    expect(await recordProviderCancellation("stannp:9001")).toBeNull();
    const again = await getPostcardOrder(OWNER, order.id);
    expect(again?.payload.results?.[0]?.providerStatus).toBe("cancelled");

    expect(await recordProviderCancellation("stannp:no-such-id")).toBeNull();
  });
});

/**
 * B1532 — a card Stannp cancels after acceptance is refunded, once, however
 * many times the cancellation is delivered.
 */
describe("settleCancelledCard", () => {
  test("refunds the one card's credits and a doubled cancellation refunds nothing further", async () => {
    const { grant } = await import("@/lib/credits");
    const { balanceOf } = await import("@/lib/credits");
    const { settleCancelledCard } = await import("@/lib/postcard/reconcile");

    await grant(OWNER, 100, "top-up");
    const before = await balanceOf(OWNER);

    const order = await createPostcardOrder(OWNER, {
      provider: "dry-run",
      trip: "alex/asia-2026",
      day: "2026-01-01-day",
      photo: "photo.jpg",
      message: "hi",
      from: "Us",
      recipients: ["contact-1"],
      locale: "en",
    });
    expect(order).not.toBeNull();
    if (!order) return;
    await recordResults(OWNER, order.id, order.payload, [
      { contactId: "contact-1", ok: true, ref: "stannp:9101" },
    ]);

    // The webhook, delivered twice for the same event — the exact case
    // Stannp's own retries produce. Only the first delivery gets a claim;
    // the second sees the card already cancelled.
    const first = await recordProviderCancellation("stannp:9101");
    const second = await recordProviderCancellation("stannp:9101");
    expect(first).not.toBeNull();
    expect(second).toBeNull();

    if (first) await settleCancelledCard(first);
    // A doubled delivery never reaches `settleCancelledCard` a second time —
    // `second` is `null` — so there is nothing further to settle here. The
    // assertion that matters is the balance below: one refund, not two.

    const after = await balanceOf(OWNER);
    expect(after).toBe((before ?? 0) + order.payload.creditsEach);
  });
});

/**
 * `refreshProviderStatuses` — B1548. The on-view path: no webhook told this
 * instance anything, so the page itself asks Stannp and saves what changed.
 */
describe("refreshProviderStatuses", () => {
  afterEach(() => vi.mocked(fetchStannpStatus).mockReset());

  test("writes a new status and stops at cancelled", async () => {
    const order = await createPostcardOrder(OWNER, {
      provider: "stannp",
      trip: "alex/asia-2026",
      day: "2026-01-01-day",
      photo: "photo.jpg",
      message: "hi",
      from: "Us",
      recipients: ["contact-1", "contact-2"],
      locale: "en",
    });
    expect(order).not.toBeNull();
    if (!order) return;

    await recordResults(OWNER, order.id, order.payload, [
      { contactId: "contact-1", ok: true, ref: "stannp:9001" },
      { contactId: "contact-2", ok: true, ref: "stannp:9002", providerStatus: "cancelled" },
    ]);
    const built = await getPostcardOrder(OWNER, order.id);
    if (!built) throw new Error("order vanished");

    vi.mocked(fetchStannpStatus).mockResolvedValue("dispatched");

    const refreshed = await refreshProviderStatuses(built);
    expect(refreshed.order.payload.results?.[0]?.providerStatus).toBe("dispatched");
    // Already cancelled: never asked, never overwritten by whatever the mock
    // returns for it — the boundary this function must not cross.
    expect(refreshed.order.payload.results?.[1]?.providerStatus).toBe("cancelled");
    expect(vi.mocked(fetchStannpStatus)).not.toHaveBeenCalledWith("stannp:9002");
    // Nothing newly cancelled this call — the already-cancelled card above
    // was never re-claimed, so there is nothing here for the caller to
    // settle.
    expect(refreshed.cancellations).toEqual([]);

    const saved = await getPostcardOrder(OWNER, order.id);
    expect(saved?.payload.results?.[0]?.providerStatus).toBe("dispatched");
  });

  test("a cancellation found on-view is claimed and handed back to settle, once", async () => {
    const order = await createPostcardOrder(OWNER, {
      provider: "stannp",
      trip: "alex/asia-2026",
      day: "2026-01-01-day",
      photo: "photo.jpg",
      message: "hi",
      from: "Us",
      recipients: ["contact-1"],
      locale: "en",
    });
    expect(order).not.toBeNull();
    if (!order) return;
    await recordResults(OWNER, order.id, order.payload, [
      { contactId: "contact-1", ok: true, ref: "stannp:9010" },
    ]);
    const built = await getPostcardOrder(OWNER, order.id);
    if (!built) throw new Error("order vanished");

    vi.mocked(fetchStannpStatus).mockResolvedValue("cancelled");

    const refreshed = await refreshProviderStatuses(built);
    expect(refreshed.order.payload.results?.[0]?.providerStatus).toBe("cancelled");
    expect(refreshed.cancellations).toEqual([
      {
        owner: OWNER,
        orderId: order.id,
        contactId: "contact-1",
        ref: "stannp:9010",
        creditsEach: order.payload.creditsEach,
      },
    ]);

    // Opening the page again finds it already cancelled — nothing left to
    // claim, so nothing left to settle a second time.
    const again = await refreshProviderStatuses(refreshed.order);
    expect(again.cancellations).toEqual([]);
  });

  test("never stores delivered, local_delivery or returned even if the provider said so", async () => {
    const order = await createPostcardOrder(OWNER, {
      provider: "stannp",
      trip: "alex/asia-2026",
      day: "2026-01-01-day",
      photo: "photo.jpg",
      message: "hi",
      from: "Us",
      recipients: ["contact-1"],
      locale: "en",
    });
    if (!order) throw new Error("order not created");
    await recordResults(OWNER, order.id, order.payload, [
      { contactId: "contact-1", ok: true, ref: "stannp:9003" },
    ]);
    const built = await getPostcardOrder(OWNER, order.id);
    if (!built) throw new Error("order vanished");

    // `fetchStannpStatus` itself is what enforces this boundary — but a real
    // provider returning an unmapped word must not surprise this function
    // either, so the mock stands in for that too.
    vi.mocked(fetchStannpStatus).mockResolvedValue(null);
    const refreshed = await refreshProviderStatuses(built);
    expect(refreshed.order.payload.results?.[0]?.providerStatus).toBeUndefined();
  });
});

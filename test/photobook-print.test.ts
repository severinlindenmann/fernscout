import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { balanceOf, grant } from "@/lib/credits";
import { DEFAULT_OPTIONS } from "@/lib/photobook/options";
import { claimOrder, getPhotobookOrder, markPrinted, type PhotobookPayload } from "@/lib/photobook/orders";
import { approveContact, confirmContact, requestContact } from "@/lib/contacts";
import { issueCode } from "@/lib/auth";

// The refusal mail is not what these assert, and it would try to send.
vi.mock("@/lib/photobook/receipt", () => ({
  sendPhotobookReceipt: vi.fn(),
  sendPhotobookRefused: vi.fn(),
}));

vi.mock("@/lib/photobook/gelato", async () => {
  const actual = await vi.importActual<typeof import("@/lib/photobook/gelato")>("@/lib/photobook/gelato");
  return {
    ...actual,
    quoteBook: vi.fn(),
    submitBookPrint: vi.fn(),
    fetchOrderStatus: vi.fn(),
  };
});

import { fetchOrderStatus, quoteBook, submitBookPrint } from "@/lib/photobook/gelato";

/**
 * `submitBuiltBook` — claim, print, refund what was refused. Same properties
 * `test/postcard-orders.test.ts` holds `sendOrder` to: claim before anything
 * else so a double press submits one book, and a provider refusal gives
 * every credit back.
 *
 * B1428 deleted the pre-B1157 door that quoted and spent a "print portion"
 * against a book bought for its build alone — nothing but the demo journal
 * had ever used it. What remains here is `submitBuiltBook`, the one-press
 * flow's own door to Gelato.
 */

const OWNER = "ana";
const ID = "book-one-12345";
const QUOTED = 180; // photobookPriceCredits(1440, 220), VAT-inclusive landed cost x2 — fixture data only, not asserted directly
const START = 500;

const ADDRESS = {
  name: "A Reader",
  line1: "Bahnhofstrasse 1",
  line2: "",
  postcode: "8001",
  city: "Zurich",
  country: "Switzerland",
  tel: "+41 00 000 00 00",
};

const PAYLOAD: PhotobookPayload = {
  trip: `${OWNER}/alps-2026`,
  options: DEFAULT_OPTIONS,
  pages: 52,
  volumes: 1,
  credits: 194,
  files: ["book-interior.pdf", "book-cover.pdf"],
};

let dir: string;
let CONTACT: string;

const QUOTE_RESULT = {
  printMinor: 1440,
  shipMinor: 220,
  currency: "CHF",
  shipmentMethodUid: "swiss_post_economy",
  expiresAt: "2026-09-08T00:00:00+00:00",
};

async function activeContact(owner: string, email: string) {
  const { contactId } = await requestContact(owner, {
    name: "A Reader",
    email,
    locale: "en",
    address: ADDRESS,
    wantsEmailDigest: false,
    wantsPostcard: false,
    createdVia: "owner",
  });
  const { code } = await issueCode(owner, email, "guest");
  const confirmed = await confirmContact(owner, email, code);
  if (!confirmed.ok) throw new Error(`confirm failed for ${email}`);
  const approved = await approveContact(owner, contactId!);
  if (!approved || approved.contact.status !== "active") throw new Error(`approve failed for ${email}`);
  return contactId!;
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-photobook-print-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "orders.db")}`;
  process.env.CONTACTS_ENCRYPTION_KEY = "22".repeat(32);
  process.env.GELATO_API_KEY = "test-key";
  process.env.SESSION_SECRET = "photobook-print-test-secret-photobook";
  delete process.env.AUTH_DEV_CODE;

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test" },
      users: { reserved: [] },
      features: {
        credits: { enabled: true },
        photobook: { enabled: true, provider: "gelato" },
      },
    }),
  );
  fs.mkdirSync(path.join(dir, OWNER), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: OWNER,
      owner: { name: OWNER, nickname: OWNER, email: `${OWNER}@example.test` },
      features: { photobook: { enabled: true } },
    }),
  );

  clearConfigCache();
  clearUserCache();
  const { migrateToLatest } = await import("@/lib/db/migrate");
  await migrateToLatest(await getDatabase());

  await grant(OWNER, START);

  CONTACT = await activeContact(OWNER, "reader@example.test");

  await claimOrder(OWNER, ID, PAYLOAD);
  await markPrinted(OWNER, ID, PAYLOAD);
  const withPrint: PhotobookPayload = {
    ...PAYLOAD,
    print: { contactId: CONTACT, quotedCredits: QUOTED, quotedAt: new Date().toISOString(), shipmentMethodUid: "swiss_post_economy" },
  };
  // Overwrite the row's payload directly so the order carries a print block —
  // there is no proposal route yet (Task 6).
  const { getDatabaseOrNull } = await import("@/lib/db");
  const handle = await getDatabaseOrNull();
  await handle!.db
    .updateTable("print_orders")
    .set({ payload: JSON.stringify(withPrint) })
    .where("id", "=", ID)
    .where("owner_id", "=", OWNER)
    .execute();

  vi.mocked(quoteBook).mockResolvedValue(QUOTE_RESULT);
  vi.mocked(submitBookPrint).mockResolvedValue({ providerRef: "gel-1" });
  // B1333: still deciding, which is the ordinary case and not a failure.
  vi.mocked(fetchOrderStatus).mockResolvedValue("created");
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.CONTACTS_ENCRYPTION_KEY;
  delete process.env.GELATO_API_KEY;
  delete process.env.SESSION_SECRET;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
  vi.clearAllMocks();
});

/**
 * B1157. The one-press flow charges building and printing together and hands
 * the finished book here, so this half neither quotes nor spends — it either
 * gets the order to the printer or gives back **everything**.
 *
 * The full amount and not the print portion, because what was sold is a
 * printed book: a pile of PDFs is not a partial delivery of one.
 */
describe("submitBuiltBook", () => {
  test("returns the whole purchase when the printer refuses, not just the print half", async () => {
    const { submitBuiltBook } = await import("@/lib/photobook/print");
    vi.mocked(submitBookPrint).mockResolvedValue({ error: "refused" });
    const before = (await balanceOf(OWNER)) ?? 0;

    const result = await submitBuiltBook(OWNER, ID);

    expect(result).toEqual({ ok: false, reason: "refused" });
    // `PAYLOAD.credits` is what the owner pressed — build and print together.
    // Nothing was spent inside this function, so the refund is a straight
    // credit of that amount.
    expect((await balanceOf(OWNER)) ?? 0).toBe(before + PAYLOAD.credits);
  });

  test("spends nothing of its own when the printer accepts", async () => {
    const { submitBuiltBook } = await import("@/lib/photobook/print");
    const before = (await balanceOf(OWNER)) ?? 0;

    const result = await submitBuiltBook(OWNER, ID);

    expect(result).toMatchObject({ ok: true, providerRef: "gel-1" });
    // The purchase was charged by `order/route.ts` before this ran.
    expect((await balanceOf(OWNER)) ?? 0).toBe(before);
    expect((await getPhotobookOrder(OWNER, ID))?.payload.print?.providerRef).toBe("gel-1");
  });

  test("gives everything back when the printer accepts and then refuses", async () => {
    const { submitBuiltBook } = await import("@/lib/photobook/print");
    // B1333. Gelato answers the create with a reference and decides seconds
    // later. An order with no payment method behind it came back `failed`
    // while the owner was still reading "your book is being printed".
    vi.mocked(fetchOrderStatus).mockResolvedValue("failed");
    const before = (await balanceOf(OWNER)) ?? 0;

    const result = await submitBuiltBook(OWNER, ID);

    expect(result).toEqual({ ok: false, reason: "refused" });
    expect((await balanceOf(OWNER)) ?? 0).toBe(before + PAYLOAD.credits);
  });

  test("a status that is not a terminal failure is left alone", async () => {
    const { submitBuiltBook } = await import("@/lib/photobook/print");
    // Everything that is not "never going to print" must not trigger a
    // refund — including a word Gelato adds tomorrow.
    vi.mocked(fetchOrderStatus).mockResolvedValue("in_production");
    const before = (await balanceOf(OWNER)) ?? 0;

    const result = await submitBuiltBook(OWNER, ID);

    expect(result).toMatchObject({ ok: true, providerRef: "gel-1" });
    expect((await balanceOf(OWNER)) ?? 0).toBe(before);
  });

  test("does not quote — the price was agreed before the book was built", async () => {
    const { submitBuiltBook } = await import("@/lib/photobook/print");
    await submitBuiltBook(OWNER, ID);
    // A second quote here would be a second price for a purchase already
    // made, and a mismatched one would strand a paid-for book.
    expect(quoteBook).not.toHaveBeenCalled();
  });
});

/**
 * B1348. Settling a refused print gives money back, and two things can reach
 * the same order at the same moment: Gelato's webhook and the five-minute
 * sweep, or a webhook Gelato retries. `refund()` is unconditional and does
 * not deduplicate by ref, so without a claim both would credit the owner.
 */
describe("settling a refused print, twice at once", () => {
  test("refunds once, however many callers arrive together", async () => {
    const { settleRefusedPrint } = await import("@/lib/photobook/reconcile");
    const { claimForPrint } = await import("@/lib/photobook/orders");
    // The order has to be in flight for there to be anything to settle.
    expect(await claimForPrint(OWNER, ID)).toBe(true);
    const before = (await balanceOf(OWNER)) ?? 0;

    const [a, b] = await Promise.all([
      settleRefusedPrint(OWNER, ID, "canceled"),
      settleRefusedPrint(OWNER, ID, "canceled"),
    ]);

    // Exactly one wins the claim, and the balance moves exactly once.
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect((await balanceOf(OWNER)) ?? 0).toBe(before + PAYLOAD.credits);
  });

  test("a later attempt settles nothing", async () => {
    const { settleRefusedPrint } = await import("@/lib/photobook/reconcile");
    const { claimForPrint } = await import("@/lib/photobook/orders");
    expect(await claimForPrint(OWNER, ID)).toBe(true);
    await settleRefusedPrint(OWNER, ID, "canceled");
    const after = (await balanceOf(OWNER)) ?? 0;

    expect(await settleRefusedPrint(OWNER, ID, "canceled")).toBe(false);
    expect((await balanceOf(OWNER)) ?? 0).toBe(after);
  });
});

describe("no route to Gelato outside the owner's own order flow", () => {
  test("nothing under app/api can reach the printer", () => {
    // The module doc comment on `lib/photobook/print.ts` claims this by name;
    // this is what makes the claim true rather than aspirational.
    const hits: string[] = [];
    const walk = (root: string) => {
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        const full = path.join(root, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name)) {
          const source = fs.readFileSync(full, "utf8");
          if (source.includes("photobook/print") || source.includes("submitBookPrint")) {
            hits.push(path.relative(process.cwd(), full));
          }
        }
      }
    };
    walk(path.join(process.cwd(), "app", "api"));
    expect(hits).toEqual([]);
  });
});

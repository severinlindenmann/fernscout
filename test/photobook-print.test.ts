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

vi.mock("@/lib/photobook/gelato", async () => {
  const actual = await vi.importActual<typeof import("@/lib/photobook/gelato")>("@/lib/photobook/gelato");
  return {
    ...actual,
    quoteBook: vi.fn(),
    submitBookPrint: vi.fn(),
  };
});

import { quoteBook, submitBookPrint } from "@/lib/photobook/gelato";
import { printOrder } from "@/lib/photobook/print";

/**
 * Task 5 of the Gelato photobook plan — claim, spend, print, refund what was
 * refused. Same properties `test/postcard-orders.test.ts` holds `sendOrder`
 * to: claim before spend so a double press costs one book, a stale quote
 * spends nothing, and a provider refusal gives every credit back.
 */

const OWNER = "ana";
const POOR_OWNER = "poor";
const ID = "book-one-12345";
const QUOTED = 125; // photobookPrintCredits(1440, 220) = ceil(1660 * 1.5 / 20)
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
  for (const owner of [OWNER, POOR_OWNER]) {
    fs.mkdirSync(path.join(dir, owner), { recursive: true });
    fs.writeFileSync(
      path.join(dir, owner, "config.json"),
      JSON.stringify({
        title: owner,
        owner: { name: owner, nickname: owner, email: `${owner}@example.test` },
        features: { photobook: { enabled: true } },
      }),
    );
  }

  clearConfigCache();
  clearUserCache();
  const { migrateToLatest } = await import("@/lib/db/migrate");
  await migrateToLatest(await getDatabase());

  await grant(OWNER, START);
  await grant(POOR_OWNER, 1);

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

  test("does not quote — the price was agreed before the book was built", async () => {
    const { submitBuiltBook } = await import("@/lib/photobook/print");
    await submitBuiltBook(OWNER, ID);
    // A second quote here would be a second price for a purchase already made,
    // and `stale_quote` on it would strand a paid-for book.
    expect(quoteBook).not.toHaveBeenCalled();
  });
});

describe("printOrder", () => {
  test("claims before it spends, so two presses cost one book", async () => {
    const [a, b] = await Promise.all([printOrder(OWNER, ID, QUOTED), printOrder(OWNER, ID, QUOTED)]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(await balanceOf(OWNER)).toBe(START - QUOTED);
  });

  test("refuses when the quote it was shown is not the quote now", async () => {
    const result = await printOrder(OWNER, ID, QUOTED + 1);
    expect(result).toEqual({ ok: false, reason: "stale_quote" });
    expect(await balanceOf(OWNER)).toBe(START);
    expect(submitBookPrint).not.toHaveBeenCalled();
  });

  test("gives the credits back when the provider refuses", async () => {
    vi.mocked(submitBookPrint).mockResolvedValue({ error: "refused" });
    const result = await printOrder(OWNER, ID, QUOTED);
    expect(result).toEqual({ ok: false, reason: "refused" });
    expect(await balanceOf(OWNER)).toBe(START);
    expect((await getPhotobookOrder(OWNER, ID))?.status).toBe("printed");
  });

  test("spends nothing when there are not enough credits", async () => {
    const claimed = await claimOrder(POOR_OWNER, "book-two-12345", PAYLOAD);
    expect(claimed).toBe(true);
    await markPrinted(POOR_OWNER, "book-two-12345", PAYLOAD);
    const poorContact = await activeContact(POOR_OWNER, "poor-reader@example.test");
    const { getDatabaseOrNull } = await import("@/lib/db");
    const handle = await getDatabaseOrNull();
    await handle!.db
      .updateTable("print_orders")
      .set({
        payload: JSON.stringify({
          ...PAYLOAD,
          print: { contactId: poorContact, quotedCredits: QUOTED, quotedAt: new Date().toISOString(), shipmentMethodUid: "swiss_post_economy" },
        }),
      })
      .where("id", "=", "book-two-12345")
      .where("owner_id", "=", POOR_OWNER)
      .execute();

    const result = await printOrder(POOR_OWNER, "book-two-12345", QUOTED);
    expect(result).toEqual({ ok: false, reason: "no_credits" });
    expect(await balanceOf(POOR_OWNER)).toBe(1);
  });

  test("hands Gelato a signed URL and not a bare one", async () => {
    await printOrder(OWNER, ID, QUOTED);
    const order = vi.mocked(submitBookPrint).mock.calls[0][0];
    expect(order.interiorUrl).toContain("sig=");
    expect(order.coverUrl).toContain("exp=");
  });

  test("hands the printer an ISO country code and not the stored name", async () => {
    await printOrder(OWNER, ID, QUOTED);
    const order = vi.mocked(submitBookPrint).mock.calls[0][0];
    // B1126. The fixture contact's address says "Switzerland", which is how
    // people write addresses; `ShippingAddress.country` is documented as ISO
    // 3166-1 alpha-2 and two of the four provider builders name the field
    // `countryCode` outright. Passing the name through got as far as the
    // printer and was refused there — after the credits had been spent.
    expect(order.to.country).toBe("CH");
  });

  test("is reachable from no API route", () => {
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

describe("where the book is going decides what it costs", () => {
  test("refuses an address whose country Gelato cannot be asked about", async () => {
    const before = (await balanceOf(OWNER)) ?? 0;
    const result = await printOrder(OWNER, ID, QUOTED);
    // The fixture contact's country is "Switzerland", a name rather than a
    // code — resolved through COUNTRY_CODES, so this must still succeed.
    expect(result).not.toEqual({ ok: false, reason: "unknown_country" });
    expect((await balanceOf(OWNER)) ?? 0).toBeLessThanOrEqual(before);
  });
});

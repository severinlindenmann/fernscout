import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { issueCode } from "@/lib/auth";
import { approveContact, confirmContact, requestContact } from "@/lib/contacts";
import { createOrder } from "@/lib/postcard/orders";
import { postcardSuggestion } from "@/lib/postcard/suggest";
import { writeDayFixture, writeTripFixture } from "./fixtures/content";

/**
 * B436 — the one moment worth catching, at the shared function
 * (`lib/postcard/suggest.ts`) both `/<user>/me` and, until B1632, `GET
 * .../status` drew their own card from.
 *
 * B1632 retired v1's `/status` and v2's own `journalStatus` schema
 * (`lib/api/v2/schemas/status.ts`) carries no `suggestions` field at all —
 * a deliberate narrowing (00-decisions.md), not a gap this ticket may patch
 * by editing a frozen schema. So the "both doors go quiet together"
 * property this file used to assert against the API is gone with the door;
 * what remains is the function itself, still exercised by `/<user>/me`
 * (`app/[user]/me/page.tsx`), asserted at the bottom so a future edit that
 * reimplements this inline instead of calling the shared function is caught.
 */

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
const TRIP = "ana/alps-2026";
const DAY = "over-the-pass";

let dir: string;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function journalConfig(overrides: Record<string, unknown> = {}) {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://t.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: {
        auth: { enabled: true },
        contacts: { enabled: true },
        postcards: { enabled: true, provider: "dry-run" },
        credits: { enabled: true },
        mail: { enabled: true, transport: "file" },
      },
    }),
  );
  fs.mkdirSync(path.join(dir, OWNER), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Ana",
      owner: { name: "Ana A", nickname: "Ana", email: OWNER_EMAIL },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      features: { contacts: { enabled: true }, postcards: { enabled: true } },
      ...overrides,
    }),
  );
}

/** A published day, dated today so it always falls inside the window,
 *  carrying one image. `test` marks it as content nobody lived — B436 must
 *  never suggest a card from one of these. */
function writeDay(test = false) {
  writeTripFixture(OWNER, {
    id: "alps-2026",
    title: "Alps 2026",
    start: "2026-08-01",
    end: "2026-08-31",
    status: "past",
    visibility: "public",
  });
  const root = path.join(dir, OWNER, "trips", "alps-2026");
  fs.mkdirSync(path.join(root, "media"), { recursive: true });
  fs.writeFileSync(path.join(root, "media", "pass.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xdb]));
  writeDayFixture(dir, OWNER, "alps-2026", {
    slug: DAY,
    date: today(),
    title: "Over the pass",
    location: "Zermatt",
    country: "Switzerland",
    content: "Over the pass in the rain.",
    test,
    media: [{ src: "/media/alps-2026/pass.jpg" }],
  });
}

async function addRecipient(): Promise<string> {
  const { contactId } = await requestContact(OWNER, {
    name: "Marta",
    email: "marta@example.test",
    locale: "en",
    address: {
      name: "Marta",
      line1: "Rua 1",
      line2: "",
      postcode: "1000",
      city: "Lisbon",
      country: "Portugal",
      tel: "",
    } as never,
    wantsEmailDigest: false,
    wantsPostcard: true,
    createdVia: "owner",
  });
  const { code } = await issueCode(OWNER, "marta@example.test", "guest");
  const confirmed = await confirmContact(OWNER, "marta@example.test", code);
  if (!confirmed.ok) throw new Error("confirm failed");
  const approved = await approveContact(OWNER, contactId!);
  if (!approved || approved.contact.status !== "active") throw new Error("approve failed");
  return contactId!;
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-postcard-suggest-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "postcard-suggest-test-secret-b436";
  process.env.CONTACTS_ENCRYPTION_KEY = "33".repeat(32);
  journalConfig();
  clearConfigCache();
  clearUserCache();
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATA_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  delete process.env.CONTACTS_ENCRYPTION_KEY;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("with everything in place", () => {
  test("the shared function names the day, the trip and who it would go to", async () => {
    writeDay();
    await addRecipient();

    const suggestion = await postcardSuggestion(OWNER);
    expect(suggestion).toMatchObject({
      kind: "postcard",
      day: DAY,
      trip: TRIP,
    });
    expect(suggestion?.recipients).toHaveLength(1);
    expect(suggestion?.recipients[0]).toMatchObject({ name: "Marta", city: "Lisbon" });
  });
});

describe("each condition can suppress it on its own", () => {
  test("no contact has asked for a postcard", async () => {
    writeDay();
    // No addRecipient() call — nobody has asked.
    expect(await postcardSuggestion(OWNER)).toBeNull();
  });

  test("credits are off server-wide", async () => {
    writeDay();
    await addRecipient();
    fs.writeFileSync(
      path.join(dir, "config.json"),
      JSON.stringify({
        site: { name: "R", url: "https://t.test", defaultUser: OWNER },
        users: { reserved: [] },
        features: {
          auth: { enabled: true },
          contacts: { enabled: true },
          postcards: { enabled: true, provider: "dry-run" },
          credits: { enabled: false },
          mail: { enabled: true, transport: "file" },
        },
      }),
    );
    clearConfigCache();

    expect(await postcardSuggestion(OWNER)).toBeNull();
  });

  test("an order already exists for that trip this week", async () => {
    writeDay();
    await addRecipient();
    await createOrder(OWNER, {
      trip: TRIP,
      day: DAY,
      photo: "pass.jpg",
      message: "Hello",
      from: "Ana",
      recipients: [],
      locale: "en",
      provider: "dry-run",
    });

    expect(await postcardSuggestion(OWNER)).toBeNull();
  });

  test("a test: true day never produces a suggestion", async () => {
    writeDay(true);
    await addRecipient();
    expect(await postcardSuggestion(OWNER)).toBeNull();
  });
});

test("/<user>/me draws its card from the same shared function, not a copy of the logic", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "app", "[user]", "me", "page.tsx"),
    "utf8",
  );
  expect(source).toContain("postcardSuggestion");
  expect(source).toMatch(/from ["']@\/lib\/postcard\/suggest["']/);
});

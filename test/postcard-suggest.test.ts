import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { issueCode, verifyCode } from "@/lib/auth";
import { approveContact, confirmContact, requestContact } from "@/lib/contacts";
import { createOrder } from "@/lib/postcard/orders";
import { postcardSuggestion } from "@/lib/postcard/suggest";
import { GET as statusRoute } from "@/app/api/v1/[user]/status/route";

/**
 * B436 — the one moment worth catching, and the one function that answers it
 * for both `GET .../status` and `/<user>/me` (`lib/postcard/suggest.ts`).
 *
 * Every test here flips exactly one of the function's four conditions and
 * checks the *status route* — the same call `/<user>/me` drives its own card
 * from, through the identical `postcardSuggestion` import — rather than
 * duplicating the logic. `app/[user]/me/page.tsx` importing that same
 * function is asserted once, at the bottom, so a future edit that
 * reimplements this inline instead of calling the shared function is caught
 * here rather than by two pages quietly disagreeing.
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
  const root = path.join(dir, OWNER, "trips", "alps-2026");
  fs.mkdirSync(path.join(root, "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "trip.md"),
    [
      "---",
      'id: "alps-2026"',
      'title: "Alps 2026"',
      'start: "2026-08-01"',
      'end: "2026-08-31"',
      "status: past",
      "visibility: public",
      "---",
      "",
      "Intro.",
      "",
    ].join("\n"),
  );
  fs.mkdirSync(path.join(root, "media"), { recursive: true });
  fs.writeFileSync(path.join(root, "media", "pass.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xdb]));
  fs.writeFileSync(
    path.join(root, "entries", `${today()}-${DAY}.md`),
    [
      "---",
      'title: "Over the pass"',
      `date: "${today()}"`,
      'location: "Zermatt"',
      'country: "Switzerland"',
      ...(test ? ["test: true"] : []),
      "gallery:",
      '  - src: "/media/alps-2026/pass.jpg"',
      '    type: "image"',
      "tags: []",
      "---",
      "",
      "Over the pass in the rain.",
      "",
    ].join("\n"),
  );
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

async function ownerToken(): Promise<string> {
  const { code } = await issueCode(OWNER, OWNER_EMAIL, "agent");
  const verified = await verifyCode(OWNER, OWNER_EMAIL, code, "agent");
  if (!verified.ok) throw new Error("no owner token");
  return verified.token;
}

async function status(token: string) {
  const response = await statusRoute(
    new Request(`https://t.test/api/v1/${OWNER}/status`, {
      headers: { authorization: `Bearer ${token}` },
    }),
    { params: Promise.resolve({ user: OWNER }) },
  );
  return { code: response.status, body: (await response.json()) as Record<string, unknown> };
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

  test("and the status route carries the same day and trip", async () => {
    writeDay();
    await addRecipient();

    const { code, body } = await status(await ownerToken());
    expect(code).toBe(200);
    const suggestions = body.suggestions as { day: string; trip: string }[];
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({ day: DAY, trip: TRIP });
  });
});

describe("flipping one condition changes both doors together", () => {
  test("no contact has asked for a postcard: both the function and status go quiet", async () => {
    writeDay();
    // No addRecipient() call — nobody has asked.

    expect(await postcardSuggestion(OWNER)).toBeNull();
    const { body } = await status(await ownerToken());
    expect("suggestions" in body).toBe(false);
  });

  test("credits are off server-wide: both the function and status go quiet", async () => {
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
    const { body } = await status(await ownerToken());
    expect("suggestions" in body).toBe(false);
  });

  test("an order already exists for that trip this week: both go quiet", async () => {
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
    const { body } = await status(await ownerToken());
    expect("suggestions" in body).toBe(false);
  });
});

test("a test: true day never produces a suggestion", async () => {
  writeDay(true);
  await addRecipient();

  expect(await postcardSuggestion(OWNER)).toBeNull();
  const { body } = await status(await ownerToken());
  expect("suggestions" in body).toBe(false);
});

test("absent means absent, never an empty array", async () => {
  // Nothing written at all: no day, no contact.
  const { body } = await status(await ownerToken());
  expect(body.suggestions).toBeUndefined();
  expect("suggestions" in body).toBe(false);
});

test("/<user>/me draws its card from the same shared function, not a copy of the logic", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "app", "[user]", "me", "page.tsx"),
    "utf8",
  );
  expect(source).toContain("postcardSuggestion");
  expect(source).toMatch(/from ["']@\/lib\/postcard\/suggest["']/);
});

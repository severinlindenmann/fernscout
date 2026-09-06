import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { issueCode } from "@/lib/auth";
import { approveContact, confirmContact, listContacts, optedInCounts, requestContact } from "@/lib/contacts";
import { mailWouldCost } from "@/lib/digest/dayLetter";

/**
 * B367's central promise: the "up to N" the owner reads on `/<user>/me` and
 * the number `mailWouldCost` actually charges cannot drift apart, because
 * both are built on the same opt-in predicate.
 *
 * `optedInCounts` is `recipientsFor`'s predicate (`lib/digest/dayLetter.ts`)
 * restated with no trip to ask `mayMailTrip` about — the journal-wide, most-
 * permissive figure. For a `public` trip `mayMailTrip` is unconditionally
 * `true` (`isOpenToLink`), so `mailWouldCost` for a public trip counts
 * exactly the contacts `optedInCounts` does — with no offset at all since
 * B614, because the owner's own copy is still sent and is no longer charged
 * for. That is what makes these two numbers straightforwardly equal; before,
 * they differed by the owner's own credit and every test here had to know it.
 *
 * WhatsApp is not asserted here — `test/whatsapp.test.ts` owns that channel.
 * The gap this comment used to describe is gone: the count applies `toE164`
 * to a stored number exactly as `dayWhatsapp.ts`'s own `recipientsFor` does,
 * so a consent over a number that cannot be dialled is no longer quoted as a
 * credit. B614.
 */

const OWNER = "alex";
const OWNER_EMAIL = "alex@example.test";

let dir: string;

function writeServerConfig() {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: {
        auth: { enabled: true },
        contacts: { enabled: true },
        mail: { enabled: true, transport: "file" },
        credits: { enabled: true },
      },
    }),
  );
}

function writeUserConfig() {
  fs.mkdirSync(path.join(dir, OWNER), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Two Backpacks",
      tagline: "one slow loop",
      owner: { name: "Alex B", nickname: "Alex", email: OWNER_EMAIL },
      startLocation: "Zurich",
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features: { auth: { enabled: true }, contacts: { enabled: true }, mail: { enabled: true } },
    }),
  );
}

function writeTrip(id: string, visibility: "public" | "private") {
  const root = path.join(dir, OWNER, "trips", id);
  fs.mkdirSync(path.join(root, "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "trip.md"),
    [
      "---",
      `id: "${id}"`,
      `title: "${id}"`,
      'start: "2026-09-01"',
      'end: "2026-09-10"',
      'status: "current"',
      `visibility: "${visibility}"`,
      "---",
      "",
      "Intro.",
      "",
    ].join("\n"),
  );
}

async function addContact(
  email: string,
  opts: { wantsEmailDigest?: boolean; approve?: boolean } = {},
): Promise<void> {
  await requestContact(OWNER, {
    name: `Reader ${email}`,
    email,
    locale: "en",
    address: null,
    wantsEmailDigest: opts.wantsEmailDigest ?? true,
    wantsPostcard: false,
    createdVia: "open",
  });
  const { code } = await issueCode(OWNER, email, "guest");
  const confirmed = await confirmContact(OWNER, email, code);
  if (!confirmed.ok) throw new Error("confirmation failed");
  if (opts.approve !== false) await approveContact(OWNER, confirmed.contact.id);
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-payment-panel-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.CONTACTS_ENCRYPTION_KEY = "44".repeat(32);
  process.env.SESSION_SECRET = "payment-panel-test-secret-payment";
  delete process.env.AUTH_DEV_CODE;

  writeServerConfig();
  writeUserConfig();
  vi.spyOn(console, "log").mockImplementation(() => {});

  const { migrateToLatest } = await import("@/lib/db/migrate");
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await closeDatabase();
  for (const key of [
    "CONTENT_DIR",
    "DATABASE_URL",
    "CONTACTS_ENCRYPTION_KEY",
    "SESSION_SECRET",
  ]) {
    delete process.env[key];
  }
  clearConfigCache();
  clearUserCache();
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("optedInCounts against the send it is meant to predict", () => {
  test("matches mailWouldCost exactly for a public trip, owner's copy included", async () => {
    writeTrip("open-road", "public");
    await addContact("wants-it@example.test", { wantsEmailDigest: true });
    await addContact("said-no-thanks@example.test", { wantsEmailDigest: false });
    await addContact("never-approved@example.test", { wantsEmailDigest: true, approve: false });

    const counts = optedInCounts(await listContacts(OWNER), { email: OWNER_EMAIL });
    const cost = await mailWouldCost(OWNER, "alex/open-road");

    // One contact is active and opted in; one declined; one was never
    // approved. The owner's own copy still goes out and is free — B614 — so
    // the journal-wide figure is one, and this is the assertion that keeps
    // the page's price honest: the number the panel prints is the number a
    // public trip's send actually charges.
    expect(counts.email).toBe(1);
    expect(cost).toBe(counts.email);
  });

  test("the owner being a contact of their own journal is not counted twice", async () => {
    writeTrip("open-road", "public");
    await addContact(OWNER_EMAIL, { wantsEmailDigest: true });
    await addContact("someone-else@example.test", { wantsEmailDigest: true });

    const counts = optedInCounts(await listContacts(OWNER), { email: OWNER_EMAIL });
    const cost = await mailWouldCost(OWNER, "alex/open-road");

    // `recipientsFor` skips a contact at the owner's own address, having
    // already added the owner's own free copy — so the count must skip them
    // too, or an owner subscribed to their own journal is quoted a credit
    // nobody is going to be charged. Only the other reader is billed.
    expect(counts.email).toBe(1);
    expect(cost).toBe(counts.email);
  });

  test("a private trip reaches fewer than the journal-wide figure promises", async () => {
    writeTrip("secret", "private");
    await addContact("just-a-reader@example.test", { wantsEmailDigest: true });

    const counts = optedInCounts(await listContacts(OWNER), { email: OWNER_EMAIL });
    const cost = await mailWouldCost(OWNER, "alex/secret");

    // The reader is opted in journal-wide but was never on this trip and
    // holds no read grant, so a private trip's own send does not reach them
    // — only the owner's own copy goes out, and that one is free. So the
    // trip costs nothing while the panel still says "up to 1": the gap that
    // wording exists to cover, not a bug in either number.
    expect(counts.email).toBe(1);
    expect(cost).toBe(0);
    expect(cost).toBeLessThan(counts.email);
  });
});

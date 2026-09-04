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
 * exactly the contacts `optedInCounts` does, plus the owner's own copy that
 * `recipientsFor` always adds. That offset — not a second definition of
 * "opted in" — is the only difference this test allows.
 *
 * WhatsApp is not asserted here: `dayWhatsapp.ts`'s own `recipientsFor` adds
 * a further filter this panel's simplified count deliberately does not
 * (`toE164` on the stored number), which is itself covered by the same "up
 * to N" wording — that gap is documented already, not tested twice.
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
  test("matches mailWouldCost for a public trip, plus the owner's own copy", async () => {
    writeTrip("open-road", "public");
    await addContact("wants-it@example.test", { wantsEmailDigest: true });
    await addContact("said-no-thanks@example.test", { wantsEmailDigest: false });
    await addContact("never-approved@example.test", { wantsEmailDigest: true, approve: false });

    const counts = optedInCounts(await listContacts(OWNER));
    const cost = await mailWouldCost(OWNER, "alex/open-road");

    // One contact is active and opted in; one declined; one was never
    // approved. `recipientsFor` always adds the owner's own copy too, which
    // `optedInCounts` — a count over contacts, not over "who gets a copy" —
    // deliberately does not.
    expect(counts.email).toBe(1);
    expect(cost).toBe(counts.email + 1);
  });

  test("a private trip reaches fewer than the journal-wide figure promises", async () => {
    writeTrip("secret", "private");
    await addContact("just-a-reader@example.test", { wantsEmailDigest: true });

    const counts = optedInCounts(await listContacts(OWNER));
    const cost = await mailWouldCost(OWNER, "alex/secret");

    // The reader is opted in journal-wide but was never on this trip and
    // holds no read grant, so a private trip's own send does not reach them
    // — only the owner's copy goes out. This is the gap "up to N" is
    // written to cover, not a bug in either number.
    expect(counts.email).toBe(1);
    expect(cost).toBe(1);
    expect(cost).toBeLessThan(counts.email + 1);
  });
});

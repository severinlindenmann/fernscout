import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { clearConfigCache } from "@/lib/config";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { clearUserCache } from "@/lib/users";
import { issueCode } from "@/lib/auth";
import { requestContact, confirmContact, approveContact } from "@/lib/contacts";
import { sendDayLetter } from "@/lib/digest/dayLetter";
import { sweepReminders } from "@/lib/digest/reminder";
import { readTripFile, writeTripFile } from "@/lib/api/v2/store";
import { earliestTodayISO } from "@/lib/tripTime";
import { translateIn } from "@/lib/locales";
import { recipientLocale } from "@/lib/messages/locale";
import { POST as codesRedeem } from "@/app/api/auth/codes/redeem/route";
import { POST as codesRequest } from "@/app/api/auth/codes/route";
import { writeTripFixture, writeDayFixture } from "./fixtures/content";

/**
 * B2439 — the one language resolver every message uses.
 */

describe("recipientLocale", () => {
  test("the first installed candidate, else en", () => {
    expect(recipientLocale(null, "de")).toBe("de");
    expect(recipientLocale("zz", undefined, "hu")).toBe("hu");
    expect(recipientLocale(null, undefined)).toBe("en");
    expect(recipientLocale("xx-not-installed")).toBe("en");
  });
});

const OWNER = "alex";
const OWNER_EMAIL = "alex@example.test";
let dir: string;

function writeServerConfig() {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: { auth: { enabled: true }, contacts: { enabled: true }, mail: { enabled: true, transport: "file" } },
    }),
  );
  clearConfigCache();
}

function writeUserConfig() {
  fs.mkdirSync(path.join(dir, OWNER), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Two Backpacks",
      owner: { name: "Alex B", nickname: "Alex", email: OWNER_EMAIL },
      defaultLocale: "de",
      locales: ["en", "de", "hu"],
      baseCurrency: "CHF",
      features: { auth: { enabled: true }, contacts: { enabled: true }, mail: { enabled: true } },
    }),
  );
  clearConfigCache();
  clearUserCache();
}

function mailFiles(username: string): string[] {
  const folder = path.join(dir, "mail", username);
  return fs.existsSync(folder) ? fs.readdirSync(folder) : [];
}

/** The plain-text `text/plain` part of a raw `.eml`, decoded — the rest of
 * the message is base64 and never contains a readable word to search. */
function textPartOf(raw: string): string {
  const match =
    /Content-Type: text\/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)\r\n\r\n--/.exec(
      raw,
    );
  if (!match) throw new Error("no text/plain part found");
  return Buffer.from(match[1].replace(/\r\n/g, ""), "base64").toString("utf8");
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-msglocale-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.CONTACTS_ENCRYPTION_KEY = "44".repeat(32);
  process.env.SESSION_SECRET = "message-locale-test-secret-abcdef";
  writeServerConfig();
  writeUserConfig();
  vi.spyOn(console, "log").mockImplementation(() => {});
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await closeDatabase();
  for (const key of ["CONTENT_DIR", "DATA_DIR", "DATABASE_URL", "CONTACTS_ENCRYPTION_KEY", "SESSION_SECRET"]) {
    delete process.env[key];
  }
  clearConfigCache();
  clearUserCache();
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a reader with no locale on file gets the day letter in English, not the journal's German", async () => {
  writeTripFixture(OWNER, {
    id: "trip",
    title: "A trip",
    start: "2026-09-01",
    end: "2026-09-10",
    status: "current",
    visibility: "public",
  });
  const slug = "a-day";
  writeDayFixture(dir, OWNER, "trip", {
    slug,
    date: "2026-09-02",
    title: "A day",
    content: "It happened.",
  });

  await requestContact(OWNER, {
    name: "Reader",
    email: "reader@example.test",
    locale: "de",
    address: null,
    wantsEmailDigest: true,
    wantsPostcard: false,
    createdVia: "open",
  });
  const { code } = await issueCode(OWNER, "reader@example.test", "guest");
  const confirmed = await confirmContact(OWNER, "reader@example.test", code);
  if (!confirmed.ok) throw new Error("confirmation failed");
  await approveContact(OWNER, confirmed.contact.id);

  // Simulate a contact with no locale on file — the common case for a row
  // predating this feature, or one the owner added by hand.
  const { db } = await getDatabase();
  await db.updateTable("contacts").set({ locale: null }).where("id", "=", confirmed.contact.id).execute();

  const outcome = await sendDayLetter(OWNER, `${OWNER}/trip`, slug);
  expect(outcome.ok).toBe(true);

  const files = mailFiles(OWNER);
  const readerMail = files.find((f) => f.includes("reader-example-test"));
  expect(readerMail).toBeTruthy();
  const raw = fs.readFileSync(path.join(dir, "mail", OWNER, readerMail!), "utf8");
  const text = textPartOf(raw);
  // English, not the journal's German default.
  expect(text).toContain(translateIn("en", "dayMail.button"));
  expect(text).not.toContain(translateIn("de", "dayMail.button"));
});

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

test("an owner who signed in with ?lang=hu gets the evening reminder in Hungarian", async () => {
  const TODAY = earliestTodayISO();
  writeTripFixture(OWNER, {
    id: "trip",
    title: "A trip",
    start: addDays(TODAY, -1),
    end: addDays(TODAY, 1),
    status: "current",
    visibility: "private",
  });
  // D18: reminder lives on the trip document, merged on after the fixture —
  // `createTrip` has no argument for it (test/reminders.test.ts's own note).
  const stored = readTripFile(OWNER, "trip");
  writeTripFile(OWNER, "trip", { ...stored!, reminder: { channel: "mail" } });

  const CODE = "778899";
  process.env.AUTH_DEV_CODE = CODE;

  // Ask for a sign-in code, then redeem it with a Hungarian locale cookie —
  // the same "?lang=hu" the sign-in link carries (lib/auth's `withLang`).
  // `for: "write"` rather than `"read"`: a read redeem sets a cookie via
  // `next/headers`, which needs a request scope a direct route call has no
  // reason to build (the same choice test/auth-journal-switch.test.ts and
  // test/scope-escalation.test.ts make) — `verifyCode`/`openSession` write
  // `users.locale` the same way regardless of which credential shape asked.
  await codesRequest(
    new Request("http://t.test/api/auth/codes", {
      method: "POST",
      body: JSON.stringify({ for: "write", user: OWNER, email: OWNER_EMAIL }),
    }),
  );

  const redeemed = await codesRedeem(
    new Request("http://t.test/api/auth/codes/redeem", {
      method: "POST",
      headers: { cookie: "fs.locale=hu" },
      body: JSON.stringify({ for: "write", user: OWNER, email: OWNER_EMAIL, code: CODE }),
    }),
  );
  expect(redeemed.status).toBe(200);
  delete process.env.AUTH_DEV_CODE;

  const result = await sweepReminders({ dryRun: false });
  expect(result.sent).toBeGreaterThan(0);

  const files = mailFiles(OWNER);
  // The sign-in code above already sent one mail to this address; the
  // reminder is the one sent after it, so the newest wins.
  const reminderMail = files.filter((f) => f.includes("alex-example-test")).sort().at(-1);
  expect(reminderMail).toBeTruthy();
  const raw = fs.readFileSync(path.join(dir, "mail", OWNER, reminderMail!), "utf8");
  expect(textPartOf(raw)).toContain(translateIn("hu", "mail.reminderTitle"));
});

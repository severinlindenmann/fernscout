import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";

/**
 * B272 — the production scenario, reproduced.
 *
 * A reader opened a guest invite, typed a code that was right, and was told
 * it was wrong — because `confirmContact` succeeded and then
 * `notifyOwnerOfRequest`, awaited unguarded, hit a transient SMTP failure ten
 * seconds later. The route 500'd, the reader read that as a bad code, and the
 * one notice the owner ever gets was gone for good: `firstConfirmation` is
 * `confirmed_at === null`, and `confirmed_at` had just been set by the
 * attempt that then crashed.
 *
 * This file reproduces exactly that ordering — the reader's own mail lands,
 * the owner's does not — and checks the fix from both ends: the reader is
 * told they are confirmed, not that their code was wrong, and the owner is
 * not left untold forever.
 */

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
const READER = "oma@example.test";

let dir: string;
let calls = 0;
function headers(): Record<string, string> {
  calls += 1;
  return { "content-type": "application/json", "x-forwarded-for": `10.2.0.${calls % 250}` };
}

function writeServerConfig() {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      // `file` transport: writeEml goes through fs.writeFileSync, which is
      // exactly the seam this file leans on to simulate a mail server having
      // a bad minute (see `failOwnerMailOnce` below).
      features: { auth: { enabled: true }, contacts: { enabled: true }, mail: { enabled: true, transport: "file" } },
    }),
  );
}

async function reloadConfig() {
  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  clearConfigCache();
  clearUserCache();
}

async function confirm(body: Record<string, unknown>) {
  const { POST } = await import("@/app/api/contacts/confirm/route");
  const response = await POST(
    new Request("https://example.test/api/contacts/confirm", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ user: OWNER, ...body }),
    }),
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

/** Sign a reader up, the way the guestbook and the redeem route both do
 * before ever reaching `/api/contacts/confirm`. */
async function signUpReader(email: string) {
  const { requestContact } = await import("@/lib/contacts");
  await requestContact(OWNER, {
    name: "Oma",
    email,
    locale: "en",
    address: null,
    wantsEmailDigest: false,
    wantsPostcard: false,
    createdVia: "open",
  });
}

async function freshCode(email: string) {
  const { issueCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, email, "guest");
  return code;
}

async function notifiedAt(email: string): Promise<string | null> {
  const { getDatabase } = await import("@/lib/db");
  const { db } = await getDatabase();
  const row = await db
    .selectFrom("contacts")
    .select("notified_at")
    .where("owner_id", "=", OWNER)
    .where("email_key", "=", email)
    .executeTakeFirstOrThrow();
  return row.notified_at;
}

let writeSpy: ReturnType<typeof vi.spyOn> | null = null;

/** Makes the *owner's* mail — and only the owner's — throw the way a real
 * SMTP auth failure does, by intercepting the write the file transport makes
 * for it. The reader's own confirmation mail, and everything else `fs` is
 * asked to write, passes straight through — reproducing the production log
 * line for line: the reader's mail went, the owner's did not. */
function failOwnerMailOnce() {
  const real = fs.writeFileSync.bind(fs);
  let thrown = false;
  writeSpy = vi
    .spyOn(fs, "writeFileSync")
    .mockImplementation(
      (file: fs.PathOrFileDescriptor, data: string | NodeJS.ArrayBufferView, options?: fs.WriteFileOptions) => {
        if (!thrown && typeof file === "string" && file.includes("ana-example-test")) {
          thrown = true;
          throw new Error(
            "AUTH PLAIN failed: 454 4.7.0 Temporary authentication failure: Connection lost to authentication server",
          );
        }
        real(file, data, options);
      },
    );
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-notify-fail-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.CONTACTS_ENCRYPTION_KEY = "88".repeat(32);
  process.env.SESSION_SECRET = "99".repeat(32);
  delete process.env.AUTH_DEV_CODE;

  writeServerConfig();
  fs.mkdirSync(path.join(dir, OWNER, "trips"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Two Backpacks",
      tagline: "t",
      owner: { name: "Ana B", nickname: "Ana", email: OWNER_EMAIL },
      startLocation: "X",
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features: { auth: { enabled: true }, contacts: { enabled: true } },
    }),
  );

  await reloadConfig();
  const { migrateToLatest } = await import("@/lib/db/migrate");
  const { getDatabase } = await import("@/lib/db");
  await migrateToLatest(await getDatabase());
});

afterEach(() => {
  writeSpy?.mockRestore();
  writeSpy = null;
});

afterAll(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  for (const key of ["CONTENT_DIR", "DATABASE_URL", "CONTACTS_ENCRYPTION_KEY", "SESSION_SECRET"]) {
    delete process.env[key];
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("a correct code whose owner notification fails", () => {
  test("still confirms — never told it was wrong", async () => {
    await signUpReader(READER);
    const code = await freshCode(READER);

    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    failOwnerMailOnce();
    try {
      const result = await confirm({ email: READER, code });

      // Not the 401 `invalid_code` a wrong code gets — the whole point of
      // B272 is that these two must never look the same to the reader.
      expect(result.status).toBe(200);
      expect(result.body.ok).toBe(true);
      expect(result.body).toHaveProperty("manageUrl");

      // Logged, not swallowed silently (B257's concern) — and not thrown.
      expect(error).toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });

  test("leaves the owner's notice retryable rather than lost", async () => {
    // notified_at stayed null: the mail never landed, and nothing pretended
    // otherwise.
    expect(await notifiedAt(READER)).toBeNull();
  });

  test("a later re-confirmation, with mail working again, gets the owner told", async () => {
    const code = await freshCode(READER);
    const result = await confirm({ email: READER, code });

    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);
    expect(await notifiedAt(READER)).not.toBeNull();
  });

  test("that retry did not put a second request in front of the owner", async () => {
    // One .eml to the owner on disk in total across both attempts — the first
    // never wrote one (it threw), the second wrote exactly one. A guard that
    // resent on every re-confirmation once notified_at was set would leave
    // more than one here.
    const mailDir = path.join(dir, OWNER, "mail");
    const toOwner = fs.readdirSync(mailDir).filter((f) => f.includes("ana-example-test"));
    expect(toOwner).toHaveLength(1);

    // And confirming yet again, now that notified_at is set, sends no more.
    const code = await freshCode(READER);
    await confirm({ email: READER, code });
    const toOwnerAfter = fs.readdirSync(mailDir).filter((f) => f.includes("ana-example-test"));
    expect(toOwnerAfter).toHaveLength(1);
  });
});

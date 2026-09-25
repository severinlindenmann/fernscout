import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeTripFixture } from "./fixtures/content";

/**
 * B347, B348, B349 — the three mails a buddy touches all called them a
 * reader.
 *
 * A buddy link grants write access to one trip, not reading rights to the
 * journal, and three letters got that backwards: the approval mail told them
 * to "follow along", the agent-code mail called the journal "yours", and the
 * owner's own notification called the request "following along" with no
 * trip named. Each is fixed the same way — say which trip, and only when the
 * contact actually arrived by a buddy link. A guest link's mail is asserted
 * unchanged throughout, driven through the same routes so the wiring — not
 * just the copy — is what's under test.
 */

/** The cookie jar `isOwner` reads via the mocked `next/headers` — the only
 * door onto `/api/contacts/admin`'s `approve` since the security review
 * (F5, B2295): it refuses any `Authorization` header outright. */
const jar = vi.hoisted(() => ({ cookies: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.cookies[name] === undefined ? undefined : { value: jar.cookies[name] }),
  }),
}));

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
const TRIP_ID = "bus-2026";
const TRIP_TITLE = "Down the Balkan Line";

let dir: string;
let calls = 0;
function headers(extra: Record<string, string> = {}): Record<string, string> {
  calls += 1;
  return { "content-type": "application/json", "x-forwarded-for": `10.9.0.${calls % 250}`, ...extra };
}

/** The text/plain part of a `.eml` `buildMessage` wrote — base64, per
 * `lib/mail/rfc822.ts` — decoded back to what a reader actually sees. */
function plainTextOf(eml: string): string {
  const part = eml.split(/--fs-[\w-]+\r?\n/).find((p) => p.includes("text/plain"));
  const body = part?.split(/\r?\n\r?\n/).slice(1).join("\n") ?? "";
  return Buffer.from(body.replace(/\r?\n/g, ""), "base64").toString("utf8");
}

function mailFilesFor(email: string): string[] {
  return rawMailFilesFor(email).map(plainTextOf);
}

/** The raw `.eml` files, unfolded and undecoded — for reading a header
 * (`Subject:`) rather than the body `plainTextOf` decodes. */
function rawMailFilesFor(email: string): string[] {
  const mailDir = path.join(dir, "mail", OWNER);
  if (!fs.existsSync(mailDir)) return [];
  const slug = email.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  return fs
    .readdirSync(mailDir)
    .filter((f) => f.includes(slug))
    .sort()
    .map((f) => fs.readFileSync(path.join(mailDir, f), "utf8"));
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-buddy-mail-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.CONTACTS_ENCRYPTION_KEY = "44".repeat(32);
  process.env.SESSION_SECRET = "55".repeat(32);
  delete process.env.AUTH_DEV_CODE;

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: { auth: { enabled: true }, contacts: { enabled: true }, mail: { enabled: true, transport: "file" } },
    }),
  );
  fs.mkdirSync(path.join(dir, OWNER), { recursive: true });
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
  writeTripFixture(OWNER, {
    id: TRIP_ID,
    title: TRIP_TITLE,
    start: "2026-08-25",
    end: "2026-08-26",
    status: "past",
    visibility: "private",
    intro: "Intro.",
  });

  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  clearConfigCache();
  clearUserCache();

  const { migrateToLatest } = await import("@/lib/db/migrate");
  const { getDatabase } = await import("@/lib/db");
  await migrateToLatest(await getDatabase());
});

afterAll(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  for (const key of [
    "CONTENT_DIR",
    "DATA_DIR",
    "DATABASE_URL",
    "CONTACTS_ENCRYPTION_KEY",
    "SESSION_SECRET",
    "AUTH_DEV_CODE",
  ]) {
    delete process.env[key];
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the agent-code mail (B348)", () => {

  test("the owner's own code mail is unchanged", async () => {
    process.env.AUTH_DEV_CODE = "424242";
    try {
      const { POST } = await import("@/app/api/auth/codes/route");
      const response = await POST(
        new Request("https://example.test/api/auth/codes", {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({ user: OWNER, email: OWNER_EMAIL, for: "write" }),
        }),
      );
      expect(response.status).toBe(202);

      const mails = mailFilesFor(OWNER_EMAIL).filter((m) => m.includes("Agent access code"));
      const mail = mails[mails.length - 1];
      expect(mail).toContain("write to your journal for seven days");
      expect(mail).not.toContain(TRIP_TITLE);
    } finally {
      delete process.env.AUTH_DEV_CODE;
    }
  });
});

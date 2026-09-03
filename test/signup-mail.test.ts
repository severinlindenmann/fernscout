import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { POST } from "@/app/api/auth/signup/request/route";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";

/**
 * B111 — where a signup code's `.eml` actually lands.
 *
 * `test/mail.test.ts` covers `writeEml` directly. This covers the one caller
 * that has no journal to be filed under, through the real route, because the
 * unit test only proves the fallback is right if something still takes it —
 * and the whole defect was that nobody noticed which branch this endpoint was
 * on. If a later change hands the route a username, this test says so.
 *
 * The address here is invented (`example.test`, reserved by RFC 2606). What
 * was found on the live server is not repeated anywhere in this repository.
 */

let dir: string;
let caller = 0;

function request(email: string) {
  caller += 1;
  return POST(
    new Request("https://t.test/api/auth/signup/request", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `203.0.113.${caller}`,
      },
      body: JSON.stringify({ email }),
    }),
  );
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-signup-mail-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "auth.db")}`;
  process.env.SESSION_SECRET = "b111-test-secret-b111-test-secret";
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      users: { reserved: [] },
      features: {
        signup: { enabled: true },
        mail: { enabled: true, transport: "file" },
      },
    }),
  );
  clearConfigCache();
  clearUserCache();
  vi.spyOn(console, "log").mockImplementation(() => {});

  const { migrateToLatest } = await import("@/lib/db/migrate");
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  clearConfigCache();
  clearUserCache();
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("POST /api/auth/signup/request", () => {
  test("writes the code under the content root, not the working directory", async () => {
    // A stale `mail/` from a checkout that ran the old code must not decide
    // this test either way: what is asserted is what this request writes.
    const cwdMail = path.join(process.cwd(), "mail");
    const before = fs.existsSync(cwdMail) ? fs.readdirSync(cwdMail) : [];

    const response = await request("newcomer@example.test");
    expect(response.status).toBe(202);

    const bucket = path.join(dir, ".mail");
    const written = fs.readdirSync(bucket);
    expect(written).toHaveLength(1);

    expect(fs.existsSync(cwdMail) ? fs.readdirSync(cwdMail) : []).toEqual(before);

    // And it is the message it claims to be: the code is in there, base64 in a
    // MIME part, so the file has to be decoded before it can be read.
    const raw = fs.readFileSync(path.join(bucket, written[0]), "utf8");
    expect(raw).toContain("To: newcomer@example.test");
    const decoded = raw.replace(/(?:^[A-Za-z0-9+/=]{60,}$\n?)+/gm, (block) =>
      Buffer.from(block.replace(/\s+/g, ""), "base64").toString("utf8"),
    );
    expect(decoded).toMatch(/Your code is \d{6}\./);
  });

  test("no journal directory is invented for it", async () => {
    await request("someone@example.test");

    // `.mail` is an instance directory, like `content/.deleted/`. It must not
    // read as a journal: `lib/users.ts` skips a leading dot, and `USERNAME_RE`
    // could never produce this name in the first place.
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
    expect(dirs).toEqual([".mail"]);
  });
});

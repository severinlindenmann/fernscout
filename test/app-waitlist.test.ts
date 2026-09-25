import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { POST } from "@/app/api/app-waitlist/route";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { listAppWaitlist } from "@/lib/appWaitlist";
import { resetRateLimitsForTests } from "@/lib/rateLimit";

/**
 * B2341 — a visitor who wants the iPhone app while sign-ups are closed.
 *
 * `features.iosApp` off, or on with no `storeUrl` and no working mail/db, is
 * the same "absent, not broken" answer every other optional capability
 * gives — the route itself refuses to exist rather than answering with an
 * empty list or a 500. With everything present, a submission is stored, a
 * confirmation goes out, a duplicate is a no-op with the same response, and
 * the response never distinguishes any of that from a caller's point of
 * view.
 */

let dir: string;
let data: string;
let caller = 0;

function writeConfig(features: Record<string, unknown>) {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      users: { reserved: [] },
      features: { mail: { enabled: true, transport: "file" }, ...features },
    }),
  );
  clearConfigCache();
}

function ask(body: Record<string, unknown>, ip?: string) {
  caller += 1;
  return POST(
    new Request("https://t.test/api/app-waitlist", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip ?? `203.0.113.${caller}` },
      body: JSON.stringify(body),
    }),
  );
}

function mailsWritten(): string[] {
  const bucket = path.join(data, "mail", ".mail");
  return fs.existsSync(bucket) ? fs.readdirSync(bucket) : [];
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-app-waitlist-"));
  data = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-app-waitlist-data-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = data;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "auth.db")}`;
  process.env.SESSION_SECRET = "b2341-test-secret-b2341-test-secret";
  writeConfig({ iosApp: { enabled: true } });
  clearUserCache();
  resetRateLimitsForTests();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});

  const { migrateToLatest } = await import("@/lib/db/migrate");
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATA_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  clearConfigCache();
  clearUserCache();
  resetRateLimitsForTests();
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(data, { recursive: true, force: true });
});

describe("app waitlist", () => {
  test("a submission is stored and a confirmation mail is sent", async () => {
    const before = mailsWritten().length;
    const res = await ask({ email: "visitor@example.com", locale: "de" });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);

    const entries = await listAppWaitlist();
    expect(entries).toHaveLength(1);
    expect(entries[0].email).toBe("visitor@example.com");
    expect(entries[0].locale).toBe("de");

    expect(mailsWritten().length).toBe(before + 1);
  });

  test("a duplicate submission answers the same way and adds no second row", async () => {
    await ask({ email: "again@example.com" });
    const res = await ask({ email: "AGAIN@example.com" }); // different case, same address
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);

    const entries = await listAppWaitlist();
    expect(entries.filter((e) => e.email === "again@example.com")).toHaveLength(1);
  });

  test("a malformed address is refused, distinguishably", async () => {
    const res = await ask({ email: "not-an-email" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_email");
    expect(await listAppWaitlist()).toHaveLength(0);
  });

  test("the per-IP rate limit still answers 200, and stops storing new rows", async () => {
    const ip = "198.51.100.7";
    for (let i = 0; i < 20; i++) {
      const res = await ask({ email: `rl-${i}@example.com` }, ip);
      expect(res.status).toBe(200);
    }
    expect(await listAppWaitlist()).toHaveLength(20);

    const overLimit = await ask({ email: "rl-over@example.com" }, ip);
    expect(overLimit.status).toBe(200);
    expect((await overLimit.json()).ok).toBe(true);
    // No enumeration and no new row: the 21st request from the same IP got
    // exactly the same answer as every one before it.
    expect(await listAppWaitlist()).toHaveLength(20);
  });

  test("with a store URL configured, the route answers not_found — the form is gone", async () => {
    writeConfig({ iosApp: { enabled: true, storeUrl: "https://apps.apple.com/app/id0" } });
    const res = await ask({ email: "late@example.com" });
    expect(res.status).toBe(404);
    expect(await listAppWaitlist()).toHaveLength(0);
  });

  test("with the capability off, the route answers not_found", async () => {
    writeConfig({ iosApp: { enabled: false } });
    const res = await ask({ email: "off@example.com" });
    expect(res.status).toBe(404);
  });

  test("with mail off, the waitlist cannot work and the route answers not_found", async () => {
    writeConfig({ iosApp: { enabled: true }, mail: { enabled: false } });
    const res = await ask({ email: "no-mail@example.com" });
    expect(res.status).toBe(404);
  });
});

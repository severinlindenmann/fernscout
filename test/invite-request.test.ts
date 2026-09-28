import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { POST } from "@/app/api/invite-request/route";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { listInviteRequests } from "@/lib/inviteRequest";
import { resetRateLimitsForTests } from "@/lib/rateLimit";

/**
 * B2507 — a stranger asking to be let in on an invite-only instance.
 *
 * Same contract as `test/app-waitlist.test.ts` (B2341): the door is absent,
 * not broken, when the instance is not invite-only or has no working
 * mail/database, and every outcome that depends on the address — new,
 * already requested, or rate-limited — answers the same way.
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
      features: { mail: { enabled: true, transport: "file" }, signup: { inviteOnly: true }, ...features },
    }),
  );
  clearConfigCache();
}

function ask(body: Record<string, unknown>, ip?: string) {
  caller += 1;
  return POST(
    new Request("https://t.test/api/invite-request", {
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-invite-request-"));
  data = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-invite-request-data-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = data;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "auth.db")}`;
  process.env.SESSION_SECRET = "b2507-test-secret-b2507-test-secret";
  writeConfig({});
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

describe("invite request", () => {
  test("a request is stored and a confirmation mail is sent", async () => {
    const before = mailsWritten().length;
    const res = await ask({ email: "stranger@example.com", locale: "de" });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);

    const entries = await listInviteRequests();
    expect(entries).toHaveLength(1);
    expect(entries[0].email).toBe("stranger@example.com");
    expect(entries[0].locale).toBe("de");

    expect(mailsWritten().length).toBe(before + 1);
  });

  test("the same address twice is one row and the same neutral answer", async () => {
    await ask({ email: "again@example.com" });
    const res = await ask({ email: "AGAIN@example.com" }); // different case, same address
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);

    const entries = await listInviteRequests();
    expect(entries.filter((e) => e.email === "again@example.com")).toHaveLength(1);
  });

  test("two requests from the same address send exactly one confirmation", async () => {
    const before = mailsWritten().length;
    await ask({ email: "twice@example.com" });
    const res = await ask({ email: "twice@example.com" });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    expect(mailsWritten().length).toBe(before + 1);
  });

  test("a malformed address is refused, distinguishably", async () => {
    const res = await ask({ email: "not-an-email" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_email");
    expect(await listInviteRequests()).toHaveLength(0);
  });

  test("the per-IP rate limit still answers 200, and stops storing new rows", async () => {
    const ip = "198.51.100.9";
    for (let i = 0; i < 20; i++) {
      const res = await ask({ email: `rl-${i}@example.com` }, ip);
      expect(res.status).toBe(200);
    }
    expect(await listInviteRequests()).toHaveLength(20);

    const overLimit = await ask({ email: "rl-over@example.com" }, ip);
    expect(overLimit.status).toBe(200);
    expect((await overLimit.json()).ok).toBe(true);
    expect(await listInviteRequests()).toHaveLength(20);
  });

  test("with the instance open, the route answers not_found", async () => {
    writeConfig({ signup: { inviteOnly: false } });
    const res = await ask({ email: "open@example.com" });
    expect(res.status).toBe(404);
    expect(await listInviteRequests()).toHaveLength(0);
  });

  test("with mail off, the request cannot be confirmed and the route answers not_found", async () => {
    writeConfig({ mail: { enabled: false } });
    const res = await ask({ email: "no-mail@example.com" });
    expect(res.status).toBe(404);
  });
});

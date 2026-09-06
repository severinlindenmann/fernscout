import { afterEach, beforeEach, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";

/**
 * B553 — a mail failure on `/api/auth/identity/request` answered `502`,
 * where its two structurally identical siblings — `/api/auth/request` and
 * `/api/auth/signup/request` — answer `503`. A caller cannot tell "this
 * server's own mail is broken, try again" (503) from "an upstream gateway is
 * unreachable" (502) if the same failure means two different things
 * depending on which of three near-identical routes it hit.
 */

vi.mock("@/lib/mail", () => ({
  sendMail: vi.fn(async () => {
    throw new Error("mail transport exploded");
  }),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => ({ get: () => null }),
}));

let dir: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-identity-mail-failure-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.SESSION_SECRET = "aa".repeat(32);
  delete process.env.AUTH_DEV_CODE;
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test" },
      users: { reserved: [] },
      features: { auth: { enabled: true }, mail: { enabled: true, transport: "file" } },
    }),
  );
  clearConfigCache();
  clearUserCache();
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
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a mail send failure answers 503, like its two sibling code routes", async () => {
  const { POST } = await import("@/app/api/auth/identity/request/route");
  const response = await POST(
    new Request("https://example.test/api/auth/identity/request", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" },
      body: JSON.stringify({ email: "ana@example.test" }),
    }),
  );
  const body = (await response.json()) as { error?: string };
  expect(response.status).toBe(503);
  expect(body.error).toBe("mail_failed");
});

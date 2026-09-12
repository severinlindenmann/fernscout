import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// The identity route reads `next/headers` for its locale cookie, which only
// exists inside a real request scope — mocked the same way
// `identity-mail-failure.test.ts` does it, so the route can be called
// directly from a test.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => ({ get: () => null }),
}));

/**
 * B1552 — the email code routes had a per-IP bucket only, which is no
 * ceiling against a distributed caller (a botnet, an IPv6 /64 rotating
 * addresses). Mirrors the WhatsApp channel's own per-number and
 * per-instance buckets (`whatsapp-code-number`, `whatsapp-code-instance`):
 * a per-recipient-address bucket (10/day) and a per-instance daily ceiling
 * (500/day) shared across the three mailed-code routes.
 *
 * Each request carries a different IP, so what refuses it can only be the
 * new address/instance buckets — never the existing per-IP one.
 *
 * `vi.resetModules()` runs before every test so `lib/rateLimit.ts`'s
 * module-level bucket map starts empty each time — otherwise the three
 * tests below, all hitting the same shared instance bucket, would count
 * against each other. Every module the routes touch is therefore imported
 * fresh, dynamically, rather than once at file scope.
 */

const OWNER = "roams";
const OWNER_EMAIL = "owner@example.test";

let dir: string;
let data: string;
let caller = 0;

function nextIp(): string {
  caller += 1;
  const n = caller;
  return `10.${Math.floor(n / 62500) % 250}.${Math.floor(n / 250) % 250}.${n % 250}`;
}

beforeEach(async () => {
  vi.resetModules();
  caller = 0;

  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-email-rate-"));
  data = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-email-rate-data-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = data;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.SESSION_SECRET = "99".repeat(32);
  delete process.env.AUTH_DEV_CODE;

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "Testbed", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: {
        auth: { enabled: true },
        signup: { enabled: true },
        mail: { enabled: true, transport: "file" },
      },
    }),
  );
  fs.mkdirSync(path.join(dir, OWNER, "trips"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Roams's journal",
      owner: { name: "Robin Traveller", nickname: "Robin", email: OWNER_EMAIL },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      features: { auth: { enabled: true } },
    }),
  );

  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  clearConfigCache();
  clearUserCache();

  const { getDatabase } = await import("@/lib/db");
  const { migrateToLatest } = await import("@/lib/db/migrate");
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  for (const key of ["CONTENT_DIR", "DATA_DIR", "DATABASE_URL", "SESSION_SECRET"]) {
    delete process.env[key];
  }
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(data, { recursive: true, force: true });
});

function eml(bucket: string): string[] {
  const p = path.join(data, "mail", bucket);
  if (!fs.existsSync(p)) return [];
  return fs.readdirSync(p).filter((f) => f.endsWith(".eml"));
}

async function askAuth(email: string) {
  const { POST } = await import("@/app/api/auth/codes/route");
  return POST(
    new Request("https://example.test/api/auth/codes", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": nextIp() },
      body: JSON.stringify({ user: OWNER, email, for: "read" }),
    }),
  );
}

async function askIdentity(email: string) {
  const { POST } = await import("@/app/api/auth/codes/route");
  return POST(
    new Request("https://example.test/api/auth/codes", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": nextIp() },
      body: JSON.stringify({ email, for: "identity" }),
    }),
  );
}

async function askSignup(email: string) {
  const { POST } = await import("@/app/api/auth/codes/route");
  return POST(
    new Request("https://example.test/api/auth/codes", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": nextIp() },
      body: JSON.stringify({ email, for: "signup" }),
    }),
  );
}

describe("per-address email ceiling (B1552)", () => {
  test("ordinary sign-in, a handful of codes, is unaffected", async () => {
    for (let i = 0; i < 3; i++) {
      const response = await askAuth("reader@example.test");
      expect(response.status).toBe(202);
    }
    expect(eml(OWNER).length).toBe(3);
  });

  test("one address rotated across IPs is refused after ten codes in a day, and mails no more", async () => {
    const victim = "victim@example.test";
    for (let i = 0; i < 10; i++) {
      const response = await askAuth(victim);
      expect(response.status, `attempt ${i + 1}`).toBe(202);
    }
    // The per-IP bucket never saw more than one hit per IP, so only the new
    // per-address bucket can be refusing this.
    const before = eml(OWNER).length;
    expect(before).toBe(10);

    for (let i = 0; i < 5; i++) {
      const response = await askAuth(victim);
      expect(response.status).toBe(202); // still the uniform 202
    }
    // No mail written for any of the refused attempts.
    expect(eml(OWNER).length).toBe(before);
  });
});

describe("per-instance email ceiling, shared across the three routes (B1552)", () => {
  test("holds across auth, identity and signup requests to distinct addresses", async () => {
    // 500/day total. Drive it most of the way with auth requests to distinct
    // addresses (so the per-address bucket never fires), then finish it off
    // across the other two routes and confirm the ceiling is one shared
    // count rather than three independent ones.
    for (let i = 0; i < 498; i++) {
      const response = await askAuth(`person-${i}@example.test`);
      expect(response.status).toBe(202);
    }
    expect(eml(OWNER).length).toBe(498);

    // Two left in the shared instance bucket.
    const identityResponse = await askIdentity("identity-1@example.test");
    expect(identityResponse.status).toBe(202);
    const signupResponse = await askSignup("signup-1@example.test");
    expect(signupResponse.status).toBe(202);

    // The instance bucket is now spent. A further request on any of the
    // three routes still answers 202 (uniform), but sends nothing.
    const before = eml(OWNER).length + eml(".mail").length;
    const nextAuth = await askAuth("person-499@example.test");
    expect(nextAuth.status).toBe(202);
    const nextIdentity = await askIdentity("identity-2@example.test");
    expect(nextIdentity.status).toBe(202);
    const nextSignup = await askSignup("signup-2@example.test");
    expect(nextSignup.status).toBe(202);

    expect(eml(OWNER).length + eml(".mail").length).toBe(before);
  }, 30000);
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

/**
 * B553 — `days` on `POST .../invites` is documented `integer` and was checked
 * only with `Number.isFinite`, so `2.5` was accepted and reached
 * `inviteExpiry` as an expiry nobody asked for. Refused now, the same way a
 * malformed `email` on this route already is.
 */

const jar = vi.hoisted(() => ({ cookies: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.cookies[name] === undefined ? undefined : { value: jar.cookies[name] },
  }),
}));

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";

let dir: string;
let calls = 0;
function headers(extra: Record<string, string> = {}): Record<string, string> {
  calls += 1;
  return { "content-type": "application/json", "x-forwarded-for": `10.0.1.${calls % 250}`, ...extra };
}

async function ownerToken(): Promise<string> {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, OWNER_EMAIL, "agent");
  const result = await verifyCode(OWNER, OWNER_EMAIL, code, "agent");
  if (!result.ok) throw new Error("sign-in failed for owner");
  return result.token;
}

async function createLink(token: string, body: Record<string, unknown>) {
  const { POST } = await import("@/app/api/v1/[user]/invites/route");
  const response = await POST(
    new Request("https://example.test/api/v1/ana/invites", {
      method: "POST",
      headers: headers({ authorization: `Bearer ${token}` }),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user: OWNER }) },
  );
  return { status: response.status, body: (await response.json()) as { error?: string; message?: string } };
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-invite-days-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.CONTACTS_ENCRYPTION_KEY = "88".repeat(32);
  process.env.SESSION_SECRET = "99".repeat(32);
  delete process.env.AUTH_DEV_CODE;

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: {
        auth: { enabled: true },
        contacts: { enabled: true },
        mail: { enabled: true, transport: "file" },
      },
    }),
  );
  fs.mkdirSync(path.join(dir, OWNER, "trips"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Two Backpacks",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: OWNER_EMAIL },
      startLocation: "X",
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features: { auth: { enabled: true }, contacts: { enabled: true } },
    }),
  );

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
  for (const key of ["CONTENT_DIR", "DATABASE_URL", "CONTACTS_ENCRYPTION_KEY", "SESSION_SECRET", "AUTH_DEV_CODE"]) {
    delete process.env[key];
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("days is refused rather than truncated", () => {
  test("a fractional value is refused, not silently used as-is", async () => {
    const token = await ownerToken();
    const created = await createLink(token, { kind: "guest", days: 2.5 });
    expect(created.status).toBe(400);
    expect(created.body.error).toBe("invalid_request");
    expect(created.body.message).toMatch(/days must be a whole number/i);
  });

  test("a whole number still works", async () => {
    const token = await ownerToken();
    const created = await createLink(token, { kind: "guest", days: 3 });
    expect(created.status).toBe(201);
  });

  test("absent still works, with no expiry forced on it", async () => {
    const token = await ownerToken();
    const created = await createLink(token, { kind: "guest" });
    expect(created.status).toBe(201);
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

// Same guard api-v2-journal.test.ts and api-v2-keys.test.ts use: every call
// here authenticates with a bearer token, never a cookie.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

/**
 * `/api/v2/{user}/channels` — B1623, phase 2 step 4. See
 * docs/plans/2026-09-12-api-v2/social.md.
 *
 * `/invites` and `/contacts` (create/list/grant/{id}/approve/revoke/resend)
 * used to be tested here too — B2295 (one door for readers, B2291) removed
 * those routes: an agent bearer token no longer reaches either.
 */

const OWNER_EMAIL = "mira@example.test";
const OWNER = "mira";

let dir: string;
let calls = 0;

function headers(extra: Record<string, string> = {}): Record<string, string> {
  calls += 1;
  return { "content-type": "application/json", "x-forwarded-for": `10.9.3.${calls % 250}`, ...extra };
}

async function ownerToken(): Promise<string> {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, OWNER_EMAIL, "agent");
  const result = await verifyCode(OWNER, OWNER_EMAIL, code, "agent");
  if (!result.ok) throw new Error("no owner token");
  return result.token;
}

type Body = Record<string, unknown> & { error?: string; message?: string };

async function call(
  method: "GET" | "PUT" | "POST" | "PATCH" | "DELETE",
  url: string,
  route: string,
  routeParams: Record<string, string>,
  opts: { token?: string; body?: unknown; dryRun?: boolean } = {},
) {
  const mod = (await import(route)) as Record<string, (req: Request, ctx: unknown) => Promise<Response>>;
  const handler = mod[method];
  const u = new URL(url);
  if (opts.dryRun !== undefined) u.searchParams.set("dryRun", String(opts.dryRun));
  const response = await handler(
    new Request(u, {
      method,
      headers: headers(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    }),
    { params: Promise.resolve(routeParams) },
  );
  const text = await response.text();
  return { status: response.status, headers: response.headers, body: (text ? JSON.parse(text) : {}) as Body, raw: text };
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-api-v2-social-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.SESSION_SECRET = "77".repeat(32);
  process.env.CONTACTS_ENCRYPTION_KEY = "66".repeat(32);

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test" },
      users: { reserved: [] },
      features: { auth: { enabled: true }, mail: { enabled: true, transport: "file" }, contacts: { enabled: true } },
    }),
  );

  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  const { migrateToLatest } = await import("@/lib/db/migrate");
  const { getDatabase } = await import("@/lib/db");
  const { createJournal } = await import("@/lib/journals");

  clearConfigCache();
  clearUserCache();
  await migrateToLatest(await getDatabase());

  const created = createJournal({
    username: OWNER,
    title: "Two Backpacks",
    ownerEmail: OWNER_EMAIL,
    ownerName: "Mira Traveller",
    ownerNickname: "Mira",
  });
  if (!created.ok) throw new Error(created.message);
  // Decision 5 (docs/v2-migration/00-decisions.md, B1666) made `contacts`
  // instance-only: the server config above already enables it, and there is
  // no v2 door left that lets a journal opt in for itself.
});

afterAll(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATA_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  delete process.env.CONTACTS_ENCRYPTION_KEY;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("GET/PATCH /api/v2/{user}/channels", () => {
  test("reads and writes the mute switches", async () => {
    const token = await ownerToken();
    const before = await call(
      "GET",
      `https://example.test/api/v2/${OWNER}/channels`,
      "@/app/api/v2/[user]/channels/route",
      { user: OWNER },
      { token },
    );
    expect(before.status, JSON.stringify(before.body)).toBe(200);
    expect(before.body.mail).toBe(true);

    const patched = await call(
      "PATCH",
      `https://example.test/api/v2/${OWNER}/channels`,
      "@/app/api/v2/[user]/channels/route",
      { user: OWNER },
      { token, body: { mail: false } },
    );
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    expect(patched.body.mail).toBe(false);

    // put it back so later tests in this file that rely on mail are unaffected
    await call(
      "PATCH",
      `https://example.test/api/v2/${OWNER}/channels`,
      "@/app/api/v2/[user]/channels/route",
      { user: OWNER },
      { token, body: { mail: true } },
    );
  });

  test("dryRun writes nothing", async () => {
    const token = await ownerToken();
    const before = await call(
      "GET",
      `https://example.test/api/v2/${OWNER}/channels`,
      "@/app/api/v2/[user]/channels/route",
      { user: OWNER },
      { token },
    );
    const { status } = await call(
      "PATCH",
      `https://example.test/api/v2/${OWNER}/channels`,
      "@/app/api/v2/[user]/channels/route",
      { user: OWNER },
      { token, body: { mail: false }, dryRun: true },
    );
    expect(status).toBe(200);
    const after = await call(
      "GET",
      `https://example.test/api/v2/${OWNER}/channels`,
      "@/app/api/v2/[user]/channels/route",
      { user: OWNER },
      { token },
    );
    expect(after.body.mail).toBe(before.body.mail);
  });
});

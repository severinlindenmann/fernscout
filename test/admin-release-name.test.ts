import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * The operator hands a deleted journal's name back — B1354.
 *
 * Two properties: it is a 404 to everybody who is not the operator — the same
 * answer the page itself gives, so the route does not announce that it exists
 * — and a released name stops being held, which is the whole observable
 * effect. A second press has nothing left to act on.
 */

const ADMIN_EMAIL = "operator@example.test";
const GONE = "atlantis";

const jar: { cookies: Record<string, string> } = { cookies: {} };
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.cookies[name] === undefined ? undefined : { value: jar.cookies[name] },
    set: () => {},
  }),
}));

let dir: string;
let calls = 0;
let adminCookie: string;

async function release(user: string) {
  calls += 1;
  const { POST } = await import("@/app/api/admin/tombstones/route");
  const response = await POST(
    new Request("https://example.test/api/admin/tombstones", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `10.4.0.${calls % 250}` },
      body: JSON.stringify({ user }),
    }),
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function writeStone(username: string) {
  const { writeTombstone } = await import("@/lib/tombstones");
  writeTombstone({
    kind: "journal",
    username,
    title: "The lost journal",
    deletedAt: "2026-01-02T03:04:05Z",
    requestedBy: "someone@example.test",
    held: { trips: 1, days: 2, files: 3, bytes: 4 },
    notice: { lang: "en", title: "Gone", body: "Gone.", homeLabel: "Home", homeHref: "/" },
  });
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-admin-release-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.SESSION_SECRET = "66".repeat(32);
  process.env.FERNSCOUT_ADMIN_EMAIL = ADMIN_EMAIL;

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", operatorEmail: ADMIN_EMAIL },
      users: { reserved: [] },
      features: { auth: { enabled: true }, mail: { enabled: true, transport: "file" } },
    }),
  );

  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  clearConfigCache();
  clearUserCache();
  const { migrateToLatest } = await import("@/lib/db/migrate");
  const { getDatabase } = await import("@/lib/db");
  await migrateToLatest(await getDatabase());

  const { openIdentitySession } = await import("@/lib/auth");
  adminCookie = (await openIdentitySession(ADMIN_EMAIL)).token;
});

afterAll(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATA_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.FERNSCOUT_ADMIN_EMAIL;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("releasing a held name", () => {
  test("is a 404 to anybody who is not the operator, and the name stays held", async () => {
    await writeStone(GONE);
    jar.cookies = {};
    const { isDeletedUsername } = await import("@/lib/tombstones");
    expect((await release(GONE)).status).toBe(404);
    expect(isDeletedUsername(GONE)).toBe(true);
  });

  test("the operator frees the name", async () => {
    jar.cookies = { fs_identity: adminCookie };
    const { isDeletedUsername } = await import("@/lib/tombstones");
    expect(isDeletedUsername(GONE)).toBe(true);
    const { status, body } = await release(GONE);
    expect(status).toBe(200);
    expect(body.released).toBe(GONE);
    expect(isDeletedUsername(GONE)).toBe(false);
    // And a second press has nothing to act on.
    expect((await release(GONE)).status).toBe(404);
  });
});

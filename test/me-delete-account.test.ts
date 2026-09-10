import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * The owner asking to delete their journal from `/[user]/me` — B1346.
 *
 * The properties are the same three the trip door beside it has, and the first
 * is the one worth failing loudly on: **this route deletes nothing.** It sends
 * the mail that B38 built and stops, so a successful POST must leave the
 * journal on disk. The other two are who may reach it — the owner's cookie,
 * never a guest's — and that an `Authorization` header is refused outright, so
 * an agent cannot use it as a way around its own 202.
 */

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
const GUEST_EMAIL = "guest@example.test";

const jar: { cookies: Record<string, string> } = { cookies: {} };
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.cookies[name] === undefined ? undefined : { value: jar.cookies[name] },
    set: () => {},
  }),
}));

let dir: string;

function as(token: string | null) {
  jar.cookies = {};
  if (token) jar.cookies.fs_session = token;
}

async function cookieFor(email: string): Promise<string> {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, email, "guest");
  const result = await verifyCode(OWNER, email, code, "guest");
  if (!result.ok) throw new Error(`no session for ${email}`);
  return result.token;
}

async function call(method: "GET" | "POST", bearer?: string) {
  const route = await import("@/app/[user]/me/delete/route");
  const request = new Request(`https://example.test/${OWNER}/me/delete`, {
    method,
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
  });
  const context = { params: Promise.resolve({ user: OWNER }) };
  const response = await (method === "GET"
    ? route.GET(request, context as never)
    : route.POST(request, context as never));
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

function mails(): string[] {
  const mailDir = path.join(dir, "mail", OWNER);
  if (!fs.existsSync(mailDir)) return [];
  return fs.readdirSync(mailDir).filter((f) => f.endsWith(".eml"));
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-me-delete-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.SESSION_SECRET = "77".repeat(32);
  delete process.env.AUTH_DEV_CODE;

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: { auth: { enabled: true }, mail: { enabled: true, transport: "file" } },
    }),
  );
  fs.mkdirSync(path.join(dir, OWNER, "trips"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Ana's journal",
      tagline: "t",
      owner: { name: "Ana A", nickname: "Ana", email: OWNER_EMAIL },
      startLocation: "X",
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features: { auth: { enabled: true } },
    }),
  );
  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  clearConfigCache();
  clearUserCache();

  const { migrateToLatest } = await import("@/lib/db/migrate");
  const { getDatabase } = await import("@/lib/db");
  await migrateToLatest(await getDatabase());

  const { createTrip } = await import("@/lib/tripWrite");
  const created = createTrip(OWNER, {
    id: "japan-2027",
    title: "Japan",
    start: "2027-04-01",
    end: "2027-04-20",
  });
  if (!created.ok) throw new Error(created.message);
});

afterAll(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATA_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the delete-account door on /me", () => {
  test("a bearer token is refused before anything else is read", async () => {
    as(null);
    const get = await call("GET", "fs_agent_whatever");
    expect(get.status).toBe(403);
    expect(get.body.error).toBe("not_for_agents");
    const post = await call("POST", "fs_agent_whatever");
    expect(post.status).toBe(403);
    expect(post.body.error).toBe("not_for_agents");
    expect(mails()).toHaveLength(0);
  });

  test("a guest with a session of their own is not the owner", async () => {
    as(await cookieFor(GUEST_EMAIL));
    expect((await call("GET")).status).toBe(403);
    expect((await call("POST")).status).toBe(403);
    expect(mails()).toHaveLength(0);
  });

  test("the owner is told what would go", async () => {
    as(await cookieFor(OWNER_EMAIL));
    const { status, body } = await call("GET");
    expect(status).toBe(200);
    expect(body.title).toBe("Ana's journal");
    expect(body.trips).toBe(1);
    expect(typeof body.size).toBe("string");
  });

  test("the owner's POST sends the mail and deletes nothing", async () => {
    as(await cookieFor(OWNER_EMAIL));
    const before = mails().length;
    const { status, body } = await call("POST");
    expect(status).toBe(200);
    expect(body.deleted).toBe(false);
    expect(body.mailedTo).toBe(OWNER_EMAIL);
    // The whole point: the journal is still there after a successful call.
    expect(fs.existsSync(path.join(dir, OWNER, "config.json"))).toBe(true);
    expect(fs.existsSync(path.join(dir, OWNER, "trips", "japan-2027", "trip.md"))).toBe(true);
    expect(mails().length).toBe(before + 1);
  });
});

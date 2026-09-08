import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { issueCode, verifyCode } from "@/lib/auth";
import { clearConfigCache } from "@/lib/config";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { clearUserCache } from "@/lib/users";

// No cookie ever arrives on any of these calls — `next/headers` is mocked to
// an empty jar so `resolveAccess` runs for real (nothing about it is
// stubbed) and still has nothing to read. That is the point: a bearer token
// is not merely insufficient on top of a cookie, there is no code path here
// that ever looks at one.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

/**
 * B712 — the helper's own routes (`/api/helper/[user]/**`) are cookie-only by
 * design (`docs/plans/2026-09-07-web-helper-agent.md` §4, and every route's
 * own doc comment): `isHelperOwner` reads `resolveAccess`, which reads
 * cookies and nothing else, so an `Authorization` header is not merely
 * checked-and-rejected, it is never looked at. This is the test that keeps
 * that true — a *real*, validly-issued agent token for the journal's own
 * owner, presented with no cookie, must still be refused everywhere in this
 * family. `/agent.md` now says this is deliberate (B712); this is what would
 * fail if a future change made it accidentally not true.
 */

const OWNER_EMAIL = "alex@example.test";
let dir: string;
let token: string;

const params = { params: Promise.resolve({ user: "alex" }) };

function bearerOnly(url: string, init: RequestInit = {}): Request {
  return new Request(url, {
    ...init,
    headers: { ...init.headers, authorization: `Bearer ${token}` },
  });
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-helper-bearer-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "helper-bearer-refused-secret-b712";
  clearConfigCache();
  clearUserCache();

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      features: { auth: { enabled: true }, helper: { enabled: true } },
    }),
  );
  fs.mkdirSync(path.join(dir, "alex"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "Alex",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: OWNER_EMAIL },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
    }),
  );

  await migrateToLatest(await getDatabase());

  const { code } = await issueCode("alex", OWNER_EMAIL, "agent");
  const verified = await verifyCode("alex", OWNER_EMAIL, code, "agent");
  if (!verified.ok) throw new Error("no token");
  token = verified.token;
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

describe("the helper's own routes never accept a bearer token", () => {
  test("consent: POST and DELETE", async () => {
    const { POST, DELETE } = await import("@/app/api/helper/[user]/consent/route");
    const post = await POST(bearerOnly("https://t.test/api/helper/alex/consent", { method: "POST" }), params);
    expect(post.status).toBe(404);
    const del = await DELETE(bearerOnly("https://t.test/api/helper/alex/consent", { method: "DELETE" }), params);
    expect(del.status).toBe(404);
  });

  test("day: GET, POST and PATCH", async () => {
    const { GET, POST, PATCH } = await import("@/app/api/helper/[user]/day/route");
    const get = await GET(bearerOnly("https://t.test/api/helper/alex/day?trip=x&slug=y"), params);
    expect(get.status).toBe(404);
    const post = await POST(
      bearerOnly("https://t.test/api/helper/alex/day", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      params,
    );
    expect(post.status).toBe(404);
    const patch = await PATCH(
      bearerOnly("https://t.test/api/helper/alex/day", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      params,
    );
    expect(patch.status).toBe(404);
  });

  test("search: GET and POST — B904", async () => {
    const { GET, POST } = await import("@/app/api/helper/[user]/search/route");
    const get = await GET(bearerOnly("https://t.test/api/helper/alex/search"), params);
    expect(get.status).toBe(404);
    const post = await POST(
      bearerOnly("https://t.test/api/helper/alex/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ said: "the day we got lost" }),
      }),
      params,
    );
    expect(post.status).toBe(404);
  });

  test("day/publish: POST", async () => {
    const { POST } = await import("@/app/api/helper/[user]/day/publish/route");
    const res = await POST(
      bearerOnly("https://t.test/api/helper/alex/day/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      params,
    );
    expect(res.status).toBe(404);
  });

  test("day/unpublish: POST", async () => {
    const { POST } = await import("@/app/api/helper/[user]/day/unpublish/route");
    const res = await POST(
      bearerOnly("https://t.test/api/helper/alex/day/unpublish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      params,
    );
    expect(res.status).toBe(404);
  });

  test("day/media: GET and POST", async () => {
    const { GET, POST } = await import("@/app/api/helper/[user]/day/media/route");
    const get = await GET(bearerOnly("https://t.test/api/helper/alex/day/media"), params);
    expect(get.status).toBe(404);
    const post = await POST(bearerOnly("https://t.test/api/helper/alex/day/media", { method: "POST" }), params);
    expect(post.status).toBe(404);
  });

  test("day/write-day: POST", async () => {
    const { POST } = await import("@/app/api/helper/[user]/day/write-day/route");
    const res = await POST(
      bearerOnly("https://t.test/api/helper/alex/day/write-day", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      params,
    );
    expect(res.status).toBe(404);
  });
});

// @scans app/api/**
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

// B2345 — GPS doors never widen to the instance operator (B480).
const jar = vi.hoisted(() => ({ cookies: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.cookies[name] === undefined ? undefined : { value: jar.cookies[name] }),
  }),
}));

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
const ADMIN_EMAIL = "operator@example.test";
const STRANGER_EMAIL = "anyone@example.test";
const tokens: Record<string, string> = {};
let dir: string;

async function signIn(email: string): Promise<string> {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, email, "guest");
  const session = await verifyCode(OWNER, email, code, "guest");
  if (!session.ok) throw new Error(`sign-in failed for ${email}`);
  return session.token;
}

const as = (who: string) => {
  jar.cookies = { fs_session: tokens[who] };
};

describe("web zones door", () => {
  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-gps-owner-"));
    process.env.CONTENT_DIR = dir;
    process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
    process.env.CONTACTS_ENCRYPTION_KEY = "44".repeat(32);
    process.env.SESSION_SECRET = "55".repeat(32);
    process.env.FERNSCOUT_ADMIN_EMAIL = ADMIN_EMAIL;
    const features = { auth: { enabled: true }, contacts: { enabled: true } };
    fs.writeFileSync(
      path.join(dir, "config.json"),
      JSON.stringify({
        site: { name: "R", url: "https://example.test", defaultUser: OWNER },
        users: { reserved: [] },
        features,
      }),
    );
    fs.mkdirSync(path.join(dir, OWNER), { recursive: true });
    fs.writeFileSync(
      path.join(dir, OWNER, "config.json"),
      JSON.stringify({
        title: "Two Backpacks",
        owner: { name: "Ana Meyer", nickname: "Ana", email: OWNER_EMAIL },
        defaultLocale: "en",
        locales: ["en"],
        baseCurrency: "CHF",
        features,
      }),
    );
    const { clearConfigCache } = await import("@/lib/config");
    const { clearUserCache } = await import("@/lib/users");
    clearConfigCache();
    clearUserCache();
    tokens.owner = await signIn(OWNER_EMAIL);
    tokens.admin = await signIn(ADMIN_EMAIL);
    tokens.stranger = await signIn(STRANGER_EMAIL);
  });

  afterAll(async () => {
    const { closeDatabase } = await import("@/lib/db");
    await closeDatabase();
    for (const k of ["CONTENT_DIR", "DATABASE_URL", "CONTACTS_ENCRYPTION_KEY", "SESSION_SECRET", "FERNSCOUT_ADMIN_EMAIL"]) {
      delete process.env[k];
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("the operator's cookie is refused on GET and PUT, like a stranger's; the owner's is not", async () => {
    const { GET, PUT } = await import("@/app/api/web/[user]/gps/zones/route");
    const { isOwner } = await import("@/lib/contacts/session");
    const ctx = { params: Promise.resolve({ user: OWNER }) } as never;
    const url = `https://example.test/api/web/${OWNER}/gps/zones`;
    as("admin");
    // Premise: plain isOwner does admit the operator, so this proves something.
    expect(await isOwner(OWNER)).toBe(true);
    expect((await GET(new Request(url), ctx)).status).toBe(403);
    expect((await PUT(new Request(url, { method: "PUT", body: '{"zones":[]}' }), ctx)).status).toBe(403);
    as("stranger");
    expect((await GET(new Request(url), ctx)).status).toBe(403);
    as("owner");
    expect((await GET(new Request(url), ctx)).status).toBe(200);
  });

  test("the operator's cookie cannot import or discard a journal's GPS history (B2346)", async () => {
    const { POST } = await import("@/app/api/helper/[user]/import/route");
    const { storeInboxFile } = await import("@/lib/inbox");
    const { gpsMonthsHeld } = await import("@/lib/gps/api");
    const start = Date.parse("2026-06-22T09:00:00Z") / 1000;
    const jsonl = Array.from({ length: 40 }, (_, i) =>
      JSON.stringify([start + i * 60, Number((37.1 + i * 0.004).toFixed(5)), -8.5]),
    ).join("\n");
    const { entry } = storeInboxFile(OWNER, "files", "walk.jsonl", Buffer.from(jsonl), {});
    const call = (body: object) =>
      POST(
        new Request(`https://example.test/api/helper/${OWNER}/import`, { method: "POST", body: JSON.stringify(body) }),
        { params: Promise.resolve({ user: OWNER }) } as never,
      );
    as("admin");
    for (const body of [{ inbox: entry.id }, { inbox: entry.id, commit: true, trips: [], discard: true }]) {
      const res = await call(body);
      expect(res.status).toBe(404);
      expect((await res.json()).error).toBe("not_your_journal");
    }
    expect(gpsMonthsHeld(OWNER)).toEqual([]);
    as("owner");
    const ok = await call({ inbox: entry.id, commit: true, trips: [], discard: true });
    expect(ok.status).toBe(200);
    expect((await ok.json()).discarded).toBe(true);
  });
});

// A GPS door asks "is this the journal's owner?" with isJournalOwnerCookie,
// never isOwner (which admits the instance operator).
test("no gps door calls plain isOwner", () => {
  const bad: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (/\/(gps(\/|-token\/)|helper\/\[user\]\/import\/)/.test(f) && /\bisOwner\(/.test(fs.readFileSync(f, "utf8"))) bad.push(f);
    }
  };
  walk(path.join(process.cwd(), "app/api"));
  expect(bad).toEqual([]);
});

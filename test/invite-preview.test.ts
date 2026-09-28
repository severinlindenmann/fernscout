import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * B2502 — an invite link pasted into WhatsApp previewed as "Not found". The
 * preview bot sends no cookie and no Accept-Language, so the card has to be
 * written in the journal's own language, name the journal and nothing else,
 * and stay neutral for a code that does not resolve.
 */

const jar = vi.hoisted(() => ({ cookies: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.cookies[name] === undefined ? undefined : { value: jar.cookies[name] }),
    set: (name: string, value: string) => {
      jar.cookies[name] = value;
    },
  }),
  // A preview bot: no Accept-Language, no cookie.
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.77", "user-agent": "WhatsApp/2.23" }),
}));

const OWNER = "lena";
const OWNER_EMAIL = "lena@example.test";
const TITLE = "Zwei Rucksäcke";
let dir: string;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-b2502-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.CONTACTS_ENCRYPTION_KEY = "66".repeat(32);
  process.env.SESSION_SECRET = "77".repeat(32);
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: { auth: { enabled: true }, contacts: { enabled: true }, mail: { enabled: true, transport: "file" } },
    }),
  );
  fs.mkdirSync(path.join(dir, OWNER), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: TITLE,
      owner: { name: "Lena Muster", nickname: "Lena", email: OWNER_EMAIL },
      defaultLocale: "de",
      locales: ["de", "en"],
      baseCurrency: "CHF",
      features: { auth: { enabled: true }, contacts: { enabled: true } },
    }),
  );
  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  clearConfigCache();
  clearUserCache();
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, OWNER_EMAIL, "guest");
  const session = await verifyCode(OWNER, OWNER_EMAIL, code, "guest");
  if (!session.ok) throw new Error("owner sign-in failed");
  jar.cookies = { fs_session: session.token };
});

beforeEach(async () => {
  const { resetRateLimitsForTests } = await import("@/lib/rateLimit");
  resetRateLimitsForTests();
});

afterAll(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  for (const key of ["CONTENT_DIR", "DATA_DIR", "DATABASE_URL", "CONTACTS_ENCRYPTION_KEY", "SESSION_SECRET"]) {
    delete process.env[key];
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

async function newJoinCode(): Promise<string> {
  const { POST } = await import("@/app/api/web/[user]/invites/route");
  const res = await POST(
    new Request(`https://example.test/api/web/${OWNER}/invites`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" },
      body: JSON.stringify({ kind: "guest", name: "Family" }),
    }),
    { params: Promise.resolve({ user: OWNER }) },
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as { joinUrl: string }).joinUrl.split("/j/")[1];
}

async function joinMetadata(code: string) {
  const { generateMetadata } = await import("@/app/j/[code]/page");
  return generateMetadata({ params: Promise.resolve({ code }), searchParams: Promise.resolve({}) });
}

describe("the invitation's link preview", () => {
  test("a live join link: the journal's title, in the journal's language, with its own card", async () => {
    const code = await newJoinCode();
    const meta = await joinMetadata(code);
    expect(meta.title).toBe(`Einladung zum Mitlesen: ${TITLE}`);
    expect(meta.description).toContain("ohne App");
    expect(meta.robots).toEqual({ index: false, follow: false });
    const og = meta.openGraph as { url: string; locale: string; images: { url: string; width: number; height: number }[] };
    expect(og.url).toBe(`/j/${code}`);
    expect(og.locale).toBe("de_DE");
    expect(og.images[0]).toMatchObject({ url: `/j/${code}/og.png`, width: 1200, height: 630 });
  });

  test("an unknown code is a neutral invitation, never 'Not found' and never a journal's name", async () => {
    const meta = await joinMetadata("zzzzzzzzzzzzzzzz");
    expect(meta.title).toBe("Invitation");
    expect(JSON.stringify(meta)).not.toContain(TITLE);
    expect(JSON.stringify(meta)).not.toMatch(/not found/i);
    expect(meta.robots).toEqual({ index: false, follow: false });
  });

  test("an unknown welcome code is neutral too", async () => {
    const { generateMetadata } = await import("@/app/w/[code]/page");
    const meta = await generateMetadata({ params: Promise.resolve({ code: "zzzzzzzzzzzzzzzz" }), searchParams: Promise.resolve({}) });
    expect(meta.title).toBe("Invitation");
    expect(meta.robots).toEqual({ index: false, follow: false });
  });

});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { writeTripFixture } from "./fixtures/content";

/**
 * B-3001 - a server-wide sign-in by SMS (`for: "identity"` with `phone`). Dry
 * run: texts land in <dataDir>/sms. Only the documentation number range.
 */

const jar = vi.hoisted(() => ({ cookies: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.cookies[name] === undefined ? undefined : { value: jar.cookies[name] }),
    set: (name: string, value: string) => {
      jar.cookies[name] = value;
    },
    delete: (name: string) => {
      delete jar.cookies[name];
    },
  }),
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.50" }),
}));

const JOURNALS = ["ana", "ben"];
const NUM = "+41 76 000 00 00";
const DIGITS = "41760000000";
let dir: string;
let ipCounter = 0;

function texts(): { to: string; body: string }[] {
  const smsDir = path.join(dir, "sms");
  if (!fs.existsSync(smsDir)) return [];
  return fs.readdirSync(smsDir).sort().map((f) => JSON.parse(fs.readFileSync(path.join(smsDir, f), "utf8")));
}
const codeIn = (body: string) => body.match(/(?<![#\w])(\d{6})(?!\w)/)?.[1] ?? "";

function post(url: string, body: unknown, ip?: string) {
  return new Request(`https://example.test${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip ?? `203.0.113.${(ipCounter++ % 200) + 1}` },
    body: JSON.stringify(body),
  });
}

async function ask(body: Record<string, unknown>, ip?: string) {
  const { POST } = await import("@/app/api/auth/codes/route");
  const { flushAfterResponse } = await import("@/lib/afterResponse");
  const res = await POST(post("/api/auth/codes", body, ip));
  await flushAfterResponse();
  return { status: res.status, json: await res.json() };
}

async function addActive(owner: string, phone: string, name = "Mira") {
  const { addContact, approveContact, confirmContactByOwner } = await import("@/lib/contacts");
  const added = await addContact(owner, { name, phone, locale: "en", createdVia: "owner" });
  if (!added.ok) throw new Error("add failed");
  await confirmContactByOwner(owner, added.contact.id);
  await approveContact(owner, added.contact.id, { onlyTrip: null });
  return added.contact;
}

async function setStatus(id: string, status: string) {
  const { getDatabase } = await import("@/lib/db");
  const { db } = await getDatabase();
  await db.updateTable("contacts").set({ status }).where("id", "=", id).execute();
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-b3001-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.CONTACTS_ENCRYPTION_KEY = "66".repeat(32);
  process.env.SESSION_SECRET = "77".repeat(32);
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: "ana" },
      users: { reserved: [] },
      features: {
        auth: { enabled: true },
        contacts: { enabled: true },
        mail: { enabled: true, transport: "file" },
        sms: { enabled: true, backend: "dry-run" },
      },
    }),
  );
  for (const owner of JOURNALS) {
    fs.mkdirSync(path.join(dir, owner), { recursive: true });
    fs.writeFileSync(
      path.join(dir, owner, "config.json"),
      JSON.stringify({
        title: `Journal ${owner}`,
        owner: { name: owner, nickname: owner, email: `${owner}@example.test` },
        defaultLocale: "en",
        locales: ["en"],
        baseCurrency: "CHF",
        features: { auth: { enabled: true }, contacts: { enabled: true } },
      }),
    );
    writeTripFixture(owner, { id: "t1", title: "Trip", start: "2026-08-25", end: "2026-08-26", status: "past", visibility: "guest", people: [] });
  }
  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  clearConfigCache();
  clearUserCache();
});

beforeEach(async () => {
  const { resetRateLimitsForTests } = await import("@/lib/rateLimit");
  resetRateLimitsForTests();
  jar.cookies = {};
});

afterAll(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  for (const key of ["CONTENT_DIR", "DATA_DIR", "DATABASE_URL", "CONTACTS_ENCRYPTION_KEY", "SESSION_SECRET"]) delete process.env[key];
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("identity sign-in by number", () => {
  test("a number held in two journals gets one text; redeeming signs in as the number, proves no contact, lists both journals", async () => {
    const a = await addActive("ana", NUM);
    await addActive("ben", NUM);
    const before = texts().length;
    const res = await ask({ for: "identity", phone: NUM });
    expect(res.status).toBe(202);
    expect(texts().length).toBe(before + 1);
    expect(texts().at(-1)?.to).toBe(DIGITS);

    const { POST: redeem } = await import("@/app/api/auth/codes/redeem/route");
    const out = await redeem(post("/api/auth/codes/redeem", { for: "identity", phone: NUM, code: codeIn(texts().at(-1)!.body) }));
    expect(out.status).toBe(200);
    expect(jar.cookies.fs_identity).toBeTruthy();

    const { getContactByEmail } = await import("@/lib/contacts");
    expect((await getContactByEmail("ana", `+${DIGITS}`))?.phoneProvenAt ?? null).toBeNull();
    expect(a.id).toBeTruthy();

    const { journalsFor } = await import("@/lib/home");
    expect((await journalsFor(`+${DIGITS}`)).map((j) => j.username).sort()).toEqual(["ana", "ben"]);
  });

  test("unknown, pending, blocked and self-typed numbers get the same 202 and no text", async () => {
    const { addContact } = await import("@/lib/contacts");
    const pending = await addContact("ana", { name: "P", phone: "+41 76 000 00 01", locale: "en", createdVia: "owner" });
    const blocked = await addActive("ana", "+41 76 000 00 02", "B");
    await setStatus(blocked.id, "blocked");
    const selfTyped = await addActive("ben", "+41 76 000 00 03", "S");
    const { getDatabase } = await import("@/lib/db");
    const { db } = await getDatabase();
    await db.updateTable("contacts").set({ phone_key: null }).where("id", "=", selfTyped.id).execute();
    expect(pending.ok).toBe(true);

    const before = texts().length;
    const answers = [];
    for (const phone of ["+41 76 000 00 09", "+41 76 000 00 01", "+41 76 000 00 02", "+41 76 000 00 03"]) {
      answers.push(await ask({ for: "identity", phone }));
    }
    expect(answers.every((x) => x.status === 202)).toBe(true);
    expect(new Set(answers.map((x) => JSON.stringify(x.json))).size).toBe(1);
    expect(texts().length).toBe(before);
  });

  test("phone is still refused for write and signup", async () => {
    for (const body of [
      { for: "write", user: "ana", phone: NUM },
      { for: "signup", phone: NUM },
    ]) {
      const res = await ask(body);
      expect(res.status).toBe(400);
    }
    const { POST: redeem } = await import("@/app/api/auth/codes/redeem/route");
    const out = await redeem(post("/api/auth/codes/redeem", { for: "signup", phone: NUM, code: "123456" }));
    expect(out.status).toBe(400);
  });

  test("the per-IP bucket answers 429 before any lookup; the per-number bucket stays a silent 202", async () => {
    await addActive("ana", NUM);
    const ip = "198.51.100.7";
    const first = [];
    for (let i = 0; i < 5; i++) first.push((await ask({ for: "identity", phone: "+41 76 000 01 0" + i }, ip)).status);
    expect(first).toEqual([202, 202, 202, 202, 202]);
    expect((await ask({ for: "identity", phone: NUM }, ip)).status).toBe(429);

    const { resetRateLimitsForTests } = await import("@/lib/rateLimit");
    resetRateLimitsForTests();
    const before = texts().length;
    const statuses = [];
    for (let i = 0; i < 5; i++) statuses.push((await ask({ for: "identity", phone: NUM }, `198.51.100.${20 + i}`)).status);
    expect(statuses).toEqual([202, 202, 202, 202, 202]);
    expect(texts().length).toBe(before + 3);
  });
});

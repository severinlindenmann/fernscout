import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { writeTripFixture } from "./fixtures/content";

/**
 * Trip links, the door side — B2961 (AC3, AC4, AC6): `GET /t/<code>` writes
 * nothing and refuses every dead code with one page; the press needs a token
 * and a strict Origin; the two code families never open each other's doors;
 * the request log never carries a code.
 */

const jar = vi.hoisted(() => ({ cookies: {} as Record<string, string>, ip: "203.0.113.70" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.cookies[name] === undefined ? undefined : { value: jar.cookies[name] }),
    set: (name: string, value: string) => {
      jar.cookies[name] = value;
    },
  }),
  headers: async () => new Headers({ "x-forwarded-for": jar.ip }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
const GUEST_TRIP = "alps-2026";
const PRIVATE_TRIP = "secret-2026";
let dir: string;

function writeConfigs(contacts = true) {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: { auth: { enabled: true }, contacts: { enabled: contacts } },
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
      features: { auth: { enabled: true }, contacts: { enabled: contacts } },
    }),
  );
}

async function mint(tripId: string, kind: "read" | "guest" | "buddy" = "read", extra: { expiresAt?: string | null } = {}) {
  const { createInvite } = await import("@/lib/contacts/invites");
  return createInvite(OWNER, { kind, tripId: kind === "guest" ? undefined : tripId, ...extra });
}

async function counts(id: string) {
  const { getDatabase } = await import("@/lib/db");
  const { db } = await getDatabase();
  return db.selectFrom("contact_invites").select(["uses", "last_used_at"]).where("id", "=", id).executeTakeFirstOrThrow();
}

/** Every string an element tree carries in its props, `type`s left out (they are circular module objects). */
function flat(node: unknown, seen = new Set<unknown>()): string {
  if (typeof node === "string") return node;
  if (!node || typeof node !== "object" || seen.has(node)) return "";
  seen.add(node);
  const entries = Array.isArray(node) ? node : Object.entries(node).filter(([k]) => k !== "type" && k !== "_owner" && k !== "_store").map(([, v]) => v);
  return entries.map((v) => flat(v, seen)).join(" ");
}

async function page(code: string) {
  const { default: Page } = await import("@/app/t/[code]/page");
  return Page({ params: Promise.resolve({ code }) } as never);
}

async function press(code: string, init: { token?: string | null; origin?: string | null }) {
  const { POST } = await import("@/app/t/[code]/open/route");
  const { openToken } = await import("@/lib/tripLink");
  const body = new URLSearchParams();
  const token = init.token === undefined ? openToken(code) : init.token;
  if (token !== null) body.set("token", token);
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded", host: "example.test" };
  if (init.origin !== null) headers.origin = init.origin ?? "https://example.test";
  return POST(new Request(`https://example.test/t/${code}/open`, { method: "POST", headers, body }), {
    params: Promise.resolve({ code }),
  } as never);
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-tldoors-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.CONTACTS_ENCRYPTION_KEY = "44".repeat(32);
  process.env.SESSION_SECRET = "55".repeat(32);
  writeConfigs();
  for (const [id, visibility] of [[GUEST_TRIP, "guest"], [PRIVATE_TRIP, "private"]] as const) {
    writeTripFixture(OWNER, { id, title: id, start: "2026-08-25", end: "2026-08-26", status: "past", visibility });
  }
  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  clearConfigCache();
  clearUserCache();
});

beforeEach(async () => {
  jar.cookies = {};
  jar.ip = `203.0.113.${100 + Math.floor(Math.random() * 100)}`;
  const { resetRateLimitsForTests } = await import("@/lib/rateLimit");
  resetRateLimitsForTests();
});

afterAll(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  for (const k of ["CONTENT_DIR", "DATABASE_URL", "CONTACTS_ENCRYPTION_KEY", "SESSION_SECRET"]) delete process.env[k];
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("AC3 — a GET acts on nothing; the press needs a token and a strict Origin", () => {
  test("GET /t/<code> writes no use, no time, no cookie", async () => {
    const link = await mint(GUEST_TRIP);
    const before = await counts(link.id);
    const el = await page(link.readCode!);
    expect(flat(el)).toContain("shared a trip with you");
    expect(await counts(link.id)).toEqual(before);
    expect(before.uses).toBe(0);
    expect(jar.cookies).toEqual({});
  });

  test("the press without the token, with a wrong one, with no Origin or a foreign one answers 403", async () => {
    const link = await mint(GUEST_TRIP);
    const code = link.readCode!;
    for (const init of [
      { token: null },
      { token: "0".repeat(64) },
      { origin: null },
      { origin: "https://evil.example" },
    ]) {
      expect((await press(code, init)).status).toBe(403);
    }
    expect((await counts(link.id)).uses).toBe(0);
    expect(jar.cookies).toEqual({});
  });

  test("a good press sets the cookie, counts once, stamps the time and lands on the trip", async () => {
    const link = await mint(GUEST_TRIP);
    const res = await press(link.readCode!, {});
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/@${OWNER}/trips/${GUEST_TRIP}`);
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    const { LINK_COOKIE, linkCookieValue } = await import("@/lib/tripLink");
    expect(jar.cookies[LINK_COOKIE]).toBe(linkCookieValue(link.id, link.readCode!));
    const after = await counts(link.id);
    expect(after.uses).toBe(1);
    expect(after.last_used_at).not.toBeNull();
  });

  test("someone who already reads the trip is sent straight on, nothing stored", async () => {
    const link = await mint(GUEST_TRIP);
    await press(link.readCode!, {}); // now holds the cookie
    const before = await counts(link.id);
    await expect(page(link.readCode!)).rejects.toThrow(`REDIRECT /@${OWNER}/trips/${GUEST_TRIP}`);
    expect(await counts(link.id)).toEqual(before);
  });

  test("unknown, stopped, expired, trip-not-guest, join-code and rate-limited all render the one refusal", async () => {
    const stopped = await mint(GUEST_TRIP);
    const { revokeInvite } = await import("@/lib/contacts/invites");
    await revokeInvite(OWNER, stopped.id);
    const expired = await mint(GUEST_TRIP, "read", { expiresAt: new Date(Date.now() - 1000).toISOString() });
    const priv = await mint(PRIVATE_TRIP);
    const guest = await mint(GUEST_TRIP, "guest");
    const { joinCodeFor } = await import("@/lib/contacts/welcome");
    const joinCode = await joinCodeFor(OWNER, guest.id);
    expect(joinCode).toMatch(/^[2-9a-z]{10}$/);

    const dead = ["abcdefghjkmnpqrs", stopped.readCode!, expired.readCode!, priv.readCode!, joinCode!];
    const rendered = await Promise.all(dead.map(async (c) => flat(await page(c))));
    expect(new Set(rendered).size).toBe(1);
    expect(rendered[0]).toContain("stopped working");

    // And so is the 31st lookup from one address, even for a live code.
    const live = await mint(GUEST_TRIP);
    let last = "";
    for (let i = 0; i < 31; i++) last = flat(await page(live.readCode!).catch(() => "redirect"));
    expect(last).toBe(rendered[0]);
  });
});

describe("AC4 — the two code families never open each other's doors", () => {
  test("/j/<readcode> is the refusal; withJoinUrls and joinCodeFor never mint for a read link", async () => {
    const link = await mint(GUEST_TRIP);
    const { resolveJoinCode, joinCodeFor, withJoinUrls } = await import("@/lib/contacts/welcome");
    expect(await resolveJoinCode(link.readCode!)).toBeNull();
    expect(await joinCodeFor(OWNER, link.id)).toBeNull();
    const { listInvites } = await import("@/lib/contacts/invites");
    const [row] = await withJoinUrls(OWNER, (await listInvites(OWNER)).filter((i) => i.id === link.id));
    expect(row.joinUrl).toBeNull();
    const { getDatabase } = await import("@/lib/db");
    const { db } = await getDatabase();
    const stored = await db.selectFrom("contact_invites").select(["join_code_hash", "join_code_cipher"]).where("id", "=", link.id).executeTakeFirstOrThrow();
    expect(stored).toEqual({ join_code_hash: null, join_code_cipher: null });
    const { JoinPage } = { JoinPage: (await import("@/app/j/[code]/page")).default };
    const el = flat(await JoinPage({ params: Promise.resolve({ code: link.readCode! }) } as never));
    expect(el).toContain("stopped working");
  });

  test("a read code is 16 characters from the welcome alphabet and its cipher opens only with its own AAD", async () => {
    const link = await mint(GUEST_TRIP);
    expect(link.readCode).toMatch(/^[23456789abcdefghjkmnpqrstuvwxyz]{16}$/);
    const { getDatabase } = await import("@/lib/db");
    const { db } = await getDatabase();
    const row = await db.selectFrom("contact_invites").select(["read_code_cipher"]).where("id", "=", link.id).executeTakeFirstOrThrow();
    const { decryptString } = await import("@/lib/contacts/crypto");
    const { readAad } = await import("@/lib/contacts/invites");
    expect(decryptString(row.read_code_cipher!, readAad(OWNER, link.id), "invite token")).toBe(link.readCode);
    expect(decryptString(row.read_code_cipher!, `join:${OWNER}:${link.id}`, "invite token")).toBeNull();
  });

  test("an unknown kind reads as personal, never buddy or read", async () => {
    const { getDatabase } = await import("@/lib/db");
    const { db } = await getDatabase();
    const link = await mint(GUEST_TRIP);
    await db.updateTable("contact_invites").set({ kind: "read2" }).where("id", "=", link.id).execute();
    const { listInvites } = await import("@/lib/contacts/invites");
    const row = (await listInvites(OWNER)).find((i) => i.id === link.id)!;
    expect(row.kind).toBe("personal");
    expect(row.tripId).toBeNull();
    const { resolveReadCode } = await import("@/lib/tripLink");
    expect(await resolveReadCode(link.readCode!)).toBeNull();
  });

  test("a read link has no expiry only when the owner says so", async () => {
    const { createInvite } = await import("@/lib/contacts/invites");
    const dflt = await createInvite(OWNER, { kind: "read", tripId: GUEST_TRIP });
    expect(dflt.expiresAt).not.toBeNull();
    const never = await createInvite(OWNER, { kind: "read", tripId: GUEST_TRIP, neverExpires: true });
    expect(never.expiresAt).toBeNull();
    await expect(createInvite(OWNER, { kind: "read" })).rejects.toThrow();
  });

  test("with contacts off, /t/<code> is the refusal", async () => {
    const link = await mint(GUEST_TRIP);
    const live = flat(await page(link.readCode!).catch(() => "redirect"));
    expect(live).toContain("shared a trip with you");
    writeConfigs(false);
    const { clearConfigCache } = await import("@/lib/config");
    const { clearUserCache } = await import("@/lib/users");
    clearConfigCache();
    clearUserCache();
    expect(flat(await page(link.readCode!))).toContain("stopped working");
    writeConfigs(true);
    clearConfigCache();
    clearUserCache();
  });
});

describe("AC6 — the code never reaches the request log", () => {
  test("/t/<code> and anything below it log as /t/•", async () => {
    const { formatRequestLine } = await import("@/lib/requestLog");
    const code = "abcdefghjkmnpqrs";
    for (const p of [`/t/${code}`, `/t/${code}/open`]) {
      const line = formatRequestLine("POST", p, "ua");
      expect(line).not.toContain(code);
      expect(line).toContain("/t/•");
    }
    expect(formatRequestLine("GET", "/j/abc", "ua")).toContain("/j/abc");
  });
});

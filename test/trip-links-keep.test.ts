import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { writeTripFixture } from "./fixtures/content";

/**
 * Trip links, keeping — B-2962 (AC1-AC6). A proved address keeps the trip as a
 * waiting contact and a keep row, and nothing else: no grant, no place, no
 * group. Blocked people get the neutral answer; a keeper reads the guest trip
 * at reader level until Decline or Take access away ends it.
 */

const jar = vi.hoisted(() => ({ cookies: {} as Record<string, string>, ip: "203.0.113.80" }));
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
  headers: async () => new Headers({ "x-forwarded-for": jar.ip }),
}));

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
const TRIP = "alps-2026";
const PERSON = "pia@example.test";
let dir: string;

function writeConfigs() {
  const features = { auth: { enabled: true }, contacts: { enabled: true }, mail: { enabled: true, transport: "file" } };
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "R", url: "https://example.test", defaultUser: OWNER }, users: { reserved: [] }, features }),
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
      features: { auth: { enabled: true }, contacts: { enabled: true } },
    }),
  );
}

type Link = { id: string; code: string };
async function mint(): Promise<Link> {
  const { createInvite } = await import("@/lib/contacts/invites");
  const made = await createInvite(OWNER, { kind: "read", tripId: TRIP });
  return { id: made.id, code: made.readCode! };
}

async function keepPost(
  code: string,
  body: Record<string, unknown>,
  init: { token?: string | null; origin?: string | null } = {},
) {
  const { POST } = await import("@/app/t/[code]/keep/route");
  const { openToken } = await import("@/lib/tripLink");
  const token = init.token === undefined ? openToken(code) : init.token;
  const headers: Record<string, string> = { "content-type": "application/json", host: "example.test" };
  if (init.origin !== null) headers.origin = init.origin ?? "https://example.test";
  return POST(
    new Request(`https://example.test/t/${code}/keep`, {
      method: "POST",
      headers,
      body: JSON.stringify(token === null ? body : { ...body, token }),
    }),
    { params: Promise.resolve({ code }) },
  );
}

/** Prove `email` with a real code and keep through `link`. */
async function proveAndKeep(link: Link, email: string, extra: Record<string, unknown> = {}) {
  const { issueCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, email, "guest");
  return keepPost(link.code, { action: "verify", email, code, name: "Pia", ...extra });
}

async function db() {
  const { getDatabase } = await import("@/lib/db");
  return (await getDatabase()).db;
}
const keepRows = async () => (await db()).selectFrom("trip_link_keeps").selectAll().execute();
const contactOf = async (email: string) => {
  const { getContactByEmail } = await import("@/lib/contacts");
  return getContactByEmail(OWNER, email);
};

async function reads(): Promise<boolean> {
  const { getTrip, tripRef } = await import("@/lib/trips");
  const { mayReadTrip } = await import("@/lib/tripGate");
  return mayReadTrip(getTrip(tripRef(OWNER, TRIP))!);
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-tlkeep-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.CONTACTS_ENCRYPTION_KEY = "44".repeat(32);
  process.env.SESSION_SECRET = "55".repeat(32);
  writeConfigs();
  writeTripFixture(OWNER, { id: TRIP, title: "Alps", start: "2026-08-25", end: "2026-08-26", status: "past", visibility: "guest" });
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
  const d = await db();
  await d.deleteFrom("trip_link_keeps").execute();
  await d.deleteFrom("contacts").execute();
});

afterAll(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  for (const k of ["CONTENT_DIR", "DATA_DIR", "DATABASE_URL", "CONTACTS_ENCRYPTION_KEY", "SESSION_SECRET"]) delete process.env[k];
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("AC1 — a proved address keeps the trip and nothing more", () => {
  test("send mails a code and writes nothing about anybody", async () => {
    const link = await mint();
    const res = await keepPost(link.code, { action: "send", email: PERSON, name: "Pia" });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(await contactOf(PERSON)).toBeNull();
    expect(await keepRows()).toEqual([]);
  });

  test("verify files a pending contact, one keep row, no grant, no place, no group", async () => {
    const link = await mint();
    const res = await proveAndKeep(link, PERSON);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, kept: true });

    const contact = await contactOf(PERSON);
    expect(contact).toMatchObject({ status: "pending", name: "Pia", createdVia: `read:${link.id}`, wantsEmailDigest: false });
    const rows = await keepRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ owner_id: OWNER, trip_id: TRIP, invite_id: link.id, contact_id: contact!.id, revoked_at: null });

    const d = await db();
    expect(await d.selectFrom("access_grants").selectAll().execute()).toEqual([]);
    expect(await d.selectFrom("trip_people").selectAll().execute()).toEqual([]);
    const row = await d.selectFrom("contacts").select(["group_id", "asked_group_id"]).where("id", "=", contact!.id).executeTakeFirstOrThrow();
    expect(row).toEqual({ group_id: null, asked_group_id: null });

    // Pressing the same keep again is one row still.
    await proveAndKeep(link, PERSON);
    expect(await keepRows()).toHaveLength(1);
  });

  test("day mail only when ticked; an existing contact's details stay as they are", async () => {
    const link = await mint();
    await proveAndKeep(link, PERSON, { wantsDayMail: true });
    expect((await contactOf(PERSON))!.wantsEmailDigest).toBe(true);

    const { requestContact, approveContact } = await import("@/lib/contacts");
    const other = "otto@example.test";
    const filed = await requestContact(OWNER, {
      name: "Otto Old", email: other, locale: "en", wantsEmailDigest: false, wantsPostcard: false, createdVia: "owner",
    });
    const { confirmContactFromSession } = await import("@/lib/contacts");
    await confirmContactFromSession(OWNER, other);
    await approveContact(OWNER, filed.contactId!);
    await proveAndKeep(link, other, { name: "Someone Else" });
    const after = (await contactOf(other))!;
    expect(after).toMatchObject({ name: "Otto Old", status: "active", createdVia: "owner", wantsEmailDigest: false });
    expect(await keepRows()).toHaveLength(2);
  });

  test("join keeps for an address already signed in, with no second code", async () => {
    const link = await mint();
    const { issueCode } = await import("@/lib/auth");
    const { verifyGuestCode } = await import("@/lib/contacts/guestCode");
    const { setGuestSessionCookies } = await import("@/lib/auth/identityCookie");
    const { code } = await issueCode(OWNER, PERSON, "guest");
    const session = (await verifyGuestCode(OWNER, PERSON, code))!;
    await setGuestSessionCookies(session.token, session.subject, null);
    const res = await keepPost(link.code, { action: "join", name: "Pia" });
    expect(res.status).toBe(200);
    expect(await keepRows()).toHaveLength(1);
    expect(await contactOf(PERSON)).toMatchObject({ status: "pending" });
  });
});

describe("AC2 — a blocked person gets the neutral answer and no keep", () => {
  test("same body shape, no row, contact stays blocked", async () => {
    const { requestContact, revokeContact } = await import("@/lib/contacts");
    const link = await mint();
    const ok = await (await proveAndKeep(link, "new@example.test")).json();
    const filed = await requestContact(OWNER, {
      name: "Bo", email: PERSON, locale: "en", wantsEmailDigest: false, wantsPostcard: false, createdVia: "owner",
    });
    await revokeContact(OWNER, filed.contactId!);
    const before = (await keepRows()).length;

    const res = await proveAndKeep(link, PERSON);
    expect(res.status).toBe(200);
    expect(Object.keys(await res.json()).sort()).toEqual(Object.keys(ok).sort());
    expect(await keepRows()).toHaveLength(before);
    expect((await contactOf(PERSON))!.status).toBe("blocked");
  });
});

describe("AC3 — two links, two rows", () => {
  test("stopping one link leaves the other keep", async () => {
    const a = await mint();
    const b = await mint();
    await proveAndKeep(a, PERSON);
    await proveAndKeep(b, PERSON);
    const rows = await keepRows();
    expect(rows.map((r) => r.invite_id).sort()).toEqual([a.id, b.id].sort());
    const { revokeInvite } = await import("@/lib/contacts/invites");
    await revokeInvite(OWNER, a.id);
    expect((await keepRows()).filter((r) => r.revoked_at === null)).toHaveLength(2);
    // A stopped link keeps nobody new.
    const late = await proveAndKeep(a, "late@example.test");
    expect(late.status).toBe(404);
    expect(await contactOf("late@example.test")).toBeNull();
  });
});

describe("AC4 — a keeper reads after Stop, not after Decline", () => {
  test("reads once kept (also after the link stops); Decline ends it and letting in later does not revive it", async () => {
    const link = await mint();
    await proveAndKeep(link, PERSON); // signed in as PERSON now, no link cookie
    expect(await reads()).toBe(true);
    const { revokeInvite } = await import("@/lib/contacts/invites");
    await revokeInvite(OWNER, link.id);
    expect(await reads()).toBe(true);

    const { revokeContact, approveContact } = await import("@/lib/contacts");
    const contact = (await contactOf(PERSON))!;
    await revokeContact(OWNER, contact.id);
    expect(await reads()).toBe(false);
    const [row] = await keepRows();
    expect(row.revoked_at).not.toBeNull();

    await approveContact(OWNER, contact.id);
    expect((await keepRows())[0].revoked_at).toBe(row.revoked_at);
  });
});

describe("AC5 — GET /api/v2/me/home reports the held link", () => {
  test("link block for the cookie holder, none for others, private and no-store", async () => {
    const link = await mint();
    const { GET } = await import("@/app/api/v2/me/home/route");
    const none = await GET();
    expect(none.headers.get("cache-control")).toBe("private, no-store");
    expect((await none.json()).link).toBeNull();

    const { LINK_COOKIE, linkCookieValue } = await import("@/lib/tripLink");
    jar.cookies = { [LINK_COOKIE]: linkCookieValue(link.id, link.code) };
    const res = await GET();
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect((await res.json()).link).toMatchObject({ ownerName: "Ana", tripTitle: "Alps", keepPath: `/t/${link.code}`, kept: false });

    // A stopped link is no link.
    const { revokeInvite } = await import("@/lib/contacts/invites");
    await revokeInvite(OWNER, link.id);
    expect((await (await GET()).json()).link).toBeNull();
  });
});

describe("AC6 — the keep door's guards", () => {
  test("missing or foreign Origin and missing or wrong token are refused", async () => {
    const link = await mint();
    const body = { action: "send", email: PERSON, name: "Pia" };
    expect((await keepPost(link.code, body, { origin: null })).status).toBe(403);
    expect((await keepPost(link.code, body, { origin: "https://evil.example" })).status).toBe(403);
    expect((await keepPost(link.code, body, { token: null })).status).toBe(403);
    expect((await keepPost(link.code, body, { token: "0".repeat(64) })).status).toBe(403);
    expect((await keepPost(link.code, body)).status).toBe(200);
  });

  test("the link is the path code only: a code in the body is ignored, a dead path code is refused", async () => {
    const live = await mint();
    const res = await keepPost("abcdefghjkmnpqrs", { action: "send", email: PERSON, name: "Pia", code: live.code, inviteId: live.id });
    expect(res.status).toBe(404);
    expect(await keepRows()).toEqual([]);
  });
});

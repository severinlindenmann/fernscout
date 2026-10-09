import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { writeTripFixture } from "./fixtures/content";
import { hasPaid } from "./support/openCore";

/**
 * B-2942 - a guest on a reader link proves a mobile number by an SMS code or
 * by a WhatsApp message-in and is let in exactly as an email proof would be.
 * Everything is dry-run: texts land in <dataDir>/sms, no WhatsApp is sent.
 */

const jar = vi.hoisted(() => ({ cookies: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.cookies[name] === undefined ? undefined : { value: jar.cookies[name] }),
    set: (name: string, value: string) => {
      jar.cookies[name] = value;
    },
  }),
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.50" }),
}));

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
const TRIP = "hike-2026";
const INSTANCE_NUMBER = "+41760000099";
let dir: string;
let ipCounter = 0;

function writeConfigs(overrides: { sms?: boolean; whatsapp?: boolean } = {}) {
  const sms = overrides.sms ?? true;
  const whatsapp = overrides.whatsapp ?? true;
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: {
        auth: { enabled: true },
        contacts: { enabled: true },
        mail: { enabled: true, transport: "file" },
        sms: { enabled: sms, backend: "dry-run" },
        whatsapp: { enabled: whatsapp, backend: "dry-run", number: INSTANCE_NUMBER },
        whatsappInbound: { enabled: whatsapp },
      },
    }),
  );
  fs.mkdirSync(path.join(dir, OWNER), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Two Backpacks",
      owner: { name: "Ana Meyer", nickname: "Ana", email: OWNER_EMAIL },
      defaultLocale: "en",
      locales: ["en", "de"],
      baseCurrency: "CHF",
      features: { auth: { enabled: true }, contacts: { enabled: true } },
    }),
  );
}

async function reloadConfig() {
  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  clearConfigCache();
  clearUserCache();
}

function texts(): { to: string; body: string }[] {
  const smsDir = path.join(dir, "sms");
  if (!fs.existsSync(smsDir)) return [];
  return fs.readdirSync(smsDir).sort().map((f) => JSON.parse(fs.readFileSync(path.join(smsDir, f), "utf8")));
}
const lastText = (digits: string) => texts().filter((t) => t.to === digits).at(-1)?.body ?? "";
const codeIn = (body: string) => body.match(/(?<![#\w])(\d{6})(?!\w)/)?.[1] ?? "";

function post(url: string, body: unknown, ip?: string) {
  return new Request(`https://example.test${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip ?? `203.0.113.${(ipCounter++ % 200) + 1}` },
    body: JSON.stringify(body),
  });
}

async function joinStep(code: string, body: Record<string, unknown>, ip?: string) {
  const { POST } = await import("@/app/j/[code]/step/route");
  const res = await POST(post(`/j/${code}/step`, body, ip), { params: Promise.resolve({ code }) });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

async function signInOwner() {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, OWNER_EMAIL, "guest");
  const session = await verifyCode(OWNER, OWNER_EMAIL, code, "guest");
  if (!session.ok) throw new Error("owner sign-in failed");
  jar.cookies = { fs_session: session.token };
}

async function newLink(body: Record<string, unknown>): Promise<string> {
  await signInOwner();
  const { POST } = await import("@/app/api/web/[user]/invites/route");
  const res = await POST(post(`/api/web/${OWNER}/invites`, body), { params: Promise.resolve({ user: OWNER }) });
  expect(res.status).toBe(201);
  jar.cookies = {};
  return ((await res.json()) as { joinUrl: string }).joinUrl.split("/j/")[1];
}

async function holder(subject: string) {
  const { getContactByEmail } = await import("@/lib/contacts");
  return getContactByEmail(OWNER, subject);
}

async function contactCount() {
  const { getDatabase } = await import("@/lib/db");
  const { db } = await getDatabase();
  return (await db.selectFrom("contacts").select("id").where("owner_id", "=", OWNER).execute()).length;
}

/** Text a code to `number` and redeem it. */
async function proveBySms(code: string, number: string, name = "Mira") {
  const sent = await joinStep(code, { action: "send", channel: "sms", name, value: number, locale: "en" });
  expect(sent.status).toBe(200);
  const digits = number.replace(/\D/g, "");
  return joinStep(code, { action: "verify", channel: "sms", name, value: number, code: codeIn(lastText(digits)), locale: "en" });
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-b2942-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.CONTACTS_ENCRYPTION_KEY = "66".repeat(32);
  process.env.SESSION_SECRET = "77".repeat(32);
  process.env.WHATSAPP_APP_SECRET = "test-secret";
  process.env.WHATSAPP_VERIFY_TOKEN = "test-verify";
  writeConfigs();
  writeTripFixture(OWNER, {
    id: TRIP,
    title: "Iceland 2026",
    start: "2026-08-25",
    end: "2026-08-26",
    status: "past",
    visibility: "private",
    costsVisibility: "guests",
    people: [],
  });
  await reloadConfig();
});

beforeEach(async () => {
  const { resetRateLimitsForTests } = await import("@/lib/rateLimit");
  resetRateLimitsForTests();
  jar.cookies = {};
});

afterAll(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  for (const key of ["CONTENT_DIR", "DATA_DIR", "DATABASE_URL", "CONTACTS_ENCRYPTION_KEY", "SESSION_SECRET", "WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN"]) {
    delete process.env[key];
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("SMS proof on a reader link", () => {
  test("a new person is let in, signed in as the number, and the text ends with the @host #code line", async () => {
    const code = await newLink({ kind: "guest", name: "Group" });
    const done = await proveBySms(code, "+41 79 123 45 67");
    expect(done.json).toMatchObject({ ok: true, status: "in", known: false });
    const body = lastText("41791234567");
    expect(body.trimEnd().split("\n").at(-1)).toBe(`@example.test #${codeIn(body)}`);
    expect(codeIn(body)).toMatch(/^\d{6}$/);
    expect(jar.cookies.fs_session).toBeTruthy();
    const person = await holder("+41791234567");
    expect(person).toMatchObject({ status: "active", name: "Mira" });
    expect(person?.email).toBe("");
    expect(person?.phoneProvenAt).toBeTruthy();
    expect(person?.createdVia).toMatch(/^invite:/);
  });

  test("a wrong code signs nobody in and creates nobody", async () => {
    const code = await newLink({ kind: "guest", name: "Group" });
    const before = await contactCount();
    await joinStep(code, { action: "send", channel: "sms", name: "Mira", value: "+41 79 222 33 44", locale: "en" });
    const wrong = await joinStep(code, { action: "verify", channel: "sms", name: "Mira", value: "+41 79 222 33 44", code: "000000", locale: "en" });
    expect(wrong.status).toBe(401);
    expect(jar.cookies.fs_session).toBeUndefined();
    expect(await contactCount()).toBe(before);
  });

  test("a returning number finds its contact and makes no second one", async () => {
    const code = await newLink({ kind: "guest", name: "Group" });
    await proveBySms(code, "+41 79 300 00 01");
    const count = await contactCount();
    jar.cookies = {};
    const again = await proveBySms(code, "+41 79 300 00 01");
    expect(again.json).toMatchObject({ ok: true, status: "in", known: true });
    expect(await contactCount()).toBe(count);
  });

  test("an unreadable number is a 400 and nothing is texted", async () => {
    const code = await newLink({ kind: "guest", name: "Group" });
    const before = texts().length;
    const res = await joinStep(code, { action: "send", channel: "sms", name: "Mira", value: "hello", locale: "en" });
    expect(res).toMatchObject({ status: 400, json: { error: "invalid_phone" } });
    expect(texts().length).toBe(before);
  });

  test("a country outside the allowlist is refused before anything is texted", async () => {
    const code = await newLink({ kind: "guest", name: "Group" });
    const before = texts().length;
    const res = await joinStep(code, { action: "send", channel: "sms", name: "Mira", value: "+1 415 555 0100", locale: "en" });
    expect(res).toMatchObject({ status: 400, json: { error: "unsupported_country" } });
    expect(texts().length).toBe(before);
  });

  test("per number: the fourth text in an hour is refused", async () => {
    const code = await newLink({ kind: "guest", name: "Group" });
    const send = (ip: string) => joinStep(code, { action: "send", channel: "sms", name: "Mira", value: "+41 79 400 00 01", locale: "en" }, ip);
    for (const ip of ["198.51.100.1", "198.51.100.2", "198.51.100.3"]) expect((await send(ip)).status).toBe(200);
    expect((await send("198.51.100.4")).status).toBe(429);
  });

  test("a trunk 0 after the country code is the same number, not a fresh bucket (security review)", async () => {
    const code = await newLink({ kind: "guest", name: "Group" });
    const send = (value: string, ip: string) => joinStep(code, { action: "send", channel: "sms", name: "Mira", value, locale: "en" }, ip);
    expect((await send("+41 79 410 00 01", "198.51.100.11")).status).toBe(200);
    expect((await send("+41 (0)79 410 00 01", "198.51.100.12")).status).toBe(200);
    expect((await send("+41 079 410 00 01", "198.51.100.13")).status).toBe(200);
    expect((await send("+41 79 410 00 01", "198.51.100.14")).status).toBe(429);
  });

  test("a premium-rate range inside an allowed country is refused before anything is texted", async () => {
    const code = await newLink({ kind: "guest", name: "Group" });
    const before = texts().length;
    const res = await joinStep(code, { action: "send", channel: "sms", name: "Mira", value: "+41 900 123 456", locale: "en" });
    expect(res).toMatchObject({ status: 400, json: { error: "unsupported_country" } });
    expect(texts().length).toBe(before);
  });

  test("per IP: the sixth number from one address is refused", async () => {
    const code = await newLink({ kind: "guest", name: "Group" });
    const send = (n: number) =>
      joinStep(code, { action: "send", channel: "sms", name: "Mira", value: `+4179500000${n}`, locale: "en" }, "198.51.100.77");
    for (let n = 1; n <= 5; n++) expect((await send(n)).status).toBe(200);
    expect((await send(6)).status).toBe(429);
  });

  test("per link and per instance: the buckets close", async () => {
    const { smsJoinAllowed, resetRateLimitsForTests } = await import("@/lib/rateLimit");
    resetRateLimitsForTests();
    let linkOk = 0;
    for (let i = 0; i < 60; i++) if (smsJoinAllowed(`4179600${String(i).padStart(4, "0")}`, `10.0.0.${i}`, "link-a")) linkOk++;
    expect(linkOk).toBe(50);
    resetRateLimitsForTests();
    let instanceOk = 0;
    for (let i = 0; i < 220; i++) if (smsJoinAllowed(`4179700${String(i).padStart(4, "0")}`, `10.1.${i}.1`, `link-${i}`)) instanceOk++;
    expect(instanceOk).toBe(200);
  });

  test("a blocked number is answered like anybody else and stays blocked", async () => {
    const code = await newLink({ kind: "guest", name: "Group" });
    const { addContact } = await import("@/lib/contacts");
    const added = await addContact(OWNER, { name: "Blocked", phone: "+41 79 800 00 01", locale: "en", createdVia: "owner" });
    if (!added.ok) throw new Error("add failed");
    const { getDatabase } = await import("@/lib/db");
    const { db } = await getDatabase();
    await db.updateTable("contacts").set({ status: "blocked" }).where("id", "=", added.contact.id).execute();
    const done = await proveBySms(code, "+41 79 800 00 01", "Blocked");
    expect(done.json).toMatchObject({ ok: true, status: "waiting", known: true });
    expect((await holder("+41798000001"))?.status).toBe("blocked");
  });

  test("a buddy link never auto-admits a phone proof", async () => {
    const code = await newLink({ kind: "buddy", name: "Crew", trip: TRIP });
    const done = await proveBySms(code, "+41 79 900 00 01");
    expect(done.json).toMatchObject({ ok: true, status: "waiting" });
    expect((await holder("+41799000001"))?.status).toBe("pending");
  });

  test("a link mailed to one address never auto-admits a phone proof", async () => {
    const { resolveJoinCode } = await import("@/lib/contacts/welcome");
    const { POST } = await import("@/app/api/web/[user]/invites/route");
    await signInOwner();
    const res = await POST(post(`/api/web/${OWNER}/invites`, { kind: "guest", name: "One", email: "someone@example.test" }), {
      params: Promise.resolve({ user: OWNER }),
    });
    const joinUrl = ((await res.json()) as { joinUrl?: string }).joinUrl;
    jar.cookies = {};
    expect(joinUrl).toBeTruthy();
    const code = joinUrl!.split("/j/")[1];
    expect((await resolveJoinCode(code))?.emailKey).toBe("someone@example.test");
    const done = await proveBySms(code, "+41 79 910 00 01");
    expect(done.json).toMatchObject({ ok: true, status: "waiting" });
    expect((await holder("+41799100001"))?.status).toBe("pending");
  });

  test("SMS off: the option is absent and the send is refused", async () => {
    const code = await newLink({ kind: "guest", name: "Group" });
    writeConfigs({ sms: false });
    await reloadConfig();
    try {
      const { joinSmsAvailable } = await import("@/lib/contacts/guestPhone");
      expect(await joinSmsAvailable()).toBe(false);
      const before = texts().length;
      const res = await joinStep(code, { action: "send", channel: "sms", name: "Mira", value: "+41 79 123 45 68", locale: "en" });
      expect(res.status).toBe(503);
      expect(texts().length).toBe(before);
    } finally {
      writeConfigs();
      await reloadConfig();
    }
  });
});

// The inbound WhatsApp webhook is a paid feature: without paid/ (public CI) the option is absent by design.
describe.skipIf(!hasPaid())("WhatsApp message-in on a reader link", () => {
  async function start(code: string, number: string) {
    return joinStep(code, { action: "wa-start", name: "Mira", value: number, locale: "en" });
  }
  const tokenOf = (text: string) => text.match(/FS-[A-Z0-9]{8}/)![0];

  test("the sender must be the typed number; then the person is let in", async () => {
    const code = await newLink({ kind: "guest", name: "Group" });
    const started = await start(code, "+41 79 111 22 33");
    expect(started.status).toBe(200);
    expect(String(started.json.link)).toMatch(/^https:\/\/wa\.me\/41760000099\?text=/);
    expect(jar.cookies.fs_wa_join).toBeTruthy();
    const id = String(started.json.id);

    expect((await joinStep(code, { action: "wa-poll", id })).json).toEqual({ status: "pending" });
    const { claimPhoneLink } = await import("@/lib/phoneVerify/inboundLink");
    expect(await claimPhoneLink(String(started.json.text), "41791112233")).toMatchObject({ outcome: "confirmed" });
    const done = await joinStep(code, { action: "wa-poll", id });
    expect(done.json).toMatchObject({ ok: true, status: "in", known: false });
    expect((await holder("+41791112233"))?.status).toBe("active");
    expect(jar.cookies.fs_session).toBeTruthy();

    // single use: the token and the poll are both spent
    expect(await claimPhoneLink(String(started.json.text), "41791112233")).toMatchObject({ outcome: "expired" });
    expect((await joinStep(code, { action: "wa-poll", id })).json).toEqual({ status: "expired" });
  });

  test("a message from a different number is a mismatch, signs nobody in, and burns the row", async () => {
    const code = await newLink({ kind: "guest", name: "Group" });
    const before = await contactCount();
    const started = await start(code, "+41 79 111 22 44");
    const id = String(started.json.id);
    const { claimPhoneLink } = await import("@/lib/phoneVerify/inboundLink");
    await claimPhoneLink(String(started.json.text), "41790000000");
    expect((await joinStep(code, { action: "wa-poll", id })).json).toEqual({ status: "mismatch" });
    expect((await joinStep(code, { action: "wa-poll", id })).json).toEqual({ status: "expired" });
    expect(jar.cookies.fs_session).toBeUndefined();
    expect(await contactCount()).toBe(before);
  });

  test("a blocked number that sends the message is answered like anybody and stays blocked (security review)", async () => {
    const code = await newLink({ kind: "guest", name: "Group" });
    const { addContact } = await import("@/lib/contacts");
    const added = await addContact(OWNER, { name: "Blocked", phone: "+41 79 111 22 77", locale: "en", createdVia: "owner" });
    if (!added.ok) throw new Error("add failed");
    const { getDatabase } = await import("@/lib/db");
    const { db } = await getDatabase();
    await db.updateTable("contacts").set({ status: "blocked" }).where("id", "=", added.contact.id).execute();
    const started = await start(code, "+41 79 111 22 77");
    const { claimPhoneLink } = await import("@/lib/phoneVerify/inboundLink");
    await claimPhoneLink(String(started.json.text), "41791112277");
    const done = await joinStep(code, { action: "wa-poll", id: String(started.json.id) });
    expect(done.json).toMatchObject({ ok: true, status: "waiting", known: true });
    expect((await holder("+41791112277"))?.status).toBe("blocked");
  });

  test("another browser cannot collect the proof, and the owner's browser still can", async () => {
    const code = await newLink({ kind: "guest", name: "Group" });
    const started = await start(code, "+41 79 111 22 55");
    const id = String(started.json.id);
    const mine = jar.cookies.fs_wa_join;
    const { claimPhoneLink } = await import("@/lib/phoneVerify/inboundLink");
    await claimPhoneLink(String(started.json.text), "41791112255");

    jar.cookies = {};
    expect((await joinStep(code, { action: "wa-poll", id })).json).toEqual({ status: "expired" });
    jar.cookies = { fs_wa_join: "somebody-elses-secret" };
    expect((await joinStep(code, { action: "wa-poll", id })).json).toEqual({ status: "expired" });
    expect(jar.cookies.fs_session).toBeUndefined();
    expect(await holder("+41791112255")).toBeNull();

    jar.cookies = { fs_wa_join: mine };
    expect((await joinStep(code, { action: "wa-poll", id })).json).toMatchObject({ ok: true, status: "in" });
  });

  test("a join row never records a pending signup proof", async () => {
    const code = await newLink({ kind: "guest", name: "Group" });
    const started = await start(code, "+41 79 111 22 66");
    const { claimPhoneLink } = await import("@/lib/phoneVerify/inboundLink");
    await claimPhoneLink(tokenOf(String(started.json.text)) + " hi", "41791112266");
    const { getDatabase } = await import("@/lib/db");
    const { db } = await getDatabase();
    const rows = await db.selectFrom("login_codes").select(["kind"]).where("kind", "=", "phone-link").where("trip_id", "like", "join:%").execute();
    expect(rows.length).toBeGreaterThan(0);
  });

  test("an unreadable number is a 400", async () => {
    const code = await newLink({ kind: "guest", name: "Group" });
    expect((await start(code, "nope")).status).toBe(400);
  });

  test("WhatsApp off: wa-start and wa-poll answer 404 and the capability is false", async () => {
    const code = await newLink({ kind: "guest", name: "Group" });
    writeConfigs({ whatsapp: false });
    await reloadConfig();
    try {
      const { joinWhatsappAvailable } = await import("@/lib/contacts/guestPhone");
      expect(joinWhatsappAvailable()).toBe(false);
      expect((await start(code, "+41 79 111 22 77")).status).toBe(404);
      expect((await joinStep(code, { action: "wa-poll", id: "x" })).status).toBe(404);
    } finally {
      writeConfigs();
      await reloadConfig();
    }
  });
});

describe("return sign-in by number", () => {
  test("a known number gets a code by phone, redeems it and keeps its one contact; an unknown number is told the same", async () => {
    const code = await newLink({ kind: "guest", name: "Group" });
    await proveBySms(code, "+41 79 700 11 22");
    const count = await contactCount();
    jar.cookies = {};

    const { POST } = await import("@/app/api/auth/codes/route");
    const { flushAfterResponse } = await import("@/lib/afterResponse");
    const ask = async (phone: string) => {
      const res = await POST(post("/api/auth/codes", { for: "read", user: OWNER, phone }));
      await flushAfterResponse();
      return { status: res.status, json: await res.json() };
    };
    const before = texts().length;
    const unknown = await ask("+41 79 700 99 99");
    const known = await ask("+41 79 700 11 22");
    expect(unknown.status).toBe(202);
    expect(known).toEqual(unknown);
    expect(texts().length).toBe(before + 1);
    expect(texts().at(-1)?.to).toBe("41797001122");

    const { POST: redeem } = await import("@/app/api/auth/codes/redeem/route");
    const res = await redeem(
      post("/api/auth/codes/redeem", { for: "read", user: OWNER, phone: "+41 79 700 11 22", code: codeIn(lastText("41797001122")) }),
    );
    expect(res.status).toBe(200);
    expect(jar.cookies.fs_session).toBeTruthy();
    expect(await contactCount()).toBe(count);
  });
});

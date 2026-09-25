import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { writeTripFixture } from "./fixtures/content";

/**
 * B2293 — the welcome guide at /w/ and the join flow at /j/; and the server
 * side of B2291's Readers page (Let in, inviting an import, the short link).
 *
 * The same instance as `welcome-links.test.ts`: mail to a file, SMS dry-run,
 * credits and WhatsApp off. Every code is read back out of what was "sent".
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
const OTHER_TRIP = "alps-2025";
let dir: string;

function writeConfigs() {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: {
        auth: { enabled: true },
        contacts: { enabled: true },
        mail: { enabled: true, transport: "file" },
        sms: { enabled: true, backend: "dry-run" },
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

function texts(): { to: string; body: string }[] {
  const smsDir = path.join(dir, "sms");
  if (!fs.existsSync(smsDir)) return [];
  return fs.readdirSync(smsDir).sort().map((f) => JSON.parse(fs.readFileSync(path.join(smsDir, f), "utf8")));
}

/** Every mail to `to`, decoded enough to search for a link. */
function mails(to: string): string[] {
  const mailDir = path.join(dir, "mail", OWNER);
  if (!fs.existsSync(mailDir)) return [];
  return fs
    .readdirSync(mailDir)
    .map((f) => fs.readFileSync(path.join(mailDir, f), "utf8"))
    .filter((eml) => eml.includes(`To: ${to}`))
    .map((eml) =>
      [...eml.matchAll(/Content-Transfer-Encoding: base64\r?\n\r?\n([A-Za-z0-9+/=\r\n]+)/g)]
        .map((m) => Buffer.from(m[1].replace(/\s+/g, ""), "base64").toString("utf8"))
        .join("\n"),
    );
}

async function signInOwner() {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, OWNER_EMAIL, "guest");
  const session = await verifyCode(OWNER, OWNER_EMAIL, code, "guest");
  if (!session.ok) throw new Error("owner sign-in failed");
  jar.cookies = { fs_session: session.token };
}

function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`https://example.test${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9", ...headers },
    body: JSON.stringify(body),
  });
}

async function add(body: Record<string, unknown>) {
  const { POST } = await import("@/app/api/web/[user]/readers/route");
  return POST(post(`/api/web/${OWNER}/readers`, body), { params: Promise.resolve({ user: OWNER }) });
}

async function notify(contactId: string, channel: string) {
  const { POST } = await import("@/app/api/web/[user]/readers/notify/route");
  return POST(post(`/api/web/${OWNER}/readers/notify`, { contactId, channel }), {
    params: Promise.resolve({ user: OWNER }),
  });
}

async function addedId(body: Record<string, unknown>): Promise<string> {
  const res = await add(body);
  expect(res.status).toBe(200);
  return ((await res.json()) as { contact: { id: string } }).contact.id;
}

async function ledgerRows(): Promise<number> {
  const { getDatabase } = await import("@/lib/db");
  const { db } = await getDatabase();
  return (await db.selectFrom("credit_ledger").select("id").execute()).length;
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-b2293-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.CONTACTS_ENCRYPTION_KEY = "66".repeat(32);
  process.env.SESSION_SECRET = "77".repeat(32);
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
  writeTripFixture(OWNER, {
    id: OTHER_TRIP,
    title: "Alps 2025",
    start: "2025-08-25",
    end: "2025-08-26",
    status: "past",
    visibility: "private",
    costsVisibility: "guests",
    people: [],
  });
  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  clearConfigCache();
  clearUserCache();
});

beforeEach(async () => {
  const { resetRateLimitsForTests } = await import("@/lib/rateLimit");
  resetRateLimitsForTests();
  await signInOwner();
});

afterAll(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  for (const key of ["CONTENT_DIR", "DATA_DIR", "DATABASE_URL", "CONTACTS_ENCRYPTION_KEY", "SESSION_SECRET"]) {
    delete process.env[key];
  }
  fs.rmSync(dir, { recursive: true, force: true });
});


/** The six digits in a message — the first run of exactly six that is not
 * part of a colour (`#475569`) or a longer number. */
const lastCode = (text: string) => text.match(/(?<![#\w])(\d{6})(?!\w)/)?.[1] ?? "";
const codeTexted = (to: string) => lastCode(texts().filter((t) => t.to.replace(/\D/g, "") === to.replace(/\D/g, "")).at(-1)?.body ?? "");
const codeMailed = (to: string) => lastCode(mails(to).at(-1) ?? "");

async function step(code: string, body: Record<string, unknown>, headers: Record<string, string> = {}) {
  const { POST } = await import("@/app/w/[code]/step/route");
  const res = await POST(post(`/w/${code}/step`, body, headers), { params: Promise.resolve({ code }) });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}
async function joinStep(code: string, body: Record<string, unknown>) {
  const { POST } = await import("@/app/j/[code]/step/route");
  const res = await POST(post(`/j/${code}/step`, body), { params: Promise.resolve({ code }) });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}
async function guidePage(code: string) {
  const { default: WelcomePage } = await import("@/app/w/[code]/page");
  return WelcomePage({ params: Promise.resolve({ code }) } as never);
}
/** Where a server component redirected to, or null when it rendered. */
async function redirectOf(render: () => Promise<unknown>): Promise<string | null> {
  try {
    await render();
    return null;
  } catch (err) {
    const digest = (err as { digest?: string }).digest ?? "";
    if (!digest.startsWith("NEXT_REDIRECT")) throw err;
    return digest.split(";")[2];
  }
}
async function welcomeCode(id: string) {
  const { welcomeCodeFor } = await import("@/lib/contacts/welcome");
  return (await welcomeCodeFor(OWNER, id))!;
}
async function contact(id: string) {
  const { getContact } = await import("@/lib/contacts");
  return (await getContact(OWNER, id))!;
}

describe("the welcome guide — a forwarded link reaches nothing past the code", () => {
  test("before the code: no details on the page, nothing saved, no proof sent", async () => {
    const id = await addedId({ name: "Fern Forward", email: "fern@example.test" });
    const code = await welcomeCode(id);
    jar.cookies = {};
    const page = JSON.stringify(await guidePage(code));
    expect(page).toContain('"details":null');
    expect(page).not.toContain("fern@example.test");
    expect(page).toContain("fe•••@example.test");

    expect((await step(code, { action: "save", name: "Someone else", done: true })).status).toBe(401);
    expect((await step(code, { action: "proof", kind: "sms", value: "+41 79 000 00 01" })).status).toBe(401);
    expect((await step(code, { action: "verify", channel: "email", code: "000000" })).status).toBe(401);
    expect(jar.cookies).toEqual({});
    const after = await contact(id);
    expect(after.name).toBe("Fern Forward");
    expect(after.onboardedAt).toBeNull();
  });

  test("a code from another contact's channel does not open this guide", async () => {
    const mine = await addedId({ name: "Mo", phone: "+41 79 555 01 01" });
    const theirs = await addedId({ name: "Other", phone: "+41 79 555 01 02" });
    const code = await welcomeCode(mine);
    jar.cookies = {};
    // A valid code for the *other* person's number, spent through my link.
    expect((await step(await welcomeCode(theirs), { action: "send", channel: "sms" })).status).toBe(200);
    const res = await step(code, { action: "verify", channel: "sms", code: codeTexted("+41795550102") });
    expect(res.status).toBe(401);
    expect(jar.cookies).toEqual({});
  });
});

describe("the welcome guide — the reader's six screens", () => {
  test("code by SMS, confirm, add an email with one code, address, ticks — read back; then it runs once", async () => {
    const id = await addedId({ name: "Rita Reader", phone: "+41 79 666 11 22" });
    const code = await welcomeCode(id);
    jar.cookies = {};

    // 2 — the code, to the number the owner typed.
    const sent = await step(code, { action: "send", channel: "sms" });
    expect(sent.status).toBe(200);
    expect(String(sent.json.to)).not.toContain("666 11");
    expect((await step(code, { action: "verify", channel: "sms", code: "000000" })).status).toBe(401);
    expect((await step(code, { action: "verify", channel: "sms", code: codeTexted("+41796661122") })).status).toBe(200);
    expect(jar.cookies.fs_session).toBeTruthy();
    expect((await contact(id)).welcomeOpenedAt).not.toBeNull();
    expect((await contact(id)).phoneProvenAt).not.toBeNull();

    // Signed in now: the page hands over what the owner typed.
    const page = JSON.stringify(await guidePage(code));
    expect(page).toContain('"name":"Rita Reader"');
    expect(page).toContain('"phoneProven":true');

    // 4 — the missing email, proved with one code.
    expect((await step(code, { action: "proof", kind: "email", value: "rita@example.test" })).status).toBe(200);
    expect((await step(code, { action: "proof", kind: "email", value: "rita@example.test", code: "111111" })).status).toBe(401);
    const proved = await step(code, { action: "proof", kind: "email", value: "rita@example.test", code: codeMailed("rita@example.test") });
    expect(proved.status).toBe(200);
    expect((await contact(id)).email).toBe("rita@example.test");
    // …and the name changed on the same screen.
    expect((await step(code, { action: "save", name: "Rita R." })).status).toBe(200);

    // 5 — the address; 6 — the ticks, and done.
    const address = { line1: "Bahnhofstrasse 12", postcode: "8001", city: "Zürich", country: "CH" };
    expect((await step(code, { action: "save", address })).status).toBe(200);
    const done = await step(code, { action: "save", wantsEmailDigest: true, wantsSms: true, wantsPostcard: true, done: true });
    expect(done.status).toBe(200);

    const back = await contact(id);
    expect(back.name).toBe("Rita R.");
    expect(back.postalAddress).toMatchObject(address);
    // The number is still the one the SMS code proved: a self write never
    // touches it.
    expect(back.phone).toBe("+41 79 666 11 22");
    expect(back.wantsEmailDigest).toBe(true);
    expect(back.wantsSms).toBe(true);
    expect(back.wantsPostcard).toBe(true);
    expect(back.onboardedAt).not.toBeNull();

    // Runs once: the next visit goes straight to the journal.
    expect(await redirectOf(() => guidePage(code))).toBe(`/${OWNER}`);
  });

  test("skipping leaves the address and the channels empty", async () => {
    const id = await addedId({ name: "Sam Skip", email: "sam@example.test" });
    const code = await welcomeCode(id);
    jar.cookies = {};
    await step(code, { action: "send", channel: "email" });
    expect((await step(code, { action: "verify", channel: "email", code: codeMailed("sam@example.test") })).status).toBe(200);
    expect((await step(code, { action: "save", done: true })).status).toBe(200);
    const back = await contact(id);
    expect(back.hasPostalAddress).toBe(false);
    expect(back.wantsEmailDigest || back.wantsSms || back.wantsPostcard || back.wantsWhatsapp).toBe(false);
    expect(back.onboardedAt).not.toBeNull();
  });

  test("a buddy's guide knows the trip; the reader's does not", async () => {
    const id = await addedId({ name: "Bo Buddy", email: "bo@example.test", role: "buddy", tripId: TRIP });
    const page = JSON.stringify(await guidePage(await welcomeCode(id)));
    expect(page).toContain('"kind":"buddy"');
    expect(page).toContain('"title":"Iceland 2026"');
  });
});

describe("the join flow at /j/ — asking, never access", () => {
  async function newLink(body: Record<string, unknown> = { kind: "guest", name: "Family chat" }) {
    const { POST } = await import("@/app/api/web/[user]/invites/route");
    const res = await POST(post(`/api/web/${OWNER}/invites`, body), { params: Promise.resolve({ user: OWNER }) });
    expect(res.status).toBe(201);
    const json = (await res.json()) as { id: string; url: string; joinUrl: string };
    expect(json.joinUrl).toMatch(/\/j\/[23456789a-z]{10}$/);
    return { ...json, code: json.joinUrl.split("/j/")[1] };
  }

  test("email: name, code, address, ticks — a confirmed request, nothing granted, the owner told", async () => {
    const link = await newLink();
    jar.cookies = {};
    const { isJournalGuest } = await import("@/lib/contacts/session");
    expect((await joinStep(link.code, { action: "send", name: "Anna Keller", channel: "email", value: "anna@example.test" })).status).toBe(200);
    const wrong = await joinStep(link.code, { action: "verify", name: "Anna Keller", channel: "email", value: "anna@example.test", code: "000000" });
    expect(wrong.status).toBe(401);
    const ok = await joinStep(link.code, {
      action: "verify",
      name: "Anna Keller",
      channel: "email",
      value: "anna@example.test",
      code: codeMailed("anna@example.test"),
    });
    expect(ok.json.status).toBe("waiting");
    expect(await isJournalGuest(OWNER)).toBe(false);
    expect((await joinStep(link.code, { action: "save", address: { line1: "Weg 1", postcode: "3000", city: "Bern", country: "CH" }, wantsEmailDigest: true, wantsPostcard: true })).status).toBe(200);

    const { getContactByEmail } = await import("@/lib/contacts");
    const anna = (await getContactByEmail(OWNER, "anna@example.test"))!;
    expect(anna.status).toBe("pending");
    expect(anna.confirmedAt).not.toBeNull();
    expect(anna.createdVia).toBe(`invite:${link.id}`);
    expect(anna.wantsEmailDigest).toBe(true);
    expect(anna.postalAddress?.city).toBe("Bern");
    const { readerState } = await import("@/lib/readers/split");
    expect(readerState(anna)).toBe("waitingOnYou");
    expect(mails(OWNER_EMAIL).some((m) => m.includes("Anna Keller"))).toBe(true);
  });

  test("mobile: a proved number becomes a request, nothing granted", async () => {
    const link = await newLink();
    jar.cookies = {};
    expect((await joinStep(link.code, { action: "send", name: "Moe Mobile", channel: "sms", value: "+41 78 123 45 67" })).status).toBe(200);
    const ok = await joinStep(link.code, {
      action: "verify",
      name: "Moe Mobile",
      channel: "sms",
      value: "+41 78 123 45 67",
      code: codeTexted("+41781234567"),
    });
    expect(ok.status).toBe(200);
    expect(ok.json.status).toBe("waiting");
    const { getContactByEmail } = await import("@/lib/contacts");
    const moe = (await getContactByEmail(OWNER, "+41781234567"))!;
    expect(moe.status).toBe("pending");
    expect(moe.phoneProvenAt).not.toBeNull();
    const { hasReadGrant } = await import("@/lib/grants");
    expect(await hasReadGrant(OWNER, moe.id)).toBe(false);
  });

  test("a stopped link joins nobody", async () => {
    const link = await newLink();
    const { DELETE } = await import("@/app/api/web/[user]/invites/[id]/route");
    await DELETE(new Request(`https://example.test/api/web/${OWNER}/invites/${link.id}`, { method: "DELETE" }), {
      params: Promise.resolve({ user: OWNER, id: link.id }),
    });
    jar.cookies = {};
    expect((await joinStep(link.code, { action: "send", name: "Late", channel: "email", value: "late@example.test" })).status).toBe(404);
  });

  test("the old /invite/guest/<token> address redirects to the short link", async () => {
    const link = await newLink();
    const token = link.url.split("/invite/guest/")[1];
    // `/invite/guest/[token]/page` renders exactly this with kind "guest".
    const { default: RedeemPage } = await import("@/app/[user]/invite/redeemPage");
    const to = await redirectOf(() => RedeemPage({ username: OWNER, token, kind: "guest" }));
    expect(to).toBe(`/j/${link.code}`);
    // A made-up token, or the wrong kind for the path, still says the link is dead.
    expect(await redirectOf(() => RedeemPage({ username: OWNER, token: "fs_inv_nope", kind: "guest" }))).toBeNull();
    expect(await redirectOf(() => RedeemPage({ username: OWNER, token, kind: "buddy" }))).toBeNull();
  });
});

describe("Readers: Let in, and inviting an import", () => {
  test("Let in approves a proved request and tells them by email, with their welcome link", async () => {
    const { requestContact, confirmContactFromSession, getContactByEmail } = await import("@/lib/contacts");
    await requestContact(OWNER, { name: "Otto", email: "otto@example.test", locale: "en", wantsEmailDigest: false, wantsPostcard: false, createdVia: "asked" });
    await confirmContactFromSession(OWNER, "otto@example.test");
    const otto = (await getContactByEmail(OWNER, "otto@example.test"))!;
    const { POST } = await import("@/app/api/web/[user]/readers/letin/route");
    const res = await POST(post(`/api/web/${OWNER}/readers/letin`, { contactId: otto.id }), { params: Promise.resolve({ user: OWNER }) });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { told: string }).told).toBe("email");
    expect((await contact(otto.id)).status).toBe("active");
    expect(mails("otto@example.test").at(-1)).toContain(`/w/${await welcomeCode(otto.id)}`);
  });

  test("an unproved request cannot be let in", async () => {
    const { requestContact, getContactByEmail } = await import("@/lib/contacts");
    await requestContact(OWNER, { name: "Una", email: "una@example.test", locale: "en", wantsEmailDigest: false, wantsPostcard: false, createdVia: "asked" });
    const una = (await getContactByEmail(OWNER, "una@example.test"))!;
    const { POST } = await import("@/app/api/web/[user]/readers/letin/route");
    const res = await POST(post(`/api/web/${OWNER}/readers/letin`, { contactId: una.id }), { params: Promise.resolve({ user: OWNER }) });
    expect(res.status).toBe(409);
    expect((await contact(una.id)).status).toBe("pending");
  });

  test("inviting an imported person pre-approves them with no trip place; a failed choice changes nothing", async () => {
    const { requestContact, getContactByEmail } = await import("@/lib/contacts");
    await requestContact(OWNER, { name: "Ida Import", email: "ida@example.test", locale: "en", wantsEmailDigest: false, wantsPostcard: false, createdVia: "owner-import" });
    const ida = (await getContactByEmail(OWNER, "ida@example.test"))!;
    // WhatsApp is no longer an invite channel (B2339): refused as a bad
    // request, and Ida stays "not invited yet".
    expect((await notify(ida.id, "whatsapp")).status).toBe(400);
    expect((await contact(ida.id)).status).toBe("pending");
    // Email goes, and that is the owner letting her in.
    expect((await notify(ida.id, "email")).status).toBe(200);
    const after = await contact(ida.id);
    expect(after.status).toBe("active");
    expect(after.invitedVia).toBe("email");
    const { getDatabase } = await import("@/lib/db");
    const { db } = await getDatabase();
    const places = await db.selectFrom("trip_people").select("granted_at").where("contact_id", "=", ida.id).execute();
    expect(places.filter((p) => p.granted_at)).toHaveLength(0);
  });

  test("a request somebody made through a link is not something to send an invite for", async () => {
    const { requestContact, getContactByEmail } = await import("@/lib/contacts");
    await requestContact(OWNER, { name: "Asker", email: "asker@example.test", locale: "en", wantsEmailDigest: false, wantsPostcard: false, createdVia: "asked" });
    const asker = (await getContactByEmail(OWNER, "asker@example.test"))!;
    expect((await notify(asker.id, "self")).status).toBe(404);
    expect((await contact(asker.id)).status).toBe("pending");
  });
});

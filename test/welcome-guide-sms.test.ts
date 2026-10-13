import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { writeTripFixture } from "./fixtures/content";

/**
 * B-2999 — the welcome guide at /w/ texts its code to a contact's keyed mobile number.
 *
 * The same instance as `welcome-links.test.ts`: mail to a file, SMS dry-run,
 * credits and WhatsApp off. Every code is read back out of what was "sent".
 */

const jar = vi.hoisted(() => ({ cookies: {} as Record<string, string>, accept: "" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.cookies[name] === undefined ? undefined : { value: jar.cookies[name] }),
    set: (name: string, value: string) => {
      jar.cookies[name] = value;
    },
  }),
  headers: async () =>
    new Headers({ "x-forwarded-for": "203.0.113.50", ...(jar.accept ? { "accept-language": jar.accept } : {}) }),
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

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-b2999-"));
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


function texts(): { to: string; body: string }[] {
  const smsDir = path.join(dir, "sms");
  if (!fs.existsSync(smsDir)) return [];
  return fs.readdirSync(smsDir).sort().map((f) => JSON.parse(fs.readFileSync(path.join(smsDir, f), "utf8")));
}
const lastTextTo = (digits: string) => texts().filter((t) => t.to === digits).at(-1)?.body ?? "";

describe("the welcome guide signs a contact in by text (B-2999)", () => {
  test("a phone-only contact the owner typed is texted and signs in", async () => {
    const id = await addedId({ name: "Pia Phone", phone: "+41 76 000 00 00" });
    const code = await welcomeCode(id);
    const { props } = (await guidePage(code)) as never as { props: unknown };
    expect(JSON.stringify(props)).toContain("\"mobile\":\"+41");
    expect(JSON.stringify(props)).not.toContain("760000000");

    jar.cookies = {};
    const sent = await step(code, { action: "send", channel: "sms" });
    expect(sent.status).toBe(200);
    expect(String(sent.json.to)).not.toContain("760000000");
    const six = lastCode(lastTextTo("41760000000"));
    expect(six).toHaveLength(6);

    expect((await step(code, { action: "verify", channel: "sms", code: "000000" })).status).toBe(401);
    expect((await step(code, { action: "verify", channel: "sms", code: six })).status).toBe(200);
    expect(jar.cookies.fs_session).toBeTruthy();
  });

  test("the number comes from the record, never the request", async () => {
    const id = await addedId({ name: "Quin Quiet", phone: "+41 76 000 00 01" });
    const code = await welcomeCode(id);
    jar.cookies = {};
    const before = texts().length;
    const sent = await step(code, { action: "send", channel: "sms", value: "+41760000002", phone: "+41760000002" });
    expect(sent.status).toBe(200);
    expect(texts().slice(before).map((t) => t.to)).toEqual(["41760000001"]);
  });

  test("a contact with an email and a keyed number can use either; email stays the default", async () => {
    const id = await addedId({ name: "Eli Both", email: "eli@example.test", phone: "+41 76 000 00 03" });
    const code = await welcomeCode(id);
    const emailSent = await step(code, { action: "send" });
    expect(emailSent.status).toBe(200);
    const mailed = codeMailed("eli@example.test");
    jar.cookies = {};
    expect((await step(code, { action: "verify", code: mailed })).status).toBe(200);

    jar.cookies = {};
    expect((await step(code, { action: "send", channel: "sms" })).status).toBe(200);
    const six = lastCode(lastTextTo("41760000003"));
    expect((await step(code, { action: "verify", channel: "sms", code: six })).status).toBe(200);
    expect((await step(code, { action: "send", channel: "carrier-pigeon" })).status).toBe(400);
  });

  test("a self-typed number never signs in and is never texted", async () => {
    const id = await addedId({ name: "Sol Self", email: "sol@example.test" });
    const { updateContactSelf, manageTokenFor } = await import("@/lib/contacts");
    await updateContactSelf(OWNER, manageTokenFor(OWNER, id), {
      address: { name: "Sol", line1: "1 Test St", line2: "", postcode: "8000", city: "Zurich", country: "CH", tel: "+41 76 000 00 04" },
    });
    expect((await contact(id)).phone).toBeTruthy();
    const code = await welcomeCode(id);
    jar.cookies = {};
    const before = texts().length;
    const sent = await step(code, { action: "send", channel: "sms" });
    expect(sent.status).toBe(409);
    expect(texts().length).toBe(before);
    expect((await step(code, { action: "verify", channel: "sms", code: "123456" })).status).toBe(401);
  });
});

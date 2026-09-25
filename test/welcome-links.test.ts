import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { writeTripFixture } from "./fixtures/content";

/**
 * B2292 — "Add a person" step 2: a per-person welcome link, and the owner's
 * choice of how the person hears about it.
 *
 * Here with credits and WhatsApp off, which is every open-edition instance:
 * email and SMS go out free, WhatsApp is absent with its reason, and the
 * welcome link grants nothing. The credit side is `paid/test/invite-
 * channels.test.ts`.
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-b2292-"));
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

describe("the two short paths are reserved", () => {
  test("w and j can never be a journal", async () => {
    const { isReservedUsername } = await import("@/lib/users");
    expect(isReservedUsername("w")).toBe(true);
    expect(isReservedUsername("j")).toBe(true);
  });
});

describe("adding a person — the owner's cookie only", () => {
  test("a bearer token is refused outright, and so is somebody who is not the owner", async () => {
    const { POST } = await import("@/app/api/web/[user]/readers/route");
    const bearer = await POST(
      post(`/api/web/${OWNER}/readers`, { name: "X", email: "x@example.test" }, { authorization: "Bearer fs_agent_x" }),
      { params: Promise.resolve({ user: OWNER }) },
    );
    expect(bearer.status).toBe(403);
    expect(((await bearer.json()) as { error: string }).error).toBe("not_for_agents");

    jar.cookies = {};
    expect((await add({ name: "X", email: "x@example.test" })).status).toBe(403);
  });

  test("a reader is pre-approved; a buddy is on their trip; nothing is sent", async () => {
    const before = texts().length;
    const id = await addedId({ name: "Lena Roth", email: "lena@example.test", phone: "+41 76 111 22 33" });
    const { getContact } = await import("@/lib/contacts");
    const lena = await getContact(OWNER, id);
    expect(lena?.status).toBe("active");
    expect(mails("lena@example.test")).toHaveLength(0);
    expect(texts()).toHaveLength(before);

    const buddy = await addedId({ name: "Marco", phone: "+41 79 222 33 44", role: "buddy", tripId: TRIP });
    const { isPersonOn } = await import("@/lib/tripPeople");
    const { getTrips } = await import("@/lib/trips");
    const trip = getTrips(OWNER).find((t) => t.id === TRIP)!;
    expect(await isPersonOn(trip, "+41792223344")).toBe(true);
    expect((await getContact(OWNER, buddy))?.status).toBe("active");
  });

  test("adding somebody already there keeps their consents; a blocked person is not let back in", async () => {
    const id = await addedId({ name: "Mia", email: "mia@example.test" });
    const { getDatabase } = await import("@/lib/db");
    const { db } = await getDatabase();
    await db.updateTable("contacts").set({ wants_email_digest: 1 }).where("id", "=", id).execute();
    expect(await addedId({ name: "Mia M.", email: "mia@example.test" })).toBe(id);
    const { getContact, revokeContact } = await import("@/lib/contacts");
    expect((await getContact(OWNER, id))?.wantsEmailDigest).toBe(true);

    await revokeContact(OWNER, id);
    const again = await add({ name: "Mia", email: "mia@example.test" });
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: string }).error).toBe("blocked_contact");
    expect((await getContact(OWNER, id))?.status).toBe("blocked");
  });
});

describe("step 2 — telling them", () => {
  test("the options: the exact message, and WhatsApp absent with its reason where it is off", async () => {
    const id = await addedId({ name: "Nora Hill", email: "nora@example.test" });
    const { GET } = await import("@/app/api/web/[user]/readers/notify/route");
    const res = await GET(new Request(`https://example.test/api/web/${OWNER}/readers/notify?contactId=${id}`), {
      params: Promise.resolve({ user: OWNER }),
    });
    const options = (await res.json()) as {
      url: string;
      balance: number | null;
      channels: { channel: string; cost: number; blocked: string | null; preview: string }[];
    };
    expect(options.url).toMatch(/^https:\/\/example\.test\/w\/[23456789abcdefghjkmnpqrstuvwxyz]{10}$/);
    expect(options.balance).toBeNull();
    const by = Object.fromEntries(options.channels.map((c) => [c.channel, c]));
    expect(by.email.blocked).toBeNull();
    expect(by.email.preview).toBe(
      `Hello Nora — Ana has invited you to read “Two Backpacks”, a travel journal. Start here: ${options.url}`,
    );
    expect(by.whatsapp.blocked).toBe("whatsapp_off");
    expect(by.sms.blocked).toBe("no_mobile");
    expect(by.self).toMatchObject({ blocked: null, cost: 0, preview: options.url });
    // Credits are off here: nothing costs anything.
    expect(options.channels.every((c) => c.cost === 0)).toBe(true);
  });

  test("email: exactly one mail carrying the /w/ link, and the ledger untouched", async () => {
    const id = await addedId({ name: "Otto", email: "otto@example.test" });
    const res = await notify(id, "email");
    expect(res.status).toBe(200);
    const sent = (await res.json()) as { url: string; backend: string; charged: number };
    expect(sent).toMatchObject({ backend: "file", charged: 0 });
    const letters = mails("otto@example.test");
    expect(letters).toHaveLength(1);
    expect(letters[0]).toContain(sent.url);
    expect(await ledgerRows()).toBe(0);
    const { getContact } = await import("@/lib/contacts");
    expect((await getContact(OWNER, id))?.invitedVia).toBe("email");
  });

  test("sms: exactly one text carrying the same text as the preview; self sends nothing", async () => {
    const id = await addedId({ name: "Pia", phone: "+41 76 555 66 77", locale: "de" });
    const before = texts().length;
    const res = await notify(id, "sms");
    expect(res.status).toBe(200);
    const sent = (await res.json()) as { url: string; backend: string };
    expect(sent.backend).toBe("dry-run");
    const mine = texts().slice(before);
    expect(mine).toEqual([
      {
        to: "41765556677",
        body: `Hallo Pia — Ana lädt dich ein, „Two Backpacks“ zu lesen, ein Reisetagebuch. Hier geht’s los: ${sent.url}`,
      },
    ]);

    const self = await notify(id, "self");
    expect(((await self.json()) as { url: string }).url).toBe(sent.url);
    expect(texts()).toHaveLength(before + 1);
  });

  test("a person added without an email can be sent one once an email is added", async () => {
    const id = await addedId({ name: "Rita", phone: "+41 76 777 88 99" });
    expect(((await (await notify(id, "email")).json()) as { error: string }).error).toBe("no_email");
    expect(await addedId({ name: "Rita", phone: "+41 76 777 88 99", email: "rita@example.test" })).toBe(id);
    expect((await notify(id, "email")).status).toBe(200);
    expect(mails("rita@example.test")).toHaveLength(1);
  });

  test("three sends an hour per person, across channels", async () => {
    const id = await addedId({ name: "Sam", email: "sam@example.test", phone: "+41 76 000 11 22" });
    expect((await notify(id, "email")).status).toBe(200);
    expect((await notify(id, "sms")).status).toBe(200);
    expect((await notify(id, "email")).status).toBe(200);
    const fourth = await notify(id, "sms");
    expect(fourth.status).toBe(429);
    expect(((await fourth.json()) as { error: string }).error).toBe("rate_limited");
    // Showing the link is not a send.
    expect((await notify(id, "self")).status).toBe(200);
  });
});

describe("the welcome link grants nothing", () => {
  test("it resolves to a greeting, opens no session, and opening it ends resending", async () => {
    const id = await addedId({ name: "Tom", email: "tom@example.test" });
    const { welcomeCodeFor, resolveWelcomeCode } = await import("@/lib/contacts/welcome");
    const code = await welcomeCodeFor(OWNER, id);
    expect(await welcomeCodeFor(OWNER, id)).toBe(code);
    expect((await resolveWelcomeCode(code))?.contact.id).toBe(id);
    expect(await resolveWelcomeCode("2222222222")).toBeNull();

    jar.cookies = {};
    const { default: WelcomePage } = await import("@/app/w/[code]/page");
    const page = JSON.stringify(await WelcomePage({ params: Promise.resolve({ code }) } as never));
    expect(page).toContain("Hello Tom");
    expect(jar.cookies).toEqual({});
    const { isJournalGuest } = await import("@/lib/contacts/session");
    expect(await isJournalGuest(OWNER)).toBe(false);

    // Rendering does not count as opening — a link preview renders it too.
    const { getContact } = await import("@/lib/contacts");
    expect((await getContact(OWNER, id))?.welcomeOpenedAt).toBeNull();
    const { POST: opened } = await import("@/app/w/[code]/opened/route");
    const res = await opened(new Request(`https://example.test/w/${code}/opened`, { method: "POST" }), {
      params: Promise.resolve({ code }),
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(jar.cookies).toEqual({});
    expect((await getContact(OWNER, id))?.welcomeOpenedAt).not.toBeNull();

    await signInOwner();
    const resend = await notify(id, "email");
    expect(((await resend.json()) as { error: string }).error).toBe("already_opened");
  });
});

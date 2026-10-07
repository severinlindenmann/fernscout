import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { writeTripFixture } from "./fixtures/content";

/**
 * Security review of B2291/B2293 — the join flow writes nothing before a
 * channel is proved, never rewrites somebody already on the page, and spends
 * the ordinary code-mail budget. Started from the reviewer's PoC
 * (`join-clobber.poc.test.ts`); each case failed before the fix.
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

async function addedId(body: Record<string, unknown>): Promise<string> {
  const res = await add(body);
  expect(res.status).toBe(200);
  return ((await res.json()) as { contact: { id: string } }).contact.id;
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-b2293sec-"));
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
async function contact(id: string) {
  const { getContact } = await import("@/lib/contacts");
  return (await getContact(OWNER, id))!;
}


async function newLink(body: Record<string, unknown>) {
  const { POST } = await import("@/app/api/web/[user]/invites/route");
  const res = await POST(post(`/api/web/${OWNER}/invites`, body), { params: Promise.resolve({ user: OWNER }) });
  expect(res.status).toBe(201);
  return ((await res.json()) as { joinUrl: string }).joinUrl.split("/j/")[1];
}
async function activeReader(name: string, email: string) {
  const id = await addedId({ name, email });
  const { getDatabase } = await import("@/lib/db");
  const { db } = await getDatabase();
  await db.updateTable("contacts").set({ wants_email_digest: 1, locale: "en" }).where("id", "=", id).execute();
  return id;
}
async function places(id: string) {
  const { getDatabase } = await import("@/lib/db");
  const { db } = await getDatabase();
  return db.selectFrom("trip_people").select(["trip_id", "granted_at"]).where("contact_id", "=", id).execute();
}

describe("F1 — nothing is written before a channel is proved", () => {
  test("a stranger sending a code for somebody's address changes nothing about them", async () => {
    const id = await activeReader("Vera Victim", "vera@example.test");
    const code = await newLink({ kind: "buddy", name: "Group", trip: TRIP });
    jar.cookies = {};
    const sent = await joinStep(code, { action: "send", name: "Mallory Renamed", channel: "email", value: "VERA@example.test", locale: "de" });
    expect(sent.status).toBe(200);
    const after = await contact(id);
    expect(after.name).toBe("Vera Victim");
    expect(after.locale).toBe("en");
    expect(after.wantsEmailDigest).toBe(true);
    expect(await places(id)).toHaveLength(0);
  });

  test("an address nobody knows gets no row until its code is proved", async () => {
    const code = await newLink({ kind: "guest", name: "Group" });
    jar.cookies = {};
    await joinStep(code, { action: "send", name: "Nobody Yet", channel: "email", value: "nobody-yet@example.test" });
    const { getContactByEmail } = await import("@/lib/contacts");
    expect(await getContactByEmail(OWNER, "nobody-yet@example.test")).toBeNull();
  });
});

describe("F1 — somebody already on the page keeps what is stored", () => {
  test("a proved reader opening a reader link is told they are in; nothing rewritten, no screens to save", async () => {
    const id = await activeReader("Rosa Reader", "rosa@example.test");
    const code = await newLink({ kind: "guest", name: "Group" });
    jar.cookies = {};
    await joinStep(code, { action: "send", name: "Someone Else", channel: "email", value: "rosa@example.test", locale: "de" });
    const ok = await joinStep(code, { action: "verify", name: "Someone Else", channel: "email", value: "rosa@example.test", locale: "de", code: codeMailed("rosa@example.test") });
    expect(ok.json).toMatchObject({ status: "in", known: true });
    const save = await joinStep(code, { action: "save", wantsEmailDigest: false, address: { line1: "X 1", postcode: "1", city: "Y", country: "CH" } });
    expect(save.status).toBe(409);
    const after = await contact(id);
    expect(after.name).toBe("Rosa Reader");
    expect(after.locale).toBe("en");
    expect(after.wantsEmailDigest).toBe(true);
    expect(after.hasPostalAddress).toBe(false);
  });

  test("a proved reader opening a buddy link asks for that trip — a request, not a grant — and keeps their details", async () => {
    const id = await activeReader("Ben Buddy", "ben@example.test");
    const code = await newLink({ kind: "buddy", name: "Crew", trip: TRIP });
    jar.cookies = {};
    await joinStep(code, { action: "send", name: "Not Ben", channel: "email", value: "ben@example.test" });
    const ok = await joinStep(code, { action: "verify", name: "Not Ben", channel: "email", value: "ben@example.test", code: codeMailed("ben@example.test") });
    expect(ok.json).toMatchObject({ status: "waiting", known: true });
    expect((await contact(id)).name).toBe("Ben Buddy");
    const rows = await places(id);
    expect(rows.map((r) => [r.trip_id, r.granted_at])).toEqual([[TRIP, null]]);
  });

  test("a blocked address proves itself and gets nothing, answered like anybody", async () => {
    const id = await activeReader("Gus Gone", "gus@example.test");
    const { revokeContact } = await import("@/lib/contacts");
    await revokeContact(OWNER, id);
    const code = await newLink({ kind: "buddy", name: "Crew2", trip: TRIP });
    jar.cookies = {};
    await joinStep(code, { action: "send", name: "Gus", channel: "email", value: "gus@example.test" });
    const ok = await joinStep(code, { action: "verify", name: "Gus", channel: "email", value: "gus@example.test", code: codeMailed("gus@example.test") });
    expect(ok.json.status).toBe("waiting");
    expect((await contact(id)).status).toBe("blocked");
    expect((await places(id)).filter((p) => p.granted_at)).toHaveLength(0);
  });
});

describe("pre-approval still means exactly the address the owner typed (B319)", () => {
  test("proving the mailed address lets them in; another address on the same link asks", async () => {
    const { createInvite } = await import("@/lib/contacts/invites");
    const { joinCodeFor } = await import("@/lib/contacts/welcome");
    const created = await createInvite(OWNER, { kind: "guest", email: "pre@example.test", expiresAt: null });
    const code = (await joinCodeFor(OWNER, created.id))!;
    jar.cookies = {};
    await joinStep(code, { action: "send", name: "Pre", channel: "email", value: "pre@example.test" });
    const pre = await joinStep(code, { action: "verify", name: "Pre", channel: "email", value: "pre@example.test", code: codeMailed("pre@example.test") });
    expect(pre.json.status).toBe("in");
    jar.cookies = {};
    await joinStep(code, { action: "send", name: "Fwd", channel: "email", value: "fwd@example.test" });
    const fwd = await joinStep(code, { action: "verify", name: "Fwd", channel: "email", value: "fwd@example.test", code: codeMailed("fwd@example.test") });
    expect(fwd.json.status).toBe("waiting");
  });
});

describe("F2 — a group link is not a way to bomb an inbox", () => {
  test("sends to one address stop at the ordinary per-address budget", async () => {
    const code = await newLink({ kind: "guest", name: "Group3" });
    jar.cookies = {};
    const statuses: number[] = [];
    for (let i = 0; i < 15; i++) statuses.push((await joinStep(code, { action: "send", name: "x", channel: "email", value: "bomb@example.test" })).status);
    expect(statuses).toContain(429);
    expect(mails("bomb@example.test").length).toBeLessThanOrEqual(10);
  });
});

describe("the welcome guide refuses a contact whose access was taken away", () => {
  test("a signed-in guide session saves nothing once the person is blocked", async () => {
    const id = await addedId({ name: "Wanda Welcome", email: "wanda@example.test" });
    const { welcomeCodeFor } = await import("@/lib/contacts/welcome");
    const code = (await welcomeCodeFor(OWNER, id))!;
    jar.cookies = {};
    await step(code, { action: "send", channel: "email" });
    expect((await step(code, { action: "verify", channel: "email", code: codeMailed("wanda@example.test") })).status).toBe(200);
    const { revokeContact } = await import("@/lib/contacts");
    await revokeContact(OWNER, id);
    expect((await step(code, { action: "save", name: "Changed" })).status).not.toBe(200);
    expect((await contact(id)).name).toBe("Wanda Welcome");
  });
});

describe("the admin list names a mobile-only buddy's trip too", () => {
  test("relationship.buddyOf is matched on the stored key, not the empty email", async () => {
    const id = await addedId({ name: "Mo Bile", phone: "+41 79 777 88 99", role: "buddy", tripId: TRIP });
    const { GET } = await import("@/app/api/contacts/admin/route");
    const res = await GET(new Request(`https://example.test/api/contacts/admin?user=${OWNER}`));
    const body = (await res.json()) as { contacts: { id: string; relationship: { buddyOf: { id: string }[] } }[] };
    expect(body.contacts.find((c) => c.id === id)?.relationship.buddyOf.map((t) => t.id)).toEqual([TRIP]);
  });
});

describe("B2453 — a second channel and news consent on the join form", () => {
  async function joinedByEmail(name: string, email: string, preapproved = false) {
    await signInOwner();
    let code: string;
    if (preapproved) {
      const { createInvite } = await import("@/lib/contacts/invites");
      const { joinCodeFor } = await import("@/lib/contacts/welcome");
      const created = await createInvite(OWNER, { kind: "guest", email, expiresAt: null });
      code = (await joinCodeFor(OWNER, created.id))!;
    } else {
      code = await newLink({ kind: "guest", name: "Group" });
    }
    jar.cookies = {};
    await joinStep(code, { action: "send", name, channel: "email", value: email });
    const verified = await joinStep(code, { action: "verify", name, channel: "email", value: email, code: codeMailed(email) });
    expect(verified.status).toBe(200);
    const { getContactByEmail } = await import("@/lib/contacts");
    return { code, id: (await getContactByEmail(OWNER, email))!.id };
  }

  // B2597 retired the mobile-proof-by-SMS path (`sendPhoneProof`/
  // `confirmPhoneProof`, and the mobile leg of "proof") along with reader
  // sign-in by phone — three tests here that exercised it are gone with it.

  test("no session, no proof — the contact comes from the browser, never the body", async () => {
    const code = await newLink({ kind: "guest", name: "Group" });
    jar.cookies = {};
    const refused = await joinStep(code, { action: "proof", kind: "email", value: "nobody@example.test" });
    expect(refused.status).toBe(401);
  });

  test("news from Fernscout is recorded only when ticked", async () => {
    const { hasNewsConsent } = await import("@/lib/newsConsent");
    const quiet = await joinedByEmail("Quinn Quiet", "quinn@example.test");
    await joinStep(quiet.code, { action: "save", wantsEmailDigest: true });
    expect(await hasNewsConsent("quinn@example.test")).toBe(false);
    const keen = await joinedByEmail("Kira Keen", "kira@example.test");
    await joinStep(keen.code, { action: "save", wantsEmailDigest: true, wantsNews: true });
    expect(await hasNewsConsent("KIRA@example.test")).toBe(true);
  });

  test("/me withdraws it for the signed-in address only", async () => {
    const { hasNewsConsent, setNewsConsent } = await import("@/lib/newsConsent");
    await setNewsConsent("other@example.test", "en");
    const keen = await joinedByEmail("Nina News", "nina@example.test");
    await joinStep(keen.code, { action: "save", wantsNews: true });
    const { POST } = await import("@/app/at/[user]/me/news/route");
    const res = await POST(post(`/${OWNER}/me/news`, { email: "other@example.test" }), { params: Promise.resolve({ user: OWNER }) } as never);
    expect(res.status).toBe(200);
    expect(await hasNewsConsent("nina@example.test")).toBe(false);
    expect(await hasNewsConsent("other@example.test")).toBe(true);
    jar.cookies = {};
    const anonymous = await POST(post(`/${OWNER}/me/news`, {}), { params: Promise.resolve({ user: OWNER }) } as never);
    expect(anonymous.status).toBe(401);
  });
});

// B2454 ("somebody who joined by mobile can add an email") is gone with it:
// B2597 retired joining by mobile entirely — the join link asks for an email.

describe("B2503 — the confirm button in a join code mail carries on in the join guide", () => {
  test("pressing it lands back on /j/<code>, and the guide then files the request", async () => {
    await signInOwner();
    const code = await newLink({ kind: "guest", name: "Group" });
    jar.cookies = {};
    const email = "linky@example.test";
    await joinStep(code, { action: "send", name: "Lina Link", channel: "email", value: email });
    const token = mails(email).at(-1)?.match(/\/@ana\/s\/([A-Za-z0-9_-]+)/)?.[1];
    expect(token).toBeTruthy();
    // B-2935: the press page words itself for a guest who is not in yet.
    expect(mails(email).at(-1)).toMatch(/\/@ana\/s\/[A-Za-z0-9_-]+(\?lang=[a-z]{2})?[?&]for=join/);

    const { POST } = await import("@/app/api/auth/links/redeem/route");
    const res = await POST(post("/api/auth/links/redeem", { user: OWNER, token, for: "read" }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { next?: string }).next).toBe(`/j/${code}`);

    const { getContactByEmail } = await import("@/lib/contacts");
    expect(await getContactByEmail(OWNER, email)).toBeNull();
    const joined = await joinStep(code, { action: "join", name: "Lina Link" });
    expect(joined.status).toBe(200);
    expect((await getContactByEmail(OWNER, email))?.status).toBe("pending");
  });
});

describe("B2505 — a waiting reader leaves a WhatsApp number for digital postcards", () => {
  async function waitingByEmail(name: string, email: string) {
    await signInOwner();
    const code = await newLink({ kind: "guest", name: "Group" });
    jar.cookies = {};
    await joinStep(code, { action: "send", name, channel: "email", value: email });
    const verified = await joinStep(code, { action: "verify", name, channel: "email", value: email, code: codeMailed(email) });
    expect(verified.json).toMatchObject({ status: "waiting" });
    const { getContactByEmail } = await import("@/lib/contacts");
    return { code, id: (await getContactByEmail(OWNER, email))!.id };
  }

  test("the number is kept with the request, unproved, and nothing is texted", async () => {
    const { code, id } = await waitingByEmail("Wilma Wa", "wilma-wa@example.test");
    const before = texts().length;
    const saved = await joinStep(code, { action: "save", wantsEmailDigest: true, wantsWhatsapp: true, tel: "+41 79 555 88 11" });
    expect(saved.status).toBe(200);
    const after = await contact(id);
    expect(after.status).toBe("pending");
    expect(after.wantsWhatsapp).toBe(true);
    expect(after.postalAddress?.tel?.replace(/\D/g, "")).toBe("41795558811");
    expect(after.phoneProvenAt).toBeNull();
    expect(texts().length).toBe(before);
  });

  test("an address saved on the step before survives the number", async () => {
    const { code, id } = await waitingByEmail("Adam Addr", "adam@example.test");
    await joinStep(code, { action: "save", address: { line1: "Hauptstrasse 1", postcode: "3000", city: "Bern", country: "CH" } });
    await joinStep(code, { action: "save", wantsWhatsapp: true, tel: "+41 79 555 88 12" });
    const after = await contact(id);
    expect(after.postalAddress?.line1).toBe("Hauptstrasse 1");
    expect(after.postalAddress?.city).toBe("Bern");
    expect(after.wantsWhatsapp).toBe(true);
  });

  test("a number that cannot be read is refused, not stored", async () => {
    const { code, id } = await waitingByEmail("Nora Nonum", "nora@example.test");
    const saved = await joinStep(code, { action: "save", wantsWhatsapp: true, tel: "call me" });
    expect(saved.status).toBe(400);
    expect(saved.json).toMatchObject({ error: "invalid_phone" });
    expect((await contact(id)).wantsWhatsapp).toBe(false);
  });
});

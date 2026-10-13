import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { hasPaid } from "./support/openCore";

/**
 * B-3003 - signing in by sending a WhatsApp message: the instance-wide door
 * (`/me/wa`) and the welcome link (`/w/<code>/step`, `wa-start`/`wa-poll`).
 * The webhook is simulated by calling `claimPhoneLink` with the message text.
 */

const jar = vi.hoisted(() => ({ cookies: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.cookies[name] === undefined ? undefined : { value: jar.cookies[name] }),
    set: (name: string, value: string) => {
      jar.cookies[name] = value;
    },
    delete: (name: string | { name: string }) => {
      delete jar.cookies[typeof name === "string" ? name : name.name];
    },
  }),
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.50" }),
}));

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
const INSTANCE_NUMBER = "+41760000099";
let dir: string;
let ipCounter = 0;

function post(url: string, body: unknown) {
  return new Request(`https://example.test${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `203.0.113.${(ipCounter++ % 200) + 1}` },
    body: JSON.stringify(body),
  });
}
async function me(body: Record<string, unknown>) {
  const { POST } = await import("@/app/me/wa/route");
  const res = await POST(post("/me/wa", body));
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}
async function welcome(code: string, body: Record<string, unknown>) {
  const { POST } = await import("@/app/w/[code]/step/route");
  const res = await POST(post(`/w/${code}/step`, body), { params: Promise.resolve({ code }) });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}
async function claim(text: unknown, from: string) {
  const { claimPhoneLink } = await import("@/lib/phoneVerify/inboundLink");
  return claimPhoneLink(String(text), from);
}
async function addContact(body: Record<string, unknown>) {
  const { addContact } = await import("@/lib/contacts");
  const added = await addContact(OWNER, { locale: "en", createdVia: "owner", ...body } as never);
  if (!added.ok) throw new Error("add failed");
  return added.contact;
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-b3003-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.CONTACTS_ENCRYPTION_KEY = "66".repeat(32);
  process.env.SESSION_SECRET = "77".repeat(32);
  process.env.WHATSAPP_APP_SECRET = "test-secret";
  process.env.WHATSAPP_VERIFY_TOKEN = "test-verify";
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
        whatsapp: { enabled: true, backend: "dry-run", number: INSTANCE_NUMBER },
        whatsappInbound: { enabled: true },
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
  for (const key of ["CONTENT_DIR", "DATA_DIR", "DATABASE_URL", "CONTACTS_ENCRYPTION_KEY", "SESSION_SECRET", "WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN"]) {
    delete process.env[key];
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

// The inbound WhatsApp webhook is a paid feature: without paid/ the option is absent by design.
describe.skipIf(!hasPaid())("sign in by WhatsApp message (B-3003)", () => {
  test("the prefilled text is neutral", async () => {
    const started = await me({ action: "start", phone: "+41 76 000 00 10", locale: "en" });
    expect(started.status).toBe(200);
    const text = decodeURIComponent(String(started.json.link).split("text=")[1]);
    expect(text).toMatch(/^Fernscout FS-[A-Z0-9]{8} - /);
    expect(text.toLowerCase()).not.toContain("signup");
  });

  test("/me/wa: the typed number's message signs this browser in as that number, and proves no contact", async () => {
    const holder = await addContact({ name: "Holder", phone: "+41 76 000 00 11" });
    expect(holder.phoneProvenAt).toBeFalsy();
    const started = await me({ action: "start", phone: "+41 76 000 00 11", locale: "en" });
    expect(started.status).toBe(200);
    expect(String(started.json.link)).toMatch(/^https:\/\/wa\.me\/41760000099\?text=/);
    expect(jar.cookies.fs_wa_signin).toBeTruthy();
    const id = String(started.json.id);

    expect((await me({ action: "poll", id })).json).toEqual({ status: "pending" });
    expect(await claim(decodeURIComponent(String(started.json.link).split("text=")[1]), "41760000011")).toMatchObject({ outcome: "confirmed" });
    expect((await me({ action: "poll", id })).json).toEqual({ ok: true, status: "in" });

    const { resolveSession } = await import("@/lib/auth");
    const session = await resolveSession(jar.cookies.fs_identity, "identity");
    expect(session?.email).toBe("+41760000011");
    const { getContact } = await import("@/lib/contacts");
    expect((await getContact(OWNER, holder.id))?.phoneProvenAt).toBeFalsy();
    // single use
    expect((await me({ action: "poll", id })).json).toEqual({ status: "expired" });
  });

  test("/me/wa: a message from another number is a mismatch and signs nobody in", async () => {
    const started = await me({ action: "start", phone: "+41 76 000 00 12", locale: "en" });
    await claim(decodeURIComponent(String(started.json.link).split("text=")[1]), "41760000013");
    expect((await me({ action: "poll", id: String(started.json.id) })).json).toEqual({ status: "mismatch" });
    expect(jar.cookies.fs_identity).toBeUndefined();
  });

  test("/me/wa: no cookie is expired; a bad number is 400; a foreign origin is refused", async () => {
    const started = await me({ action: "start", phone: "+41 76 000 00 14", locale: "en" });
    await claim(decodeURIComponent(String(started.json.link).split("text=")[1]), "41760000014");
    jar.cookies = {};
    expect((await me({ action: "poll", id: String(started.json.id) })).json).toEqual({ status: "expired" });
    expect(jar.cookies.fs_identity).toBeUndefined();
    expect((await me({ action: "start", phone: "nope" })).status).toBe(400);
    const { POST } = await import("@/app/me/wa/route");
    const foreign = new Request("https://example.test/me/wa", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.test" },
      body: JSON.stringify({ action: "start", phone: "+41 76 000 00 14" }),
    });
    expect((await POST(foreign)).status).toBe(403);
  });

  test("/w: wa-poll signs in only the contact whose number it is", async () => {
    const a = await addContact({ name: "Aria", phone: "+41 76 000 00 21" });
    const b = await addContact({ name: "Boris", phone: "+41 76 000 00 22" });
    const { welcomeCodeFor } = await import("@/lib/contacts/welcome");
    const codeA = (await welcomeCodeFor(OWNER, a.id))!;
    const codeB = (await welcomeCodeFor(OWNER, b.id))!;

    // The number comes from the record: a typed one in the body changes nothing.
    const started = await welcome(codeA, { action: "wa-start", phone: "+41760000022" });
    expect(started.status).toBe(200);
    const text = decodeURIComponent(String(started.json.link).split("text=")[1]);
    const id = String(started.json.id);
    expect((await welcome(codeA, { action: "wa-poll", id })).json).toEqual({ status: "pending" });

    // Boris's number sends Aria's token: mismatch, nobody signed in.
    await claim(text, "41760000022");
    expect((await welcome(codeA, { action: "wa-poll", id })).json).toEqual({ status: "mismatch" });
    expect(jar.cookies.fs_session).toBeUndefined();

    // Aria's own number: signed in as Aria.
    jar.cookies = {};
    const again = await welcome(codeA, { action: "wa-start" });
    await claim(decodeURIComponent(String(again.json.link).split("text=")[1]), "41760000021");
    expect((await welcome(codeA, { action: "wa-poll", id: String(again.json.id) })).json).toEqual({ ok: true, status: "in" });
    const { resolveSession } = await import("@/lib/auth");
    const session = await resolveSession(jar.cookies.fs_session, "guest", OWNER);
    expect(session?.email).toBe("+41760000021");

    // Aria's cookie secret is path-scoped to her code; Boris's link is another scope entirely.
    expect((await welcome(codeB, { action: "wa-poll", id: String(again.json.id) })).json).toEqual({ status: "expired" });
  });

  test("/w: a contact with no keyed number has no WhatsApp way", async () => {
    const c = await addContact({ name: "Mailonly", email: "mo@example.test" });
    const { welcomeCodeFor } = await import("@/lib/contacts/welcome");
    expect((await welcome((await welcomeCodeFor(OWNER, c.id))!, { action: "wa-start" })).status).toBe(409);
  });
});

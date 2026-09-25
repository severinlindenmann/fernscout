import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

// Same guard every other v2 test in this area uses: every call here
// authenticates with a bearer token, never a cookie.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

/**
 * POST /api/v2/{user}/contacts/grant — B1904, D11's bearer twin.
 *
 * `grantContactAccess` and `sendGrantedMail` are reused verbatim (see the
 * route's own doc comment); this file proves the route wires them up
 * correctly and holds the properties the ticket names: a blocked address
 * refused, an existing confirmation never overwritten, and the positive
 * control (readable back as `active` on the ordinary contacts listing).
 */

const OWNER_EMAIL = "mira@example.test";
const OWNER = "mira";
const ROUTE = "@/app/api/v2/[user]/contacts/grant/route";

let dir: string;
let calls = 0;

function headers(extra: Record<string, string> = {}): Record<string, string> {
  calls += 1;
  return { "content-type": "application/json", "x-forwarded-for": `10.9.4.${calls % 250}`, ...extra };
}

async function ownerToken(): Promise<string> {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, OWNER_EMAIL, "agent");
  const result = await verifyCode(OWNER, OWNER_EMAIL, code, "agent");
  if (!result.ok) throw new Error("no owner token");
  return result.token;
}

type Body = Record<string, unknown> & { error?: string; message?: string };

async function call(
  route: string,
  opts: { token?: string; body?: unknown; dryRun?: boolean } = {},
) {
  const mod = (await import(route)) as Record<string, (req: Request, ctx: unknown) => Promise<Response>>;
  const handler = mod.POST;
  const u = new URL(`https://example.test/api/v2/${OWNER}/contacts/grant`);
  if (opts.dryRun !== undefined) u.searchParams.set("dryRun", String(opts.dryRun));
  const response = await handler(
    new Request(u, {
      method: "POST",
      headers: headers(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    }),
    { params: Promise.resolve({ user: OWNER }) },
  );
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : {}) as Body };
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-api-v2-contacts-grant-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.SESSION_SECRET = "88".repeat(32);
  process.env.CONTACTS_ENCRYPTION_KEY = "99".repeat(32);

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test" },
      users: { reserved: [] },
      features: { auth: { enabled: true }, mail: { enabled: true, transport: "file" }, contacts: { enabled: true } },
    }),
  );

  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  const { migrateToLatest } = await import("@/lib/db/migrate");
  const { getDatabase } = await import("@/lib/db");
  const { createJournal } = await import("@/lib/journals");

  clearConfigCache();
  clearUserCache();
  await migrateToLatest(await getDatabase());

  const created = createJournal({
    username: OWNER,
    title: "Two Backpacks",
    ownerEmail: OWNER_EMAIL,
    ownerName: "Mira Traveller",
    ownerNickname: "Mira",
  });
  if (!created.ok) throw new Error(created.message);
});

afterAll(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATA_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  delete process.env.CONTACTS_ENCRYPTION_KEY;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("POST /api/v2/{user}/contacts/grant", () => {
  test("positive control: a named address is active immediately, readable back on the queue, and can read", async () => {
    const token = await ownerToken();
    const { status, body } = await call(ROUTE, {
      token,
      body: { name: "Priya Reader", email: "priya@example.test" },
    });
    expect(status, JSON.stringify(body)).toBe(201);
    expect(body.ok).toBe(true);
    const contact = body.contact as Record<string, unknown>;
    expect(contact.status).toBe("active");
    expect(contact.confirmedAt).not.toBeNull();
    expect(contact.approvedAt).not.toBeNull();

    const { hasReadGrant } = await import("@/lib/grants");
    expect(await hasReadGrant(OWNER, contact.id as string)).toBe(true);

    // Readable back on the ordinary owner-facing listing too.
    const { listContacts } = await import("@/lib/contacts");
    const listed = await listContacts(OWNER);
    const found = listed.find((c) => c.email === "priya@example.test");
    expect(found?.status).toBe("active");
  });

  test("no token, no link, no signed URL is ever returned — the grant is server-side only", async () => {
    const token = await ownerToken();
    const { status, body } = await call(ROUTE, {
      token,
      body: { name: "No Link Here", email: "nolink@example.test" },
    });
    expect(status, JSON.stringify(body)).toBe(201);
    const contact = body.contact as Record<string, unknown>;
    for (const [key, value] of Object.entries(contact)) {
      if (typeof value === "string") {
        expect(value.startsWith("http"), `${key} carried a URL`).toBe(false);
      }
    }
    expect(body).not.toHaveProperty("url");
    expect(body).not.toHaveProperty("token");
    expect(body).not.toHaveProperty("link");
  });

  test("a blocked address is refused, not silently re-granted", async () => {
    const token = await ownerToken();
    const first = await call(ROUTE, { token, body: { name: "Leo Blocked", email: "leo-blocked@example.test" } });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const contactId = (first.body.contact as Record<string, unknown>).id as string;

    const { revokeContact } = await import("@/lib/contacts");
    await revokeContact(OWNER, contactId);

    const second = await call(ROUTE, { token, body: { name: "Leo Blocked", email: "leo-blocked@example.test" } });
    expect(second.status).toBe(409);
    expect(second.body.error).toBe("contact_blocked");

    const { getContact } = await import("@/lib/contacts");
    const after = await getContact(OWNER, contactId);
    expect(after?.status).toBe("blocked");
  });

  test("an existing confirmation an address already proved is never overwritten by a later grant", async () => {
    const { requestContact, confirmContactFromSession, getContactByEmail } = await import("@/lib/contacts");
    const created = await requestContact(OWNER, {
      name: "Already Proved",
      email: "already-proved@example.test",
      locale: "en",
      address: undefined,
      wantsEmailDigest: false,
      wantsPostcard: false,
      wantsWhatsapp: false,
      createdVia: "invite:test",
    });
    if (created.outcome === "ignored") throw new Error("blocked");
    await confirmContactFromSession(OWNER, "already-proved@example.test");
    const before = await getContactByEmail(OWNER, "already-proved@example.test");
    const confirmedAtBefore = before?.confirmedAt;
    expect(confirmedAtBefore).not.toBeNull();

    const token = await ownerToken();
    const { status, body } = await call(ROUTE, {
      token,
      body: { name: "Already Proved", email: "already-proved@example.test" },
    });
    expect(status, JSON.stringify(body)).toBe(201);

    const after = await getContactByEmail(OWNER, "already-proved@example.test");
    expect(after?.confirmedAt).toBe(confirmedAtBefore);
    expect(after?.status).toBe("active");
  });

  test("dryRun writes nothing", async () => {
    const token = await ownerToken();
    const { listContacts } = await import("@/lib/contacts");
    const before = (await listContacts(OWNER)).length;

    const { status, body } = await call(ROUTE, {
      token,
      body: { name: "Preview Grant", email: "preview-grant@example.test" },
      dryRun: true,
    });
    expect(status, JSON.stringify(body)).toBe(201);
    expect(body.dryRun).toBe(true);
    expect((await listContacts(OWNER)).length).toBe(before);
  });

  test("a non-owner is refused", async () => {
    const { status, body } = await call(ROUTE, { body: { name: "X", email: "x@example.test" } });
    expect(status).toBe(401);
    expect(body.error).toBe("missing_token");
  });

  test("an invalid email is refused before anything is written", async () => {
    const token = await ownerToken();
    const { listContacts } = await import("@/lib/contacts");
    const before = (await listContacts(OWNER)).length;
    const { status, body } = await call(ROUTE, { token, body: { name: "Bad", email: "not-an-email" } });
    expect(status).toBe(400);
    expect(body.error).toBe("invalid_request");
    expect((await listContacts(OWNER)).length).toBe(before);
  });
});

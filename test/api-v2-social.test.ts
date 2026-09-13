import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

// Same guard api-v2-journal.test.ts and api-v2-keys.test.ts use: every call
// here authenticates with a bearer token, never a cookie.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

/**
 * `/api/v2/{user}/invites`, `/contacts`, `/channels` and
 * `/trips/{trip}/days/{slug}/send` — B1623, phase 2 step 4. See
 * docs/plans/2026-09-12-api-v2/social.md.
 */

const OWNER_EMAIL = "mira@example.test";
const OWNER = "mira";
const TRIP = "vietnam-2026";

let dir: string;
let calls = 0;

function headers(extra: Record<string, string> = {}): Record<string, string> {
  calls += 1;
  return { "content-type": "application/json", "x-forwarded-for": `10.9.3.${calls % 250}`, ...extra };
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
  method: "GET" | "PUT" | "POST" | "PATCH" | "DELETE",
  url: string,
  route: string,
  routeParams: Record<string, string>,
  opts: { token?: string; body?: unknown; dryRun?: boolean } = {},
) {
  const mod = (await import(route)) as Record<string, (req: Request, ctx: unknown) => Promise<Response>>;
  const handler = mod[method];
  const u = new URL(url);
  if (opts.dryRun !== undefined) u.searchParams.set("dryRun", String(opts.dryRun));
  const response = await handler(
    new Request(u, {
      method,
      headers: headers(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    }),
    { params: Promise.resolve(routeParams) },
  );
  const text = await response.text();
  return { status: response.status, headers: response.headers, body: (text ? JSON.parse(text) : {}) as Body, raw: text };
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-api-v2-social-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.SESSION_SECRET = "77".repeat(32);
  process.env.CONTACTS_ENCRYPTION_KEY = "66".repeat(32);

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
  const { createJournal, setJournalFeatures } = await import("@/lib/journals");
  const { createTrip } = await import("@/lib/tripWrite");

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
  const enabled = setJournalFeatures(OWNER, { contacts: true });
  if (!enabled.ok) throw new Error(enabled.message);

  const trip = createTrip(OWNER, {
    id: TRIP,
    title: "Vietnam",
    start: "2026-03-01",
    end: "2026-03-20",
    visibility: "private",
  });
  if (!trip.ok) throw new Error(trip.message);
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

describe("PUT /api/v2/{user}/invites/{id} — issuing a link", () => {
  test("returns the token exactly once, as `url`", async () => {
    const token = await ownerToken();
    const { status, body } = await call(
      "PUT",
      `https://example.test/api/v2/${OWNER}/invites/inv-guest-1`,
      "@/app/api/v2/[user]/invites/[id]/route",
      { user: OWNER, id: "inv-guest-1" },
      { token, body: { id: "inv-guest-1", kind: "guest" } },
    );
    expect(status, JSON.stringify(body)).toBe(201);
    expect(typeof body.url).toBe("string");
    expect(body.kind).toBe("guest");

    const read = await call(
      "GET",
      `https://example.test/api/v2/${OWNER}/invites/inv-guest-1`,
      "@/app/api/v2/[user]/invites/[id]/route",
      { user: OWNER, id: "inv-guest-1" },
      { token },
    );
    expect(read.status).toBe(200);
    // Only the create response ever carries the token.
    expect(read.body.url).toBeUndefined();
  });

  test("a buddy link needs a real trip", async () => {
    const token = await ownerToken();
    const { status, body } = await call(
      "PUT",
      `https://example.test/api/v2/${OWNER}/invites/inv-buddy-1`,
      "@/app/api/v2/[user]/invites/[id]/route",
      { user: OWNER, id: "inv-buddy-1" },
      { token, body: { id: "inv-buddy-1", kind: "buddy", trip: TRIP } },
    );
    expect(status, JSON.stringify(body)).toBe(201);
    expect(body.trip).toBe(TRIP);

    const bad = await call(
      "PUT",
      `https://example.test/api/v2/${OWNER}/invites/inv-buddy-2`,
      "@/app/api/v2/[user]/invites/[id]/route",
      { user: OWNER, id: "inv-buddy-2" },
      { token, body: { id: "inv-buddy-2", kind: "buddy", trip: "no-such-trip" } },
    );
    expect(bad.status).toBe(404);
    expect(bad.body.error).toBe("unknown_trip");
  });

  test("dryRun writes nothing", async () => {
    const token = await ownerToken();
    const preview = await call(
      "PUT",
      `https://example.test/api/v2/${OWNER}/invites/inv-preview`,
      "@/app/api/v2/[user]/invites/[id]/route",
      { user: OWNER, id: "inv-preview" },
      { token, body: { id: "inv-preview", kind: "guest" }, dryRun: true },
    );
    expect(preview.status, JSON.stringify(preview.body)).toBe(201);

    const read = await call(
      "GET",
      `https://example.test/api/v2/${OWNER}/invites/inv-preview`,
      "@/app/api/v2/[user]/invites/[id]/route",
      { user: OWNER, id: "inv-preview" },
      { token },
    );
    expect(read.status).toBe(404);
  });

  test("refuses a caller with no token", async () => {
    const { status, body } = await call(
      "PUT",
      `https://example.test/api/v2/${OWNER}/invites/inv-x`,
      "@/app/api/v2/[user]/invites/[id]/route",
      { user: OWNER, id: "inv-x" },
      { body: { id: "inv-x", kind: "guest" } },
    );
    expect(status).toBe(401);
    expect(body.error).toBe("missing_token");
  });
});

describe("DELETE /api/v2/{user}/invites/{id} — revoke", () => {
  test("a revoked link no longer counts as live", async () => {
    const token = await ownerToken();
    await call(
      "PUT",
      `https://example.test/api/v2/${OWNER}/invites/inv-revoke-me`,
      "@/app/api/v2/[user]/invites/[id]/route",
      { user: OWNER, id: "inv-revoke-me" },
      { token, body: { id: "inv-revoke-me", kind: "guest" } },
    );
    const { status, body } = await call(
      "DELETE",
      `https://example.test/api/v2/${OWNER}/invites/inv-revoke-me`,
      "@/app/api/v2/[user]/invites/[id]/route",
      { user: OWNER, id: "inv-revoke-me" },
      { token },
    );
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.revoked).toBe(true);

    const { listInvites } = await import("@/lib/contacts/invites");
    const row = (await listInvites(OWNER)).find((i) => i.id === "inv-revoke-me");
    expect(row?.revokedAt).toBeTruthy();
  });
});

describe("Contacts — the safety shape (approveContact is the only grant)", () => {
  test("a redeemed link creates a pending row, no grant; approve is what grants; revoke ends it", async () => {
    const { requestContact, confirmContactFromSession, getContactByEmail } = await import("@/lib/contacts");
    const { hasReadGrant } = await import("@/lib/grants");

    // Simulates what /api/web/{user}/contacts/redeem would do on the reader's
    // side: prove the address, land in the queue. Nothing here grants access.
    const created = await requestContact(OWNER, {
      name: "Leo Reader",
      email: "leo@example.test",
      locale: "en",
      address: undefined,
      wantsEmailDigest: false,
      wantsPostcard: false,
      wantsWhatsapp: false,
      createdVia: "invite:test",
    });
    if (created.outcome === "ignored") throw new Error("blocked");
    await confirmContactFromSession(OWNER, "leo@example.test");

    const contact = await getContactByEmail(OWNER, "leo@example.test");
    if (!contact) throw new Error("no contact");
    expect(await hasReadGrant(OWNER, contact.id)).toBe(false);

    const token = await ownerToken();
    const approved = await call(
      "POST",
      `https://example.test/api/v2/${OWNER}/contacts/${contact.id}/approve`,
      "@/app/api/v2/[user]/contacts/[id]/approve/route",
      { user: OWNER, id: contact.id },
      { token },
    );
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(await hasReadGrant(OWNER, contact.id)).toBe(true);

    const revoked = await call(
      "POST",
      `https://example.test/api/v2/${OWNER}/contacts/${contact.id}/revoke`,
      "@/app/api/v2/[user]/contacts/[id]/revoke/route",
      { user: OWNER, id: contact.id },
      { token },
    );
    expect(revoked.status, JSON.stringify(revoked.body)).toBe(200);
    expect(await hasReadGrant(OWNER, contact.id)).toBe(false);
  });

  test("approve refuses an address that has not confirmed itself", async () => {
    const { requestContact } = await import("@/lib/contacts");
    const created = await requestContact(OWNER, {
      name: "Never Confirmed",
      email: "never@example.test",
      locale: "en",
      address: undefined,
      wantsEmailDigest: false,
      wantsPostcard: false,
      wantsWhatsapp: false,
      createdVia: "invite:test",
    });
    if (created.outcome === "ignored") throw new Error("blocked");

    const token = await ownerToken();
    const { status, body } = await call(
      "POST",
      `https://example.test/api/v2/${OWNER}/contacts/${created.contactId}/approve`,
      "@/app/api/v2/[user]/contacts/[id]/approve/route",
      { user: OWNER, id: created.contactId },
      { token },
    );
    expect(status).toBe(409);
    expect(body.error).toBe("not_confirmed");
  });

  test("dryRun writes nothing", async () => {
    const token = await ownerToken();
    const { listContacts } = await import("@/lib/contacts");
    const before = (await listContacts(OWNER)).length;

    const { status } = await call(
      "POST",
      `https://example.test/api/v2/${OWNER}/contacts`,
      "@/app/api/v2/[user]/contacts/route",
      { user: OWNER },
      { token, body: { name: "Preview Person", email: "preview@example.test" }, dryRun: true },
    );
    expect(status).toBe(201);
    expect((await listContacts(OWNER)).length).toBe(before);
  });

  test("a contacts listing carries no email or postal address", async () => {
    const token = await ownerToken();
    const { status, raw, body } = await call(
      "GET",
      `https://example.test/api/v2/${OWNER}/contacts`,
      "@/app/api/v2/[user]/contacts/route",
      { user: OWNER },
      { token },
    );
    expect(status, JSON.stringify(body)).toBe(200);
    const contacts = body.contacts as Record<string, unknown>[];
    expect(contacts.length).toBeGreaterThan(0);
    for (const c of contacts) {
      expect(c).not.toHaveProperty("email");
      expect(c).not.toHaveProperty("address");
      expect(c).not.toHaveProperty("postalAddress");
    }
    // Not merely absent from the parsed object — never on the wire either.
    expect(raw).not.toMatch(/leo@example\.test|never@example\.test|preview@example\.test/);
  });

  test("a non-owner is refused", async () => {
    const { status, body } = await call(
      "GET",
      `https://example.test/api/v2/${OWNER}/contacts`,
      "@/app/api/v2/[user]/contacts/route",
      { user: OWNER },
    );
    expect(status).toBe(401);
    expect(body.error).toBe("missing_token");
  });

  test("a trip-scoped token is refused — this is the owner's queue", async () => {
    const { issueCode, verifyCode } = await import("@/lib/auth");
    const { tripWriteScope } = await import("@/lib/tripPeople");
    const { code } = await issueCode(OWNER, "buddy@example.test", "agent", { trip: TRIP });
    const scoped = await verifyCode(OWNER, "buddy@example.test", code, "agent", tripWriteScope(TRIP));
    if (!scoped.ok) throw new Error("no scoped token");
    const { status, body } = await call(
      "GET",
      `https://example.test/api/v2/${OWNER}/contacts`,
      "@/app/api/v2/[user]/contacts/route",
      { user: OWNER },
      { token: scoped.token },
    );
    expect(status).toBe(403);
    expect(body.error).toBe("forbidden");
  });
});

describe("GET/PATCH /api/v2/{user}/channels", () => {
  test("reads and writes the mute switches", async () => {
    const token = await ownerToken();
    const before = await call(
      "GET",
      `https://example.test/api/v2/${OWNER}/channels`,
      "@/app/api/v2/[user]/channels/route",
      { user: OWNER },
      { token },
    );
    expect(before.status, JSON.stringify(before.body)).toBe(200);
    expect(before.body.mail).toBe(true);

    const patched = await call(
      "PATCH",
      `https://example.test/api/v2/${OWNER}/channels`,
      "@/app/api/v2/[user]/channels/route",
      { user: OWNER },
      { token, body: { mail: false } },
    );
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    expect(patched.body.mail).toBe(false);

    // put it back so later tests in this file that rely on mail are unaffected
    await call(
      "PATCH",
      `https://example.test/api/v2/${OWNER}/channels`,
      "@/app/api/v2/[user]/channels/route",
      { user: OWNER },
      { token, body: { mail: true } },
    );
  });

  test("dryRun writes nothing", async () => {
    const token = await ownerToken();
    const before = await call(
      "GET",
      `https://example.test/api/v2/${OWNER}/channels`,
      "@/app/api/v2/[user]/channels/route",
      { user: OWNER },
      { token },
    );
    const { status } = await call(
      "PATCH",
      `https://example.test/api/v2/${OWNER}/channels`,
      "@/app/api/v2/[user]/channels/route",
      { user: OWNER },
      { token, body: { mail: false }, dryRun: true },
    );
    expect(status).toBe(200);
    const after = await call(
      "GET",
      `https://example.test/api/v2/${OWNER}/channels`,
      "@/app/api/v2/[user]/channels/route",
      { user: OWNER },
      { token },
    );
    expect(after.body.mail).toBe(before.body.mail);
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { writeTripFixture } from "./fixtures/content";

/**
 * Trip links, the owner's side — B-2963. Creating a link refuses a trip that
 * is not shared with guests (on the server, not only in the form); Stop and
 * Stop-and-remove differ in what happens to the keeps; one keep can be
 * removed; letting in a keeper opens the journal and no buddy request; every
 * new door is the owner's cookie only.
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
const PRIVATE_TRIP = "secret-2026";
const BUDDY_TRIP = "robins-2026";
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

async function db() {
  const { getDatabase } = await import("@/lib/db");
  return (await getDatabase()).db;
}

async function signInOwner() {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, OWNER_EMAIL, "guest");
  const session = await verifyCode(OWNER, OWNER_EMAIL, code, "guest");
  if (!session.ok) throw new Error("owner sign-in failed");
  jar.cookies = { fs_session: session.token };
}

function req(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(`https://example.test${url}`, {
    method,
    headers: { "content-type": "application/json", host: "example.test", origin: "https://example.test", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function create(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  const { POST } = await import("@/app/api/web/[user]/trip-links/route");
  return POST(req("POST", `/api/web/${OWNER}/trip-links`, body, headers), { params: Promise.resolve({ user: OWNER }) });
}
async function stopAndRemove(id: string, headers: Record<string, string> = {}) {
  const { DELETE } = await import("@/app/api/web/[user]/trip-links/[id]/route");
  return DELETE(req("DELETE", `/api/web/${OWNER}/trip-links/${id}`, undefined, headers), {
    params: Promise.resolve({ user: OWNER, id }),
  });
}
async function plainStop(id: string) {
  const { DELETE } = await import("@/app/api/web/[user]/invites/[id]/route");
  return DELETE(req("DELETE", `/api/web/${OWNER}/invites/${id}`), { params: Promise.resolve({ user: OWNER, id }) });
}
async function removeOne(keepId: string, headers: Record<string, string> = {}) {
  const { DELETE } = await import("@/app/api/web/[user]/trip-links/keeps/[keepId]/route");
  return DELETE(req("DELETE", `/api/web/${OWNER}/trip-links/keeps/${keepId}`, undefined, headers), {
    params: Promise.resolve({ user: OWNER, keepId }),
  });
}
async function letIn(contactId: string) {
  const { POST } = await import("@/app/api/web/[user]/readers/letin/route");
  return POST(req("POST", `/api/web/${OWNER}/readers/letin`, { contactId }), { params: Promise.resolve({ user: OWNER }) });
}

/** A person who proved an address and kept the link's trip, through the real keep door. */
async function keeper(link: { id: string; code: string }, email: string, name: string) {
  const { issueCode } = await import("@/lib/auth");
  const { openToken } = await import("@/lib/tripLink");
  const { POST } = await import("@/app/t/[code]/keep/route");
  const { code } = await issueCode(OWNER, email, "guest");
  const owner = jar.cookies; // the keep door signs the visitor in; the owner's cookie comes back after
  jar.cookies = {};
  const res = await POST(
    req("POST", `/t/${link.code}/keep`, { action: "verify", email, code, name, token: openToken(link.code) }),
    { params: Promise.resolve({ code: link.code }) },
  );
  jar.cookies = owner;
  expect(res.status).toBe(200);
  const { getContactByEmail } = await import("@/lib/contacts");
  return (await getContactByEmail(OWNER, email))!;
}

async function mint(tripId = TRIP) {
  const { createInvite } = await import("@/lib/contacts/invites");
  const made = await createInvite(OWNER, { kind: "read", tripId });
  return { id: made.id, code: made.readCode! };
}

const inviteRow = async (id: string) =>
  (await db()).selectFrom("contact_invites").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
const keepRows = async () => (await db()).selectFrom("trip_link_keeps").selectAll().execute();

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-tlread-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.CONTACTS_ENCRYPTION_KEY = "44".repeat(32);
  process.env.SESSION_SECRET = "55".repeat(32);
  writeConfigs();
  writeTripFixture(OWNER, { id: TRIP, title: "Alps", start: "2026-08-25", end: "2026-08-26", status: "past", visibility: "guest" });
  writeTripFixture(OWNER, { id: PRIVATE_TRIP, title: "Secret", start: "2026-09-01", end: "2026-09-02", status: "past", visibility: "private" });
  writeTripFixture(OWNER, { id: BUDDY_TRIP, title: "Robins", start: "2026-07-01", end: "2026-07-02", status: "past", visibility: "guest" });
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
  await d.deleteFrom("trip_people").execute();
  await d.deleteFrom("access_grants").execute();
  await d.deleteFrom("contacts").execute();
  await d.deleteFrom("contact_invites").execute();
  await signInOwner();
});

afterAll(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  for (const k of ["CONTENT_DIR", "DATA_DIR", "DATABASE_URL", "CONTACTS_ENCRYPTION_KEY", "SESSION_SECRET"]) delete process.env[k];
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("creating a trip link", () => {
  test("a guest trip gets a /t/ link; never-expires and a year both work", async () => {
    const res = await create({ trip: TRIP, neverExpires: true });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.url).toMatch(/^https:\/\/example\.test\/t\/[a-z0-9]{16}$/);
    expect(body.expiresAt).toBeNull();
    expect((await inviteRow(body.id)).kind).toBe("read");

    const year = await (await create({ trip: TRIP, days: 365 })).json();
    expect(year.expiresAt).not.toBeNull();
  });

  test("a private trip is refused on the server, and so is an unknown one; nothing is written", async () => {
    const refused = await create({ trip: PRIVATE_TRIP });
    expect(refused.status).toBe(409);
    expect((await refused.json()).error).toBe("trip_not_shared");
    expect((await create({ trip: "nope" })).status).toBe(404);
    expect(await (await db()).selectFrom("contact_invites").selectAll().execute()).toEqual([]);
  });

  test("a bearer token, a foreign Origin and a stranger are all refused", async () => {
    expect((await create({ trip: TRIP }, { authorization: "Bearer fs_x" })).status).toBe(403);
    expect((await create({ trip: TRIP }, { origin: "https://evil.test" })).status).toBe(403);
    jar.cookies = {};
    expect((await create({ trip: TRIP })).status).toBe(403);
    expect(await (await db()).selectFrom("contact_invites").selectAll().execute()).toEqual([]);
  });
});

describe("Stop, and Stop and remove the people who kept it", () => {
  test("plain Stop ends the link and leaves the keepers", async () => {
    const link = await mint();
    await keeper(link, "pia@example.test", "Pia");
    expect((await plainStop(link.id)).status).toBe(200);
    expect((await inviteRow(link.id)).revoked_at).not.toBeNull();
    expect((await keepRows()).filter((k) => k.revoked_at === null)).toHaveLength(1);
  });

  test("Stop and remove ends the link and every keep through it, and no other link's", async () => {
    const link = await mint();
    const other = await mint(BUDDY_TRIP);
    await keeper(link, "pia@example.test", "Pia");
    await keeper(link, "otto@example.test", "Otto");
    await keeper(other, "uma@example.test", "Uma");

    const res = await stopAndRemove(link.id);
    expect(res.status).toBe(200);
    expect((await inviteRow(link.id)).revoked_at).not.toBeNull();
    expect((await inviteRow(other.id)).revoked_at).toBeNull();
    const rows = await keepRows();
    expect(rows.filter((k) => k.invite_id === link.id).every((k) => k.revoked_at !== null)).toBe(true);
    expect(rows.filter((k) => k.invite_id === other.id).every((k) => k.revoked_at === null)).toBe(true);
    // The people stay on the list.
    const { listContacts } = await import("@/lib/contacts");
    expect((await listContacts(OWNER)).length).toBe(3);
  });

  test("an id that is not a read link is not found, and the guards hold", async () => {
    const { createInvite } = await import("@/lib/contacts/invites");
    const guest = await createInvite(OWNER, { kind: "guest" });
    expect((await stopAndRemove(guest.id)).status).toBe(404);
    expect((await inviteRow(guest.id)).revoked_at).toBeNull();

    const link = await mint();
    expect((await stopAndRemove(link.id, { authorization: "Bearer fs_x" })).status).toBe(403);
    expect((await stopAndRemove(link.id, { origin: "https://evil.test" })).status).toBe(403);
    expect((await inviteRow(link.id)).revoked_at).toBeNull();
  });
});

describe("Remove one saved trip", () => {
  test("ends that keep only; refused for a bearer token and a foreign Origin", async () => {
    const link = await mint();
    await keeper(link, "pia@example.test", "Pia");
    await keeper(link, "otto@example.test", "Otto");
    const [first, second] = await keepRows();

    expect((await removeOne(first.id, { authorization: "Bearer fs_x" })).status).toBe(403);
    expect((await removeOne(first.id, { origin: "https://evil.test" })).status).toBe(403);
    expect((await keepRows()).every((k) => k.revoked_at === null)).toBe(true);

    expect((await removeOne(first.id)).status).toBe(200);
    const after = await keepRows();
    expect(after.find((k) => k.id === first.id)!.revoked_at).not.toBeNull();
    expect(after.find((k) => k.id === second.id)!.revoked_at).toBeNull();
    expect((await removeOne(first.id)).status).toBe(404);
  });

  test("the Readers page data lists live keeps and keepers' names", async () => {
    const link = await mint();
    const pia = await keeper(link, "pia@example.test", "Pia");
    const { liveKeeps, readLinkExtras } = await import("@/lib/tripLink");
    expect((await liveKeeps(OWNER)).map((k) => k.contactId)).toEqual([pia.id]);
    const extra = (await readLinkExtras(OWNER)).get(link.id)!;
    expect(extra.keeperIds).toEqual([pia.id]);
    expect(extra.url).toBe(`https://example.test/t/${link.code}`);
    await stopAndRemove(link.id);
    const after = (await readLinkExtras(OWNER)).get(link.id)!;
    expect(after.keeperIds).toEqual([]);
    expect(after.url).toBeNull();
  });
});

describe("Let in for somebody who kept a trip", () => {
  test("opens the journal and approves no pending buddy place", async () => {
    const link = await mint();
    const pia = await keeper(link, "pia@example.test", "Pia");
    expect(pia).toMatchObject({ status: "pending", createdVia: `read:${link.id}` });
    // An old buddy request that is still waiting.
    const { claimTripPlace, pendingTripRequestsFor } = await import("@/lib/tripPeople");
    await claimTripPlace(OWNER, BUDDY_TRIP, pia.id, null);
    expect((await pendingTripRequestsFor(OWNER)).get(pia.id)).toEqual([BUDDY_TRIP]);

    const res = await letIn(pia.id);
    expect(res.status).toBe(200);
    expect((await res.json()).tripsOpened).toEqual([]);
    const { getContact } = await import("@/lib/contacts");
    expect((await getContact(OWNER, pia.id))!.status).toBe("active");
    // Still waiting; read-level grant exists.
    expect((await pendingTripRequestsFor(OWNER)).get(pia.id)).toEqual([BUDDY_TRIP]);
    const grants = await (await db()).selectFrom("access_grants").select("scope").where("contact_id", "=", pia.id).execute();
    expect(grants).toEqual([{ scope: "read" }]);
  });
});

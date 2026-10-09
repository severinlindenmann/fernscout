import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { writeDayFixture, writeTripFixture } from "./fixtures/content";

/**
 * The link bar helper — B-2964. True for a browser let in by the cookie alone;
 * false for a keeper, the owner, a journal guest and a public trip, which
 * never reads the link cookie.
 */

const jar = vi.hoisted(() => ({ cookies: {} as Record<string, string>, reads: [] as string[] }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.reads.push(name), jar.cookies[name] === undefined ? undefined : { value: jar.cookies[name] }),
    set: (name: string, value: string) => {
      jar.cookies[name] = value;
    },
  }),
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.60" }),
}));

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
const ALPS = "alps-2026"; // guest, costs for guests only
const HIKE = "hike-2026"; // guest, costs public
const SECRET = "secret-2026"; // private
const OPEN = "open-2026"; // public
let dir: string;

type Link = { id: string; code: string };
let alps: Link;
let hike: Link;

function writeConfigs() {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: { auth: { enabled: true }, contacts: { enabled: true }, costs: { enabled: true } },
    }),
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
      features: { auth: { enabled: true }, contacts: { enabled: true }, costs: { enabled: true } },
    }),
  );
}

const DAYS = [
  { slug: "plain", visibility: undefined, status: undefined },
  { slug: "guestnote", visibility: "guest" as const, status: undefined },
  { slug: "privnote", visibility: "private" as const, status: undefined },
  { slug: "drafty", visibility: undefined, status: "draft" as const },
];

function writeTrip(id: string, visibility: "public" | "guest" | "private", costs: "public" | "guests", status: "current" | "past") {
  const root = path.join(dir, OWNER, "trips", id);
  writeTripFixture(OWNER, {
    id,
    title: id,
    start: "2026-08-25",
    end: "2026-08-26",
    status,
    visibility,
    costsVisibility: costs,
  });
  for (const [i, d] of DAYS.entries()) {
    fs.mkdirSync(path.join(root, "media", d.slug), { recursive: true });
    fs.writeFileSync(path.join(root, "media", d.slug, "01.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xdb]));
    writeDayFixture(dir, OWNER, id, {
      slug: d.slug,
      date: "2026-08-25",
      title: d.slug,
      time: `${String(9 + i).padStart(2, "0")}:00`,
      location: "Bellinzona",
      country: "Switzerland",
      coordinates: { lat: 46.19, lng: 9.02 },
      visibility: d.visibility,
      status: d.status,
      media: [{ src: `/media/${id}/${d.slug}/01.jpg`, type: "image" }],
      content: `Update ${i}.`,
    });
  }
}

async function mint(tripId: string, input: { expiresAt?: string | null } = {}): Promise<Link> {
  const { createInvite } = await import("@/lib/contacts/invites");
  const made = await createInvite(OWNER, { kind: "read", tripId, ...input });
  return { id: made.id, code: made.readCode! };
}

async function asLink(link: Link | null) {
  const { LINK_COOKIE, linkCookieValue } = await import("@/lib/tripLink");
  jar.cookies = link ? { [LINK_COOKIE]: linkCookieValue(link.id, link.code) } : {};
}

async function trip(id: string) {
  const { getTrip, tripRef } = await import("@/lib/trips");
  return getTrip(tripRef(OWNER, id))!;
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-tlgate-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.CONTACTS_ENCRYPTION_KEY = "44".repeat(32);
  process.env.SESSION_SECRET = "55".repeat(32);
  writeConfigs();
  writeTrip(ALPS, "guest", "guests", "current");
  writeTrip(HIKE, "guest", "public", "past");
  writeTrip(SECRET, "private", "guests", "past");
  writeTrip(OPEN, "public", "guests", "past");
  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  clearConfigCache();
  clearUserCache();
  alps = await mint(ALPS);
  hike = await mint(HIKE);
});

beforeEach(() => {
  jar.cookies = {};
});

afterAll(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  for (const k of ["CONTENT_DIR", "DATABASE_URL", "CONTACTS_ENCRYPTION_KEY", "SESSION_SECRET"]) delete process.env[k];
  fs.rmSync(dir, { recursive: true, force: true });
});

async function signIn(email: string) {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, email, "guest");
  const session = await verifyCode(OWNER, email, code, "guest");
  if (!session.ok) throw new Error("sign-in failed");
  return session.token;
}

describe("linkOnlyReader", () => {
  test("true for the cookie alone, false for no cookie", async () => {
    const { linkOnlyReader } = await import("@/lib/tripGate");
    await asLink(alps);
    expect(await linkOnlyReader(await trip(ALPS))).toBe(true);
    await asLink(null);
    expect(await linkOnlyReader(await trip(ALPS))).toBe(false);
  });

  test("false for the owner, even holding the cookie", async () => {
    const { linkOnlyReader } = await import("@/lib/tripGate");
    await asLink(alps);
    jar.cookies.fs_session = await signIn(OWNER_EMAIL);
    expect(await linkOnlyReader(await trip(ALPS))).toBe(false);
  });

  test("false for a keeper and for an approved journal guest", async () => {
    const { requestContact, getContactByEmail, approveContact, confirmContactByOwner } = await import("@/lib/contacts");
    const { getDatabase } = await import("@/lib/db");
    const { linkOnlyReader } = await import("@/lib/tripGate");
    const { db } = await getDatabase();

    const keeperMail = "keeper@example.test";
    await requestContact(OWNER, { name: "Keeper", email: keeperMail, locale: "en", address: null, wantsEmailDigest: false, wantsPostcard: false, createdVia: `read:${alps.id}` });
    const keeper = (await getContactByEmail(OWNER, keeperMail))!;
    await db.insertInto("trip_link_keeps").values({ id: "k-bar", owner_id: OWNER, trip_id: ALPS, invite_id: alps.id, contact_id: keeper.id, kept_at: "2026-10-01T00:00:00Z", revoked_at: null }).execute();
    await asLink(alps);
    jar.cookies.fs_session = await signIn(keeperMail);
    expect(await linkOnlyReader(await trip(ALPS))).toBe(false);

    const guestMail = "guest@example.test";
    await requestContact(OWNER, { name: "Guest", email: guestMail, locale: "en", address: null, wantsEmailDigest: false, wantsPostcard: false, createdVia: "request" });
    const token = await signIn(guestMail);
    const guest = (await getContactByEmail(OWNER, guestMail))!;
    await confirmContactByOwner(OWNER, guest.id);
    expect(await approveContact(OWNER, guest.id)).not.toBeNull();
    await asLink(alps);
    jar.cookies.fs_session = token;
    expect(await linkOnlyReader(await trip(ALPS))).toBe(false);
  });

  test("a public trip never reads the link cookie", async () => {
    const { linkOnlyReader } = await import("@/lib/tripGate");
    const { LINK_COOKIE } = await import("@/lib/tripLink");
    await asLink(alps);
    jar.reads.length = 0;
    expect(await linkOnlyReader(await trip(OPEN))).toBe(false);
    expect(jar.reads).not.toContain(LINK_COOKIE);
  });
});

describe("readsOnlyThroughLink", () => {
  test("true for the cookie and for a keeper; false for nobody, the owner and an approved guest", async () => {
    const { requestContact, getContactByEmail, approveContact, confirmContactByOwner } = await import("@/lib/contacts");
    const { getDatabase } = await import("@/lib/db");
    const { readsOnlyThroughLink } = await import("@/lib/tripGate");
    const { db } = await getDatabase();

    await asLink(null);
    expect(await readsOnlyThroughLink(await trip(ALPS))).toBe(false);
    await asLink(alps);
    expect(await readsOnlyThroughLink(await trip(ALPS))).toBe(true);
    jar.cookies.fs_session = await signIn(OWNER_EMAIL);
    expect(await readsOnlyThroughLink(await trip(ALPS))).toBe(false);

    const keeperMail = "keeper2@example.test";
    await requestContact(OWNER, { name: "Keeper", email: keeperMail, locale: "en", address: null, wantsEmailDigest: false, wantsPostcard: false, createdVia: `read:${alps.id}` });
    const keeper = (await getContactByEmail(OWNER, keeperMail))!;
    await db.insertInto("trip_link_keeps").values({ id: "k-rotl", owner_id: OWNER, trip_id: ALPS, invite_id: alps.id, contact_id: keeper.id, kept_at: "2026-10-01T00:00:00Z", revoked_at: null }).execute();
    await asLink(null);
    jar.cookies.fs_session = await signIn(keeperMail);
    expect(await readsOnlyThroughLink(await trip(ALPS))).toBe(true);

    const guestMail = "guest2@example.test";
    await requestContact(OWNER, { name: "Guest", email: guestMail, locale: "en", address: null, wantsEmailDigest: false, wantsPostcard: false, createdVia: "request" });
    const token = await signIn(guestMail);
    const guest = (await getContactByEmail(OWNER, guestMail))!;
    await confirmContactByOwner(OWNER, guest.id);
    expect(await approveContact(OWNER, guest.id)).not.toBeNull();
    await asLink(alps);
    jar.cookies.fs_session = token;
    expect(await readsOnlyThroughLink(await trip(ALPS))).toBe(false);
  });
});

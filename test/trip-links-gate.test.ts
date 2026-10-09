import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { writeDayFixture, writeTripFixture } from "./fixtures/content";

/**
 * Trip links, the gate side — B2961 (AC1, AC2, AC5, AC7). A browser holding a
 * `read` link's cookie reads that one guest trip at public reader level and
 * nothing else; Stop, private and rename behave; the cookie is read by the
 * trip gate and by nothing else.
 */

const jar = vi.hoisted(() => ({ cookies: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.cookies[name] === undefined ? undefined : { value: jar.cookies[name] }),
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

async function photo(tripId: string, slug: string) {
  const { GET } = await import("@/app/at/[user]/media/[...path]/route");
  const segments = [tripId, slug, "01.jpg"];
  return GET(new Request(`https://example.test/@${OWNER}/media/${segments.join("/")}`), {
    params: Promise.resolve({ user: OWNER, path: segments }),
  } as never);
}

async function story(tripId: string) {
  const { GET } = await import("@/app/at/[user]/story.json/route");
  return GET(new Request(`https://example.test/@${OWNER}/story.json?trip=${tripId}&from=0&to=20`), {
    params: Promise.resolve({ user: OWNER }),
  } as never);
}

describe("AC1 — a link opens its own trip and no other", () => {
  test("without the cookie the guest trip is closed", async () => {
    const { mayReadTrip } = await import("@/lib/tripGate");
    expect(await mayReadTrip(await trip(ALPS))).toBe(false);
    expect((await photo(ALPS, "plain")).status).toBe(404);
    expect((await story(ALPS)).status).toBe(403);
  });

  test("with trip A's cookie: A's pages, media, story.json and card.svg open", async () => {
    await asLink(alps);
    const { mayReadTrip } = await import("@/lib/tripGate");
    expect(await mayReadTrip(await trip(ALPS))).toBe(true);
    expect((await photo(ALPS, "plain")).status).toBe(200);
    const res = await story(ALPS);
    expect(res.status).toBe(200);
    const { GET } = await import("@/app/at/[user]/card.svg/route");
    const card = await GET(new Request(`https://example.test/@${OWNER}/card.svg`), {
      params: Promise.resolve({ user: OWNER }),
    } as never);
    expect(card.status).toBe(200);
  });

  test("guest trip B in the same journal, and B's media, stay refused", async () => {
    await asLink(alps);
    const { mayReadTrip } = await import("@/lib/tripGate");
    expect(await mayReadTrip(await trip(HIKE))).toBe(false);
    expect((await photo(HIKE, "plain")).status).toBe(404);
    expect((await story(HIKE)).status).toBe(403);
  });

  test("a private trip never opens through any link, and a public one needs none", async () => {
    await asLink(alps);
    const { mayReadTrip } = await import("@/lib/tripGate");
    expect(await mayReadTrip(await trip(SECRET))).toBe(false);
    expect(await mayReadTrip(await trip(OPEN))).toBe(true);
  });

  test("a link's cookie value naming another trip's invite does not open this one", async () => {
    const { LINK_COOKIE, linkCookieValue } = await import("@/lib/tripLink");
    // Trip A's invite id with trip B's code: the hash does not match.
    jar.cookies = { [LINK_COOKIE]: linkCookieValue(alps.id, hike.code) };
    const { mayReadTrip } = await import("@/lib/tripGate");
    expect(await mayReadTrip(await trip(ALPS))).toBe(false);
    // A malformed value opens nothing.
    for (const bad of ["", "x", `${alps.id}.`, `.${alps.code}`, `${alps.id}.${alps.code}.x`, `${alps.id}.${alps.code.toUpperCase()}`]) {
      jar.cookies = { [LINK_COOKIE]: bad };
      expect(await mayReadTrip(await trip(ALPS))).toBe(false);
    }
  });
});

describe("AC2 — a link reader is a stranger with one trip", () => {
  test("no guest- or private-labelled photo or day, no draft, no live track", async () => {
    await asLink(alps);
    expect((await photo(ALPS, "plain")).status).toBe(200);
    expect((await photo(ALPS, "guestnote")).status).toBe(404);
    expect((await photo(ALPS, "privnote")).status).toBe(404);
    expect((await photo(ALPS, "drafty")).status).toBe(404);

    const body = await (await story(ALPS)).text();
    expect(body).toContain("plain");
    for (const hidden of ["guestnote", "privnote", "drafty"]) expect(body).not.toContain(hidden);

    const gate = await import("@/lib/tripGate");
    const t = await trip(ALPS);
    expect(await gate.readerLevelFor(t)).toBe("public");
    expect((await gate.draftsVisibleTo(t)).visible).toBe(false);
    expect(await gate.mayReadLiveTrack(t)).toBe(false);
  });

  test("guest-only costs are absent, public costs present", async () => {
    await asLink(alps);
    const { mayViewCosts } = await import("@/lib/tripGate");
    expect(await mayViewCosts(await trip(ALPS))).toBe(false);
    await asLink(hike);
    expect(await mayViewCosts(await trip(HIKE))).toBe(true);
  });

  test("the cookie is not a person: no owner, no traveller, no journal guest", async () => {
    await asLink(alps);
    const { isOwner, journalReader } = await import("@/lib/contacts/session");
    const { resolveAccess } = await import("@/lib/auth/handshake");
    expect(await isOwner(OWNER)).toBe(false);
    expect((await journalReader(OWNER)).guest).toBe(false);
    expect((await resolveAccess(OWNER)).email).toBeNull();
  });
});

describe("AC5 — private, Stop, expiry, rename, delete", () => {
  test("media served to a link reader is private, no-store", async () => {
    await asLink(alps);
    const res = await photo(ALPS, "plain");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  test("Stop ends the cookie on the next request; an expired link does too", async () => {
    const stopped = await mint(HIKE);
    const expired = await mint(HIKE, { expiresAt: new Date(Date.now() - 1000).toISOString() });
    const { mayReadTrip } = await import("@/lib/tripGate");
    const { revokeInvite } = await import("@/lib/contacts/invites");
    const t = await trip(HIKE);
    await asLink(stopped);
    expect(await mayReadTrip(t)).toBe(true);
    await revokeInvite(OWNER, stopped.id);
    // `linkAccess` is cached per request in a server render; a new request is a new call.
    expect(await mayReadTrip({ ...t })).toBe(false);
    await asLink(expired);
    expect(await mayReadTrip({ ...t })).toBe(false);
  });

  test("trip made private: refused; back to guest: works again", async () => {
    const { readTripFile, writeTripFile } = await import("@/lib/api/v2/store");
    const { mayReadTrip } = await import("@/lib/tripGate");
    const { clearTripCache } = await import("@/lib/trips").then((m) => ({ clearTripCache: (m as Record<string, unknown>).clearTripCache as (() => void) | undefined }));
    const doc = readTripFile(OWNER, ALPS)!;
    await asLink(alps);
    writeTripFile(OWNER, ALPS, { ...doc, visibility: "private" } as never);
    clearTripCache?.();
    expect(await mayReadTrip({ ...(await trip(ALPS)) })).toBe(false);
    const { resolveReadCode } = await import("@/lib/tripLink");
    expect(await resolveReadCode(alps.code)).toBeNull();
    writeTripFile(OWNER, ALPS, { ...doc, visibility: "guest" } as never);
    clearTripCache?.();
    expect(await mayReadTrip({ ...(await trip(ALPS)) })).toBe(true);
  });

  test("a rename keeps the link; a delete removes its rows", async () => {
    const renamed = await mint(HIKE);
    const { renameTrip } = await import("@/lib/tripRename");
    const done = await renameTrip(OWNER, HIKE, "hike-renamed-2026");
    expect(done.ok).toBe(true);
    const { resolveReadCode } = await import("@/lib/tripLink");
    expect((await resolveReadCode(renamed.code))?.trip.id).toBe("hike-renamed-2026");

    const { getDatabase } = await import("@/lib/db");
    const { db } = await getDatabase();
    await db
      .insertInto("trip_link_keeps")
      .values({ id: "k1", owner_id: OWNER, trip_id: "hike-renamed-2026", invite_id: renamed.id, contact_id: "c1", kept_at: "2026-10-01T00:00:00Z", revoked_at: null })
      .execute();
    const { deleteTrip } = await import("@/lib/deletions");
    await deleteTrip(OWNER, "hike-renamed-2026", OWNER_EMAIL);
    const invites = await db.selectFrom("contact_invites").select("id").where("trip_id", "=", "hike-renamed-2026").execute();
    const keeps = await db.selectFrom("trip_link_keeps").select("id").where("trip_id", "=", "hike-renamed-2026").execute();
    expect(invites).toEqual([]);
    expect(keeps).toEqual([]);
    expect(await resolveReadCode(renamed.code)).toBeNull();
  });
});

describe("the kept branch (rows are written by the keep door, child 2)", () => {
  test("a signed-in, unblocked contact with a live keep row reads; blocked, revoked or no row does not", async () => {
    const { requestContact, getContactByEmail, revokeContact } = await import("@/lib/contacts");
    const { issueCode, verifyCode } = await import("@/lib/auth");
    const email = "keeper@example.test";
    await requestContact(OWNER, {
      name: "Keeper", email, locale: "en", address: null, wantsEmailDigest: false, wantsPostcard: false, createdVia: `read:${alps.id}`,
    });
    const contact = (await getContactByEmail(OWNER, email))!;
    const { code } = await issueCode(OWNER, email, "guest");
    const session = await verifyCode(OWNER, email, code, "guest");
    if (!session.ok) throw new Error("sign-in failed");
    jar.cookies = { fs_session: session.token };

    const { mayReadTrip } = await import("@/lib/tripGate");
    const { getDatabase } = await import("@/lib/db");
    const { db } = await getDatabase();
    const t = await trip(ALPS);
    expect(await mayReadTrip(t)).toBe(false); // pending, no keep row

    await db.insertInto("trip_link_keeps").values({ id: "k-alps", owner_id: OWNER, trip_id: ALPS, invite_id: alps.id, contact_id: contact.id, kept_at: "2026-10-01T00:00:00Z", revoked_at: null }).execute();
    expect(await mayReadTrip(t)).toBe(true);
    expect(await mayReadTrip(await trip(OPEN))).toBe(true); // public needs nothing
    expect((await photo(ALPS, "plain")).headers.get("cache-control")).toBe("private, no-store");
    expect((await photo(ALPS, "guestnote")).status).toBe(404);

    await db.updateTable("trip_link_keeps").set({ revoked_at: "2026-10-02T00:00:00Z" }).where("id", "=", "k-alps").execute();
    expect(await mayReadTrip(t)).toBe(false);
    await db.updateTable("trip_link_keeps").set({ revoked_at: null }).where("id", "=", "k-alps").execute();
    await revokeContact(OWNER, contact.id);
    expect(await mayReadTrip(t)).toBe(false);
  });
});

describe("AC7 — the link cookie is read by the trip gate alone", () => {
  function walk(d: string, out: string[] = []): string[] {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, out);
      else if (/\.tsx?$/.test(e.name)) out.push(p);
    }
    return out;
  }

  test("only lib/tripLink.ts, the press and the media route name the cookie or linkAccess", () => {
    const root = path.resolve(__dirname, "..");
    const hits = [...walk(path.join(root, "app")), ...walk(path.join(root, "lib")), ...walk(path.join(root, "components"))]
      .filter((f) => /LINK_COOKIE|linkAccess|fs_link/.test(fs.readFileSync(f, "utf8")))
      .map((f) => path.relative(root, f))
      .sort();
    expect(hits).toEqual([
      "app/at/[user]/media/[...path]/route.ts",
      "app/t/[code]/open/route.ts",
      "lib/tripGate.ts",
      "lib/tripLink.ts",
    ]);
  });

  test("with only the cookie, the identity-bearing doors see nobody", async () => {
    await asLink(alps);
    const { resolveAccess } = await import("@/lib/auth/handshake");
    const access = await resolveAccess(OWNER);
    expect(access.email).toBeNull();
    const { POST } = await import("@/app/api/contacts/self/route");
    const res = await POST(
      new Request("https://example.test/api/contacts/self", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://example.test" },
        body: JSON.stringify({ owner: OWNER, name: "X" }),
      }),
    );
    expect([401, 403, 404]).toContain(res.status);
  });
});

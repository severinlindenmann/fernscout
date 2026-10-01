import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { writeDayFixture, writeTripFixture } from "./fixtures/content";

/**
 * Telling only chosen reader groups when a day goes up — TIX-6 phase 2.
 *
 * The studio's publish step names groups; the server turns them into people
 * and narrows the email and the app notification to them. It only ever
 * narrows: the owner's own copy still goes, nobody outside the trip's readers
 * is ever added, and absent a choice everything behaves as before.
 */

const jar = vi.hoisted(() => ({ cookies: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.cookies[name] === undefined ? undefined : { value: jar.cookies[name] }),
    set: () => {},
    delete: () => {},
  }),
}));

const OWNER = "alex";
const OWNER_EMAIL = "alex@example.test";
const TRIP = "lisbon-2026";
let dir: string;

function mailedTo(): string[] {
  const mailDir = path.join(dir, "mail", OWNER);
  if (!fs.existsSync(mailDir)) return [];
  return fs
    .readdirSync(mailDir)
    .map((f) => fs.readFileSync(path.join(mailDir, f), "utf8").match(/^To: (.+)$/m)?.[1]?.trim() ?? "")
    .filter(Boolean);
}

function clearMail() {
  fs.rmSync(path.join(dir, "mail"), { recursive: true, force: true });
}

function writeDraft(slug: string, date: string) {
  const declined: Record<string, string> = {};
  for (const field of ["media", "costs", "weather", "time", "timezone", "countryCode", "transportMode", "tags", "translations", "visibility"]) {
    declined[field] = "n/a for this fixture";
  }
  writeDayFixture(dir, OWNER, TRIP, {
    slug,
    date,
    title: `Day ${slug}`,
    content: "We walked up to the castle.",
    location: "Lisbon",
    country: "Portugal",
    coordinates: { lat: 38.71, lng: -9.13 },
    status: "draft",
    declined,
  });
}

async function addReader(name: string, email: string): Promise<string> {
  const { requestContact, confirmContact, approveContact } = await import("@/lib/contacts");
  const { issueCode } = await import("@/lib/auth");
  await requestContact(OWNER, { name, email, locale: "en", address: null, wantsEmailDigest: true, wantsPostcard: false, createdVia: "open" });
  const { code } = await issueCode(OWNER, email, "guest");
  const confirmed = await confirmContact(OWNER, email, code);
  if (!confirmed.ok) throw new Error("confirmation failed");
  await approveContact(OWNER, confirmed.contact.id);
  return confirmed.contact.id;
}

async function signInOwner() {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, OWNER_EMAIL, "guest");
  const session = await verifyCode(OWNER, OWNER_EMAIL, code, "guest");
  if (!session.ok) throw new Error("owner sign-in failed");
  jar.cookies = { fs_session: session.token };
}

async function publish(slug: string, body: Record<string, unknown>) {
  const { POST } = await import("@/app/api/web/[user]/trips/[trip]/days/[slug]/publish/route");
  return POST(
    new Request(`https://example.test/api/web/${OWNER}/trips/${TRIP}/days/${slug}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user: OWNER, trip: TRIP, slug }) },
  );
}

let family = "";
let friends = "";
let anna = "";
let mia = "";
let sara = "";

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-tell-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.CONTACTS_ENCRYPTION_KEY = "66".repeat(32);
  process.env.SESSION_SECRET = "77".repeat(32);
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: { auth: { enabled: true }, contacts: { enabled: true }, mail: { enabled: true, transport: "file" } },
    }),
  );
  fs.mkdirSync(path.join(dir, OWNER), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Two Backpacks",
      owner: { name: "Alex B", nickname: "Alex", email: OWNER_EMAIL },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      features: { auth: { enabled: true }, contacts: { enabled: true }, mail: { enabled: true } },
    }),
  );
  writeTripFixture(OWNER, { id: TRIP, title: "Lisbon", start: "2026-09-01", end: "2026-09-10", status: "current", visibility: "guest" });
  writeDraft("castle", "2026-09-02");
  writeDraft("belem", "2026-09-03");
  writeDraft("sintra", "2026-09-04");
  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  clearConfigCache();
  clearUserCache();

  anna = await addReader("Anna", "anna@example.test");
  mia = await addReader("Mia", "mia@example.test");
  sara = await addReader("Sara", "sara@example.test");
  const { createGroup, setContactGroup } = await import("@/lib/contacts/groups");
  const f = await createGroup(OWNER, { name: "Family" });
  const g = await createGroup(OWNER, { name: "Friends" });
  if (!f.ok || !g.ok) throw new Error("groups");
  family = f.value.id;
  friends = g.value.id;
  await setContactGroup(OWNER, anna, family);
  await setContactGroup(OWNER, mia, friends);
});

beforeEach(async () => {
  const { resetRateLimitsForTests } = await import("@/lib/rateLimit");
  resetRateLimitsForTests();
  await signInOwner();
  clearMail();
});

afterAll(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  for (const key of ["CONTENT_DIR", "DATA_DIR", "DATABASE_URL", "CONTACTS_ENCRYPTION_KEY", "SESSION_SECRET"]) delete process.env[key];
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("publish tells only the chosen groups", () => {
  test("Family only: the email goes to Anna and the owner, not to Mia or Sara", async () => {
    const res = await publish("castle", { tell: { groups: [family], mail: true } });
    expect(res.status).toBe(200);
    expect(mailedTo().sort()).toEqual([OWNER_EMAIL, "anna@example.test"].sort());
  });

  test("the choice is remembered for the next day of this trip", async () => {
    const { getTellChoice } = await import("@/lib/digest/tellChoice");
    expect(await getTellChoice(OWNER, TRIP)).toEqual({ groups: [family], mail: true });
  });

  test("'No group' reaches readers in no group; mail off sends no email at all", async () => {
    const { contactsInGroups } = await import("@/lib/digest/tellChoice");
    expect([...(await contactsInGroups(OWNER, ["none"]))]).toEqual([sara]);
    const res = await publish("belem", { tell: { groups: ["none"], mail: false } });
    expect(res.status).toBe(200);
    expect(mailedTo()).toEqual([]);
  });

  test("everyone (null) mails every reader, as before", async () => {
    const res = await publish("sintra", { tell: { groups: null, mail: true } });
    expect(res.status).toBe(200);
    expect(mailedTo().sort()).toEqual([OWNER_EMAIL, "anna@example.test", "mia@example.test", "sara@example.test"].sort());
  });

  test("another journal's group id narrows to nobody, never widens", async () => {
    const { contactsInGroups } = await import("@/lib/digest/tellChoice");
    expect((await contactsInGroups(OWNER, ["not-a-group"])).size).toBe(0);
  });
});

describe("push narrows the same way", () => {
  test("subscribersFor keeps the owner's devices and the chosen readers only", async () => {
    const { saveSubscription, subscribersFor } = await import("@/lib/push");
    const base = { keys: { p256dh: "p", auth: "a" }, created: "2026-09-01", username: OWNER };
    await saveSubscription({ ...base, endpoint: "https://push.test/anna", contactId: anna });
    await saveSubscription({ ...base, endpoint: "https://push.test/mia", contactId: mia });
    await saveSubscription({ ...base, endpoint: "https://push.test/owner", contactId: null, isOwner: true });
    const { getTrip, tripRef } = await import("@/lib/trips");
    const trip = getTrip(tripRef(OWNER, TRIP))!;
    const all = await subscribersFor(trip, {});
    expect(all.map((s) => s.endpoint).sort()).toEqual(["https://push.test/anna", "https://push.test/mia"]);
    const only = await subscribersFor(trip, {}, new Set([anna]));
    expect(only.map((s) => s.endpoint)).toEqual(["https://push.test/anna"]);
  });
});

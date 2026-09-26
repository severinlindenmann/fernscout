import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { writeTripFixture } from "./fixtures/content";

/**
 * `POST /api/contacts/self` — B1395, revisited for D3 (B2297).
 *
 * Before D3, a person the owner typed into a trip's `people:` block had
 * write access and no contacts row, so this door let them write their own.
 * Since D3, `people:` grants nothing (`lib/tripPeople.ts`'s file banner):
 * `isPersonOnWith`/`through === "traveller"` means the owner or somebody
 * holding a granted `trip_people` place, and a granted place always already
 * has a contacts row (`claimTripPlace` requires a `contact_id`). So the one
 * scenario this route existed for — a real traveller with no row to offer a
 * manage token for — can no longer happen; a bare `people:` name is refused
 * like any other stranger. Its only remaining job is refusing correctly.
 */

const jar = vi.hoisted(() => ({ cookies: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.cookies[name] === undefined ? undefined : { value: jar.cookies[name] },
  }),
}));

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
/** Named in `trip.md`'s `people:` block, and nowhere in contacts. */
const ROBIN = "robin@example.test";
/** Signed in, and on no trip at all. */
const STRANGER = "anyone@example.test";

let dir: string;
let calls = 0;
function headers(): Record<string, string> {
  calls += 1;
  return { "content-type": "application/json", "x-forwarded-for": `10.3.0.${calls % 250}` };
}

function writeConfig() {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: { auth: { enabled: true }, contacts: { enabled: true } },
    }),
  );
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Two Backpacks",
      tagline: "t",
      owner: { name: "Ana Meyer", nickname: "Ana", email: OWNER_EMAIL },
      startLocation: "X",
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features: { auth: { enabled: true }, contacts: { enabled: true } },
    }),
  );
}

function writeTrip() {
  writeTripFixture(OWNER, {
    id: "asia-2025",
    title: "Asia 2025",
    start: "2025-08-25",
    end: "2025-08-26",
    status: "past",
    visibility: "private",
    people: [{ name: "Robin", email: ROBIN }],
  });
}

async function reloadConfig() {
  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  clearConfigCache();
  clearUserCache();
}

async function signIn(email: string) {
  const { GUEST_COOKIE, issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, email, "guest");
  const session = await verifyCode(OWNER, email, code, "guest");
  if (!session.ok) throw new Error(`sign-in failed for ${email}`);
  jar.cookies[GUEST_COOKIE] = session.token;
}

async function self(body: Record<string, unknown>) {
  const { POST } = await import("@/app/api/contacts/self/route");
  const response = await POST(
    new Request("https://example.test/api/contacts/self", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ user: OWNER, ...body }),
    }),
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

const ADDRESS = {
  name: "Robin",
  line1: "1 Road",
  line2: "",
  postcode: "8001",
  city: "Zurich",
  country: "Switzerland",
  tel: "",
};

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-contacts-self-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.CONTACTS_ENCRYPTION_KEY = "88".repeat(32);
  process.env.SESSION_SECRET = "99".repeat(32);
  delete process.env.AUTH_DEV_CODE;

  fs.mkdirSync(path.join(dir, OWNER, "trips"), { recursive: true });
  writeConfig();
  writeTrip();
  await reloadConfig();

  const { migrateToLatest } = await import("@/lib/db/migrate");
  const { getDatabase } = await import("@/lib/db");
  await migrateToLatest(await getDatabase());
});

afterAll(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  for (const key of ["CONTENT_DIR", "DATABASE_URL", "CONTACTS_ENCRYPTION_KEY", "SESSION_SECRET"]) {
    delete process.env[key];
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  jar.cookies = {};
});

describe("a bare people: name is not a traveller (D3, B2297)", () => {
  test("is refused with no session at all", async () => {
    const result = await self({ name: "Robin", address: ADDRESS });
    expect(result.status).toBe(401);
  });

  test("is refused for a signed-in reader on no trip", async () => {
    await signIn(STRANGER);
    const result = await self({ name: "Anyone", address: ADDRESS });
    expect(result.status).toBe(403);
  });

  test("is refused for somebody only named in people:, never granted", async () => {
    await signIn(ROBIN);
    const result = await self({ name: "Robin", address: ADDRESS });
    expect(result.status).toBe(403);

    const { getContactByEmail } = await import("@/lib/contacts");
    expect(await getContactByEmail(OWNER, ROBIN)).toBeNull();
  });

  test("succeeds once that same address holds a granted trip place", async () => {
    const { requestContact, confirmContactByOwner, approveContact } = await import(
      "@/lib/contacts"
    );
    const { claimTripPlace, approveTripPlaces } = await import("@/lib/tripPeople");
    const requested = await requestContact(OWNER, {
      name: "Robin",
      email: ROBIN,
      locale: "en",
      wantsEmailDigest: false,
      wantsPostcard: false,
      wantsWhatsapp: false,
      createdVia: "owner-grant",
    });
    if (requested.contactId) {
      await confirmContactByOwner(OWNER, requested.contactId);
      await approveContact(OWNER, requested.contactId);
      await claimTripPlace(OWNER, "asia-2025", requested.contactId, null);
      await approveTripPlaces(OWNER, requested.contactId);
    }

    await signIn(ROBIN);
    const result = await self({ name: "Robin", address: ADDRESS, wantsPostcard: true });
    expect(result.status).toBe(200);

    const { getContactByEmail } = await import("@/lib/contacts");
    const contact = await getContactByEmail(OWNER, ROBIN);
    expect(contact?.postalAddress?.line1).toBe("1 Road");
    expect(contact?.wantsPostcard).toBe(true);
  });

  /**
   * B2107 — this door shares `requestContact`'s own silent drop
   * (`lib/contacts/index.ts` ~:433 via `isPostable`): a country-less address
   * plus `wantsPostcard: true` used to save with the tick quietly zeroed
   * while the route still answered `{ ok: true }`. It now refuses instead,
   * the same way `/api/contacts/manage` does.
   */
  test("refuses a postcard consent when the submitted address has no country", async () => {
    const { requestContact, confirmContactByOwner, approveContact } = await import(
      "@/lib/contacts"
    );
    const { claimTripPlace, approveTripPlaces } = await import("@/lib/tripPeople");
    const requested = await requestContact(OWNER, {
      name: "Robin",
      email: ROBIN,
      locale: "en",
      wantsEmailDigest: false,
      wantsPostcard: false,
      wantsWhatsapp: false,
      createdVia: "owner-grant",
    });
    if (requested.contactId) {
      await confirmContactByOwner(OWNER, requested.contactId);
      await approveContact(OWNER, requested.contactId);
      await claimTripPlace(OWNER, "asia-2025", requested.contactId, null);
      await approveTripPlaces(OWNER, requested.contactId);
    }

    await signIn(ROBIN);
    const result = await self({
      name: "Robin",
      address: { ...ADDRESS, country: "" },
      wantsPostcard: true,
    });

    expect(result.status).toBe(400);
    expect(result.body.error).toBe("invalid_address");

    const { getContactByEmail } = await import("@/lib/contacts");
    const contact = await getContactByEmail(OWNER, ROBIN);
    expect(contact?.wantsPostcard).toBe(false);
  });
});

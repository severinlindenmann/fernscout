import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * `POST /api/contacts/self` — B1395.
 *
 * A person the owner typed into a trip's `people:` block has write access
 * and, unlike somebody who redeemed a buddy link, no contacts row — nothing
 * on `/<user>/me` could offer them an address field at all. This is the door
 * that writes their own row, in their own words:
 *
 * - gated on **trip write access** (`isPersonOnWith`, via `resolveViewer`),
 *   never on being a contacts "guest" — that is precisely the fact this
 *   person does not yet have;
 * - the address comes off the **session**, always — a stranger cannot use
 *   this to write a row for somebody else's inbox;
 * - the row is **confirmed immediately**, no second six-digit code, because
 *   the session already proved the address;
 * - **grants nothing** — `approveContact` is never called;
 * - saved a second time, it updates the same row rather than making a
 *   second one.
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
  const root = path.join(dir, OWNER, "trips", "asia-2025");
  fs.mkdirSync(path.join(root, "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "trip.md"),
    [
      "---",
      'id: "asia-2025"',
      'title: "Asia 2025"',
      'start: "2025-08-25"',
      'end: "2025-08-26"',
      'status: "past"',
      'visibility: "private"',
      "people:",
      `  - { name: "Robin", email: "${ROBIN}" }`,
      "---",
      "",
      "Intro.",
      "",
    ].join("\n"),
  );
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

describe("a person on a trip's people: writing their own row", () => {
  test("is refused with no session at all", async () => {
    const result = await self({ name: "Robin", address: ADDRESS });
    expect(result.status).toBe(401);
  });

  test("is refused for a signed-in reader on no trip", async () => {
    await signIn(STRANGER);
    const result = await self({ name: "Anyone", address: ADDRESS });
    expect(result.status).toBe(403);
  });

  test("creates a confirmed, ungranted row for somebody named in people:", async () => {
    await signIn(ROBIN);
    const result = await self({
      name: "Robin",
      address: ADDRESS,
      wantsPostcard: true,
    });
    expect(result.status).toBe(200);

    const { getContactByEmail } = await import("@/lib/contacts");
    const contact = await getContactByEmail(OWNER, ROBIN);
    expect(contact?.name).toBe("Robin");
    expect(contact?.createdVia).toBe("self:traveller");
    // The session already proved the address.
    expect(contact?.confirmedAt).not.toBeNull();
    expect(contact?.wantsPostcard).toBe(true);
    expect(contact?.postalAddress?.line1).toBe("1 Road");

    const { hasReadGrant } = await import("@/lib/grants");
    expect(await hasReadGrant(OWNER, contact!.id)).toBe(false);
  });

  test("saved again, corrects the same row rather than making a second one", async () => {
    await signIn(ROBIN);
    await self({ name: "Robin", address: ADDRESS });
    await self({ name: "Robin", address: { ...ADDRESS, city: "Geneva" } });

    const { listContacts } = await import("@/lib/contacts");
    const rows = (await listContacts(OWNER)).filter((c) => c.email === ROBIN);
    expect(rows).toHaveLength(1);
    expect(rows[0].postalAddress?.city).toBe("Geneva");
  });

  test("the owner cannot overwrite what Robin wrote about themselves", async () => {
    await signIn(ROBIN);
    await self({ name: "Robin", address: ADDRESS });

    const { getContactByEmail, updateContactByOwner } = await import("@/lib/contacts");
    const contact = await getContactByEmail(OWNER, ROBIN);
    await expect(
      updateContactByOwner(OWNER, contact!.id, { name: "Renamed by owner" }),
    ).rejects.toThrow();
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * `POST /api/contacts/ask` — B601.
 *
 * The button on the trip gate, for a reader who has signed in and is still
 * shut out. What has to hold, and what each test below is about:
 *
 * - the address comes off the **session**, never the body, so nobody can put
 *   a third party in front of the owner;
 * - it writes a `pending` row and **grants nothing**;
 * - the row is **already confirmed** — the session proved the address, so no
 *   second six-digit code is issued;
 * - one answer for every outcome, including a blocked address, so the button
 *   is not a way of asking what this journal thinks of you;
 * - pressing it twice does not put a second request in front of the owner;
 * - with `contacts` off it is absent rather than broken.
 */

const jar = vi.hoisted(() => ({ cookies: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.cookies[name] === undefined ? undefined : { value: jar.cookies[name] },
    set: (name: string, value: string) => {
      jar.cookies[name] = value;
    },
  }),
}));

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
const READER = "oma@example.test";
const BLOCKED = "spam@example.test";

let dir: string;

/** One address per call — `lib/rateLimit.ts` is a module-level map shared by
 * the whole file, and five of these tests would otherwise be a 429. */
let calls = 0;
function headers(): Record<string, string> {
  calls += 1;
  return { "content-type": "application/json", "x-forwarded-for": `10.2.0.${calls % 250}` };
}

function writeConfig(contacts: boolean) {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: { auth: { enabled: true }, contacts: { enabled: contacts } },
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
      features: { auth: { enabled: true }, contacts: { enabled: contacts } },
    }),
  );
}

async function reloadConfig() {
  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  clearConfigCache();
  clearUserCache();
}

/** Signed in to this journal, the way the gate's own form does it. */
async function signIn(email: string) {
  const { GUEST_COOKIE, issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, email, "guest");
  const session = await verifyCode(OWNER, email, code, "guest");
  if (!session.ok) throw new Error(`sign-in failed for ${email}`);
  jar.cookies[GUEST_COOKIE] = session.token;
}

async function ask(body: Record<string, unknown> = { name: "Oma" }) {
  const { POST } = await import("@/app/api/contacts/ask/route");
  const response = await POST(
    new Request("https://example.test/api/contacts/ask", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ user: OWNER, ...body }),
    }),
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-ask-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.CONTACTS_ENCRYPTION_KEY = "66".repeat(32);
  process.env.SESSION_SECRET = "77".repeat(32);
  delete process.env.AUTH_DEV_CODE;

  fs.mkdirSync(path.join(dir, OWNER, "trips"), { recursive: true });
  writeConfig(true);
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

describe("a signed-in reader asking to be let in", () => {
  test("is put in the owner's queue, confirmed, and granted nothing", async () => {
    await signIn(READER);
    const result = await ask();

    expect(result.status).toBe(202);
    expect(result.body.status).toBe("accepted");

    const { getContactByEmail } = await import("@/lib/contacts");
    const contact = await getContactByEmail(OWNER, READER);
    expect(contact?.status).toBe("pending");
    expect(contact?.name).toBe("Oma");
    // The provenance the contacts page renders — not an invite this owner
    // ever issued, which is the fact the row has to carry.
    expect(contact?.createdVia).toBe("asked");
    // The session already proved the address, so there is nothing left for a
    // second round trip through somebody's inbox to establish.
    expect(contact?.confirmedAt).not.toBeNull();

    // Asking is not being let in. `approveContact` is still the only thing in
    // the codebase that writes a grant.
    const { hasReadGrant } = await import("@/lib/grants");
    expect(await hasReadGrant(OWNER, contact!.id)).toBe(false);
  });

  test("issues no six-digit code", async () => {
    const holder = "opa@example.test";
    await signIn(holder);
    const { issueCode, verifyCode } = await import("@/lib/auth");
    // A code this reader is already holding. `issueCode` retires every live
    // code for an address before writing a new one, so a code issued by the
    // ask would consume this one — which is how the assertion notices.
    const { code } = await issueCode(OWNER, holder, "guest");

    await ask({ name: "Opa" });

    const verified = await verifyCode(OWNER, holder, code, "guest");
    expect(verified.ok, "a code was issued where none was needed").toBe(true);
  });

  test("takes the address off the session and never out of the body", async () => {
    await signIn(READER);
    await ask({ name: "Not Oma", email: "victim@example.test" });

    const { getContactByEmail } = await import("@/lib/contacts");
    expect(await getContactByEmail(OWNER, "victim@example.test")).toBeNull();
  });

  test("answers the same for a blocked address as for anybody else", async () => {
    await signIn(BLOCKED);
    const first = await ask({ name: "Spam" });
    expect(first.status).toBe(202);

    const { getContactByEmail, revokeContact } = await import("@/lib/contacts");
    const contact = await getContactByEmail(OWNER, BLOCKED);
    await revokeContact(OWNER, contact!.id);

    const again = await ask({ name: "Spam" });
    expect(again.status).toBe(first.status);
    expect(again.body).toEqual(first.body);
    // And the block stands: asking again is not a way out of it.
    expect((await getContactByEmail(OWNER, BLOCKED))?.status).toBe("blocked");
  });

  test("pressing it twice does not put a second request in front of the owner", async () => {
    const twice = "twice@example.test";
    await signIn(twice);
    await ask({ name: "Twice" });

    const { getContactByEmail } = await import("@/lib/contacts");
    const first = await getContactByEmail(OWNER, twice);
    // `notified_at` is what stops the second mail — see `needsOwnerNotice`.
    // Mail is off in this fixture, so it stays null and the retry is correct;
    // what must not happen is a *second row*.
    await ask({ name: "Twice" });
    const second = await getContactByEmail(OWNER, twice);
    expect(second?.id).toBe(first?.id);
  });

  test("refuses a request with no name at all to put beside the address", async () => {
    await signIn("nameless@example.test");
    const result = await ask({ name: "   " });
    expect(result.status).toBe(400);
    expect(result.body.error).toBe("invalid_name");

    const { getContactByEmail } = await import("@/lib/contacts");
    expect(await getContactByEmail(OWNER, "nameless@example.test")).toBeNull();
  });

  test("keeps the name this journal already has when none is sent", async () => {
    const known = "known@example.test";
    await signIn(known);
    await ask({ name: "Known Reader" });
    const result = await ask({});

    expect(result.status).toBe(202);
    const { getContactByEmail } = await import("@/lib/contacts");
    expect((await getContactByEmail(OWNER, known))?.name).toBe("Known Reader");
  });
});

describe("without a session", () => {
  test("there is nothing to ask with", async () => {
    const result = await ask();
    expect(result.status).toBe(401);
    expect(result.body.error).toBe("not_signed_in");
  });
});

describe("with contacts switched off", () => {
  test("the door is absent rather than broken", async () => {
    writeConfig(false);
    await reloadConfig();
    await signIn(READER);

    const result = await ask();
    expect(result.status).toBe(404);
    expect(result.body.error).toBe("contacts_disabled");

    writeConfig(true);
    await reloadConfig();
  });
});

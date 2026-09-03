import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

/**
 * Taking somebody's access away stops them writing — B98.
 *
 * It did not. Reads asked the database on every request, so a revocation was
 * immediate; writes asked `scopeAllows`, a string baked into the `sessions`
 * row when the token was minted and never looked at again. Somebody removed
 * from a trip — blocked, deleted, or deleted out of `people:` by hand — kept
 * writing days into it for the remaining seven days of their token, while the
 * owner had been shown a confirmation and the reader had already stopped
 * being able to read.
 *
 * So these assertions are end to end on purpose: a real token through the real
 * route, before and after. A unit test on the gate would have passed against
 * the broken version too, because the gate was not what was wrong — nobody was
 * calling anything.
 */

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
const ROBIN = "robin@example.test";
/** A second address, so the two revocation routes do not share a contact. */
const BUDDY = "sam@example.test";

let dir: string;

let calls = 0;
/** One IP per call — `lib/rateLimit.ts` is a module-level map for the file. */
function headers(extra: Record<string, string> = {}): Record<string, string> {
  calls += 1;
  return {
    "content-type": "application/json",
    "x-forwarded-for": `10.1.0.${calls % 250}`,
    ...extra,
  };
}

function writeTrip(id: string, people: string[]) {
  const root = path.join(dir, OWNER, "trips", id);
  fs.mkdirSync(path.join(root, "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "trip.md"),
    [
      "---",
      `id: "${id}"`,
      `title: "${id}"`,
      'start: "2026-08-25"',
      'end: "2026-08-26"',
      'status: "past"',
      'visibility: "private"',
      ...(people.length
        ? ["people:", ...people.flatMap((email) => [`  - name: "R"`, `    email: "${email}"`])]
        : []),
      "---",
      "",
      "Intro.",
      "",
    ].join("\n"),
  );
}

/** A token scoped to one trip, as `/api/auth/verify` mints for somebody on it. */
async function tripToken(email: string, trip: string): Promise<string> {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { tripWriteScope } = await import("@/lib/tripPeople");
  const { code } = await issueCode(OWNER, email, "agent");
  const result = await verifyCode(OWNER, email, code, "agent", tripWriteScope(trip));
  if (!result.ok) throw new Error(`no token for ${email} on ${trip}`);
  return result.token;
}

/** Somebody the owner has let in: requested, confirmed, approved. */
async function letIn(email: string, name: string): Promise<string> {
  const { requestContact, confirmContact, approveContact, getContactByEmail } = await import(
    "@/lib/contacts"
  );
  const { issueCode } = await import("@/lib/auth");
  await requestContact(OWNER, {
    name,
    email,
    locale: "en",
    wantsEmailDigest: false,
    wantsPostcard: false,
    createdVia: "owner",
  });
  const { code } = await issueCode(OWNER, email, "guest");
  await confirmContact(OWNER, email, code);
  const contact = await getContactByEmail(OWNER, email);
  if (!contact) throw new Error(`no contact for ${email}`);
  const done = await approveContact(OWNER, contact.id);
  if (!done || done.status !== "active") throw new Error(`approval failed for ${email}`);
  return contact.id;
}

async function ownerToken(): Promise<string> {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, OWNER_EMAIL, "agent");
  const result = await verifyCode(OWNER, OWNER_EMAIL, code, "agent");
  if (!result.ok) throw new Error("no owner token");
  return result.token;
}

/** Write a day through the real route, the way an agent would. */
async function writeDay(
  token: string,
  trip: string,
  slug: string,
): Promise<{ status: number; body: { error?: string; message?: string } }> {
  const { POST } = await import("@/app/api/v1/[user]/trips/[trip]/days/route");
  const response = await POST(
    new Request(`https://example.test/api/v1/${OWNER}/trips/${trip}/days`, {
      method: "POST",
      headers: headers({ authorization: `Bearer ${token}` }),
      body: JSON.stringify({ date: "2026-08-25", title: slug, content: "Something happened." }),
    }),
    { params: Promise.resolve({ user: OWNER, trip }) },
  );
  return { status: response.status, body: (await response.json()) as { error?: string } };
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-revocation-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.CONTACTS_ENCRYPTION_KEY = "66".repeat(32);
  process.env.SESSION_SECRET = "77".repeat(32);

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: { auth: { enabled: true }, contacts: { enabled: true } },
    }),
  );
  fs.mkdirSync(path.join(dir, OWNER, "trips"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Two Backpacks",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: OWNER_EMAIL },
      startLocation: "X",
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features: { auth: { enabled: true }, contacts: { enabled: true } },
    }),
  );

  // Written before anything reads them: `lib/trips.ts` memoises per content
  // root, so a trip created after the first read is invisible.
  writeTrip("named-2026", [ROBIN]);
  writeTrip("owner-only-2026", []);

  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  clearConfigCache();
  clearUserCache();

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

describe("a name removed from people: by hand", () => {
  /**
   * The case that decided the design. There is no request, no row and no code
   * path when somebody edits `trip.md` in an editor, so there is nothing for a
   * revocation to hang a `sessions` sweep off — the check has to happen at use.
   */
  test("stops the token that was issued while it was there", async () => {
    const token = await tripToken(ROBIN, "named-2026");

    const before = await writeDay(token, "named-2026", "While on the trip");
    expect(before.status).toBe(201);

    // The owner opens the file and deletes the block. No cache to clear:
    // `loadTrips` fingerprints trip.md by mtime and size, precisely so a
    // visibility change does not wait for a restart.
    writeTrip("named-2026", []);

    const after = await writeDay(token, "named-2026", "After being removed");
    expect(after.status).toBe(403);
    expect(after.body.error).toBe("access_revoked");
  });
});

describe("a contact the owner takes back", () => {
  test("stops writing the moment they are revoked, without waiting for the token to expire", async () => {
    const { revokeContact } = await import("@/lib/contacts");
    const { claimTripPlace, approveTripPlaces } = await import("@/lib/tripPeople");

    // Robin comes on the owner-only trip the way a buddy link brings somebody:
    // a request, the owner's approval, and only then a place on the trip.
    const contactId = await letIn(BUDDY, "Robin");
    await claimTripPlace(OWNER, "owner-only-2026", contactId, null);
    await approveTripPlaces(OWNER, contactId);

    const token = await tripToken(BUDDY, "owner-only-2026");
    const before = await writeDay(token, "owner-only-2026", "While approved");
    expect(before.status).toBe(201);

    await revokeContact(OWNER, contactId);

    const after = await writeDay(token, "owner-only-2026", "After revocation");
    expect(after.status).toBe(403);
    expect(after.body.error).toBe("access_revoked");

    /**
     * The refusal has to be readable by whoever gets it. `401 invalid_token`
     * says "ask for a new code at POST /api/auth/request", which is exactly
     * wrong here: they would ask, and that endpoint would refuse them for the
     * same reason this did.
     */
    expect(after.body.message).toContain("withdrawn");
    expect(after.body.message).not.toContain("/api/auth/request");
  });
});

describe("the owner's own token", () => {
  test("writes to every trip in the journal", async () => {
    const token = await ownerToken();
    const first = await writeDay(token, "named-2026", "The owner writes");
    expect(first.status).toBe(201);
    const second = await writeDay(token, "owner-only-2026", "And here too");
    expect(second.status).toBe(201);
  });

  /** The owner is never revoked, and never asked about. See
   * `test/trip-write-verdict.test.ts` for the assertion that this costs no
   * database query. */
  test("is not affected by anybody else's revocation", async () => {
    const token = await ownerToken();
    const after = await writeDay(token, "owner-only-2026", "Still the owner");
    expect(after.status).toBe(201);
  });
});

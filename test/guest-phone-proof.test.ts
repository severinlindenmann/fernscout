import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { writeTripFixture } from "./fixtures/content";

/**
 * B2294 — a guest may prove a mobile number instead of an email address.
 *
 * The number is a contact's own encrypted column with a lookup key; an SMS
 * code (dry-run file here) redeems into the same guest session and identity
 * an emailed code does, with `+<digits>` as the subject; and every gate that
 * finds "the contact behind this session" finds it by either. Proving a
 * number grants nothing the contact has not been given.
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
const GUEST_TRIP = "family-2026";
const PRIVATE_TRIP = "secret-2026";
const BUDDY_TRIP = "hike-2026";
const OTHER_TRIP = "other-2026";

let dir: string;

function writeConfigs() {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: {
        auth: { enabled: true },
        contacts: { enabled: true },
        sms: { enabled: true, backend: "dry-run" },
      },
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
      features: { auth: { enabled: true }, contacts: { enabled: true } },
    }),
  );
}

function writeTrip(id: string, visibility: "guest" | "private") {
  writeTripFixture(OWNER, {
    id,
    title: id,
    start: "2026-08-25",
    end: "2026-08-26",
    status: "past",
    visibility,
    costsVisibility: "guests",
    people: [],
  });
}

/** Every dry-run SMS written so far, oldest first. */
function texts(): { to: string; body: string }[] {
  const smsDir = path.join(dir, "sms");
  if (!fs.existsSync(smsDir)) return [];
  return fs
    .readdirSync(smsDir)
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(smsDir, f), "utf8")));
}

function lastCode(to: string): string {
  const mine = texts().filter((t) => t.to === to);
  const body = mine[mine.length - 1]?.body ?? "";
  const code = body.match(/\b(\d{6})\b/)?.[1];
  if (!code) throw new Error(`no code texted to ${to}`);
  return code;
}

async function trip(id: string) {
  const { getTrips } = await import("@/lib/trips");
  const found = getTrips(OWNER).find((t) => t.id === id);
  if (!found) throw new Error(`no trip ${id}`);
  return found;
}

/** Added by the owner and let in, the pre-approved way `grantContactAccess` does it. */
async function addApproved(input: { name: string; email?: string; phone?: string }, buddyOf?: string) {
  const { addContact, approveContact, confirmContactByOwner } = await import("@/lib/contacts");
  const added = await addContact(OWNER, { ...input, locale: "en", createdVia: "owner" });
  if (!added.ok) throw new Error(`addContact failed: ${added.error}`);
  if (buddyOf) {
    const { claimTripPlace } = await import("@/lib/tripPeople");
    await claimTripPlace(OWNER, buddyOf, added.contact.id, null);
  }
  await confirmContactByOwner(OWNER, added.contact.id);
  const approved = await approveContact(OWNER, added.contact.id);
  if (!approved) throw new Error("approve failed");
  return approved.contact;
}

/** SMS code to the contact, redeemed, and the session put behind the jar. */
async function signInBySms(contactId: string, digits: string) {
  const { sendGuestCode, verifyGuestCode } = await import("@/lib/contacts/guestCode");
  const sent = await sendGuestCode(OWNER, contactId, "sms", { ip: "198.51.100.7" });
  expect(sent).toEqual({ ok: true, channel: "sms", to: expect.stringMatching(/•+\d{4}$/) });
  const session = await verifyGuestCode(OWNER, `+${digits}`, lastCode(digits));
  if (!session) throw new Error("sms code did not redeem");
  jar.cookies = { fs_session: session.token };
  return session;
}

async function signInByEmail(email: string) {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, email, "guest");
  const session = await verifyCode(OWNER, email, code, "guest");
  if (!session.ok) throw new Error("email code did not redeem");
  jar.cookies = { fs_session: session.token };
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-b2294-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.CONTACTS_ENCRYPTION_KEY = "66".repeat(32);
  process.env.SESSION_SECRET = "77".repeat(32);
  writeConfigs();
  writeTrip(GUEST_TRIP, "guest");
  writeTrip(PRIVATE_TRIP, "private");
  writeTrip(BUDDY_TRIP, "private");
  writeTrip(OTHER_TRIP, "private");
  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  clearConfigCache();
  clearUserCache();
});

beforeEach(async () => {
  const { resetRateLimitsForTests } = await import("@/lib/rateLimit");
  resetRateLimitsForTests();
  jar.cookies = {};
});

afterAll(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  for (const key of ["CONTENT_DIR", "DATA_DIR", "DATABASE_URL", "CONTACTS_ENCRYPTION_KEY", "SESSION_SECRET"]) {
    delete process.env[key];
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("a reader with a mobile number and no email", () => {
  test("proves it by SMS and reads the journal's guest trips — and nothing private", async () => {
    const contact = await addApproved({ name: "Lena", phone: "+41 76 111 22 33" });
    expect(contact.email).toBe("");
    expect(contact.phone).toBe("+41 76 111 22 33");
    expect(contact.phoneProvenAt).toBeNull();

    const { mayReadTrip } = await import("@/lib/tripGate");
    const { isJournalGuest, journalReader } = await import("@/lib/contacts/session");
    expect(await mayReadTrip(await trip(GUEST_TRIP))).toBe(false);

    const session = await signInBySms(contact.id, "41761112233");
    expect(session.subject).toBe("+41761112233");
    expect(session.contact?.id).toBe(contact.id);
    expect(session.contact?.phoneProvenAt).not.toBeNull();

    expect(await isJournalGuest(OWNER)).toBe(true);
    expect((await journalReader(OWNER)).contact?.id).toBe(contact.id);
    expect(await mayReadTrip(await trip(GUEST_TRIP))).toBe(true);
    expect(await mayReadTrip(await trip(PRIVATE_TRIP))).toBe(false);
  });

  test("the public doors: /api/auth/codes by phone, redeemed into fs_session and an identity naming the phone", async () => {
    const contact = await addApproved({ name: "Mia", phone: "0044 7700 900123" });
    const { POST: request } = await import("@/app/api/auth/codes/route");
    const { POST: redeem } = await import("@/app/api/auth/codes/redeem/route");
    const post = (body: unknown) =>
      new Request("https://example.test/api/auth/codes", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" },
        body: JSON.stringify(body),
      });

    const asked = await request(post({ user: OWNER, phone: "+44 7700 900123", for: "read" }));
    expect(asked.status).toBe(202);
    const { flushAfterResponse } = await import("@/lib/afterResponse");
    await flushAfterResponse();
    const code = lastCode("447700900123");

    // Not for anything but reading, and never beside an email.
    expect((await request(post({ user: OWNER, phone: "+447700900123", for: "write" }))).status).toBe(400);
    expect((await redeem(post({ user: OWNER, phone: "+447700900123", code, for: "identity" }))).status).toBe(400);

    jar.cookies = {};
    const redeemed = await redeem(post({ user: OWNER, phone: "+44 7700 900123", code, for: "read" }));
    expect(redeemed.status).toBe(200);
    const { resolveSession } = await import("@/lib/auth");
    const guest = await resolveSession(jar.cookies.fs_session, "guest");
    const identity = await resolveSession(jar.cookies.fs_identity, "identity");
    expect(guest?.email).toBe("+447700900123");
    expect(identity?.email).toBe("+447700900123");

    const { getContact } = await import("@/lib/contacts");
    expect((await getContact(OWNER, contact.id))?.phoneProvenAt).not.toBeNull();
    const { mayReadTrip } = await import("@/lib/tripGate");
    jar.cookies = { fs_identity: jar.cookies.fs_identity };
    expect(await mayReadTrip(await trip(GUEST_TRIP))).toBe(true);
  });

  test("a number no contact holds is texted nothing, and answered the same 202", async () => {
    const { POST: request } = await import("@/app/api/auth/codes/route");
    const before = texts().length;
    const res = await request(
      new Request("https://example.test/api/auth/codes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user: OWNER, phone: "+41 79 000 00 01", for: "read" }),
      }),
    );
    expect(res.status).toBe(202);
    expect(texts().length).toBe(before);
  });
});

describe("a buddy with a mobile number", () => {
  test("proves it by SMS and may write to their trip, and only that trip", async () => {
    const contact = await addApproved({ name: "Marco", phone: "+39 333 123 4567" }, BUDDY_TRIP);
    await signInBySms(contact.id, "393331234567");

    const { isTravellerOn } = await import("@/lib/tripGate");
    const { tripWriteScope, tripWriteVerdict } = await import("@/lib/tripPeople");
    expect(await isTravellerOn(await trip(BUDDY_TRIP))).toBe(true);
    expect(await isTravellerOn(await trip(OTHER_TRIP))).toBe(false);
    const scoped = (id: string) => tripWriteScope(id);
    expect(await tripWriteVerdict(scoped(BUDDY_TRIP), "+393331234567", await trip(BUDDY_TRIP))).toBe("allowed");
    expect(await tripWriteVerdict(scoped(OTHER_TRIP), "+393331234567", await trip(OTHER_TRIP))).toBe("revoked");
  });
});

describe("one person, two channels", () => {
  test("a proven email and a proven phone resolve to the one contact, and neither opens more than it has", async () => {
    const { addContact, approveContact, confirmContactByOwner } = await import("@/lib/contacts");
    const added = await addContact(OWNER, {
      name: "Oma",
      email: "oma@example.test",
      phone: "+41 78 555 66 77",
      locale: "en",
      createdVia: "owner",
    });
    if (!added.ok) throw new Error(added.error);
    const { journalReader } = await import("@/lib/contacts/session");
    const { mayReadTrip } = await import("@/lib/tripGate");

    // Not let in yet: both channels prove the person, and neither is access.
    await signInBySms(added.contact.id, "41785556677");
    expect(await journalReader(OWNER)).toMatchObject({ guest: false, contact: { id: added.contact.id } });
    expect(await mayReadTrip(await trip(GUEST_TRIP))).toBe(false);
    await signInByEmail("oma@example.test");
    expect(await journalReader(OWNER)).toMatchObject({ guest: false, contact: { id: added.contact.id } });

    await confirmContactByOwner(OWNER, added.contact.id);
    await approveContact(OWNER, added.contact.id);
    for (const signIn of [
      () => signInBySms(added.contact.id, "41785556677"),
      () => signInByEmail("oma@example.test"),
    ]) {
      await signIn();
      expect(await journalReader(OWNER)).toMatchObject({ guest: true, contact: { id: added.contact.id } });
      expect(await mayReadTrip(await trip(GUEST_TRIP))).toBe(true);
      expect(await mayReadTrip(await trip(PRIVATE_TRIP))).toBe(false);
    }
  });

  test("an address and a number that belong to two different people are refused, not merged", async () => {
    const { addContact } = await import("@/lib/contacts");
    await addContact(OWNER, { name: "A", email: "a@example.test", locale: "en", createdVia: "owner" });
    await addContact(OWNER, { name: "B", phone: "+41 78 000 11 22", locale: "en", createdVia: "owner" });
    const clash = await addContact(OWNER, {
      name: "A",
      email: "a@example.test",
      phone: "+41 78 000 11 22",
      locale: "en",
      createdVia: "owner",
    });
    expect(clash).toEqual({ ok: false, error: "conflict" });
    expect(await addContact(OWNER, { name: "C", locale: "en", createdVia: "owner" })).toEqual({
      ok: false,
      error: "no_channel",
    });
  });
});

describe("rate limits", () => {
  test("the fourth code to one number within the hour is refused, and texts nothing", async () => {
    const contact = await addApproved({ name: "Zoe", phone: "+41 76 999 88 77" });
    const { sendGuestCode } = await import("@/lib/contacts/guestCode");
    const sent = [];
    for (let i = 0; i < 4; i++) {
      // A different IP each time, so it is the number's own bucket that says no.
      sent.push(await sendGuestCode(OWNER, contact.id, "sms", { ip: `198.51.100.${i}` }));
    }
    expect(sent.slice(0, 3).every((r) => r.ok)).toBe(true);
    expect(sent[3]).toEqual({ ok: false, reason: "rate_limited" });
    expect(texts().filter((t) => t.to === "41769998877")).toHaveLength(3);
  });
});

describe("038-contact-phone", () => {
  test("moves an existing tel out of the postal blob into an unproven phone that still shows on the card", async () => {
    const { createDatabase, migrateToLatest } = await import("@/lib/db");
    const { Migrator } = await import("kysely/migration");
    const { migrationProvider } = await import("@/lib/db/migrations");
    const { addressAad, decryptAddress, decryptString, encryptAddress, EMPTY_ADDRESS, phoneAad } = await import(
      "@/lib/contacts/crypto"
    );
    const handle = await createDatabase({ dialect: "sqlite", file: path.join(dir, "migrate.sqlite"), label: "t" });
    try {
      await new Migrator({ db: handle.db, provider: migrationProvider }).migrateTo("037-photobook-drafts");
      const row = (id: string, address: typeof EMPTY_ADDRESS) => ({
        id,
        owner_id: OWNER,
        email: `${id}@example.test`,
        email_key: `${id}@example.test`,
        name: id,
        locale: "en",
        status: "active",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        postal_cipher: encryptAddress(address, addressAad(OWNER, id)),
        manage_token_hash: null,
      });
      const withStreet = { ...EMPTY_ADDRESS, line1: "Gasse 1", city: "Bern", country: "CH", tel: "+41 76 222 33 44" };
      const telOnly = { ...EMPTY_ADDRESS, tel: "+41 76 222 33 55" };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = handle.db as any;
      await db.insertInto("contacts").values([row("street", withStreet), row("telonly", telOnly)]).execute();

      await migrateToLatest(handle);

      const rows = await db.selectFrom("contacts").selectAll().orderBy("id").execute();
      const street = rows.find((r: { id: string }) => r.id === "street");
      const only = rows.find((r: { id: string }) => r.id === "telonly");
      expect(street.phone_proven_at).toBeNull();
      expect(street.phone_key).toBeNull();
      expect(decryptAddress(street.postal_cipher, addressAad(OWNER, "street"))).toMatchObject({ line1: "Gasse 1", tel: "" });
      expect(decryptString(street.phone_cipher, phoneAad(OWNER, "street"), "phone")).toBe("+41 76 222 33 44");
      expect(only.postal_cipher).toBeNull();
      expect(decryptString(only.phone_cipher, phoneAad(OWNER, "telonly"), "phone")).toBe("+41 76 222 33 55");
    } finally {
      await handle.destroy();
    }

    // And read through the contact record, the card's own source, on the
    // application's database: a row written the old way, then migrated.
    const { getDatabase } = await import("@/lib/db");
    const { getContact } = await import("@/lib/contacts");
    const { db } = await getDatabase();
    const id = "legacy-tel";
    await db
      .insertInto("contacts")
      .values({
        id,
        owner_id: OWNER,
        email: "legacy@example.test",
        email_key: "legacy@example.test",
        name: "Legacy",
        locale: "en",
        notes: null,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        postal_cipher: encryptAddress({ ...EMPTY_ADDRESS, tel: "+41 76 222 33 66" }, addressAad(OWNER, id)),
        created_via: "owner",
        confirmed_at: null,
        approved_at: null,
        last_seen_at: null,
        manage_token_hash: null,
        notified_at: null,
        phone_cipher: null,
        phone_key: null,
        phone_proven_at: null,
      })
      .execute();
    // Not moved (it arrived after the migration): still read, as the fallback.
    const legacy = await getContact(OWNER, id);
    expect(legacy?.phone).toBe("+41 76 222 33 66");
    expect(legacy?.postalAddress?.tel).toBe("+41 76 222 33 66");
    expect(legacy?.hasPostalAddress).toBe(true);
  });
});

/**
 * B2294's security review. A number becomes a sign-in credential only when
 * the owner typed it or an SMS code proved it — never because somebody typed
 * it into a self-service form.
 */
describe("a typed number is not a credential", () => {
  async function textsTo(digits: string) {
    return texts().filter((t) => t.to === digits).length;
  }
  async function askByPhone(phone: string) {
    const { POST: request } = await import("@/app/api/auth/codes/route");
    const res = await request(
      new Request("https://example.test/api/auth/codes", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.50" },
        body: JSON.stringify({ user: OWNER, phone, for: "read" }),
      }),
    );
    expect(res.status).toBe(202);
    const { flushAfterResponse } = await import("@/lib/afterResponse");
    await flushAfterResponse();
  }

  test("HIGH-1: the public form, given a reader's address, cannot plant a number that signs in as them", async () => {
    const reader = await addApproved({ name: "Vera", email: "vera@example.test" });
    const { requestContact, getContactByEmail } = await import("@/lib/contacts");
    await requestContact(OWNER, {
      name: "Vera",
      email: "vera@example.test",
      locale: "en",
      address: { tel: "+41 79 666 00 01" },
      wantsEmailDigest: false,
      wantsPostcard: false,
      createdVia: "open",
    });
    expect(await getContactByEmail(OWNER, "+41796660001")).toBeNull();
    const before = await textsTo("41796660001");
    await askByPhone("+41 79 666 00 01");
    expect(await textsTo("41796660001")).toBe(before);
    // Still shown on the card, as a number nobody has proved.
    const { getContact } = await import("@/lib/contacts");
    expect((await getContact(OWNER, reader.id))?.phone).toBe("+41 79 666 00 01");
  });

  test("MEDIUM-2: the manage link cannot set a number that signs in, and re-saving keeps an owner-typed one", async () => {
    const reader = await addApproved({ name: "Wim", email: "wim@example.test", phone: "+41 79 666 00 02" });
    const { getContactByEmail, manageTokenFor, updateContactSelf } = await import("@/lib/contacts");
    const token = manageTokenFor(OWNER, reader.id);
    // Saving the page as it stands keeps the owner's number as a credential.
    await updateContactSelf(OWNER, token, { address: { tel: "+41 79 666 00 02" } });
    expect((await getContactByEmail(OWNER, "+41796660002"))?.id).toBe(reader.id);
    // A different number typed there is stored, and is not a way in.
    await updateContactSelf(OWNER, token, { address: { tel: "+41 79 666 00 03" } });
    expect(await getContactByEmail(OWNER, "+41796660003")).toBeNull();
    expect(await getContactByEmail(OWNER, "+41796660002")).toBeNull();
  });

  test("MEDIUM-3: proving a number never confirms an email address, and a phone subject never becomes a row", async () => {
    const { addContact, confirmContactFromSession, getContact, listContacts, requestContact } = await import(
      "@/lib/contacts"
    );
    const added = await addContact(OWNER, {
      name: "Xena",
      email: "xena@example.test",
      phone: "+41 79 666 00 04",
      locale: "en",
      createdVia: "owner",
    });
    if (!added.ok) throw new Error(added.error);
    await signInBySms(added.contact.id, "41796660004");
    expect((await confirmContactFromSession(OWNER, "+41796660004")).ok).toBe(false);
    const after = await getContact(OWNER, added.contact.id);
    expect(after?.confirmedAt).toBeNull();
    expect(after?.phoneProvenAt).not.toBeNull();
    const { readerState } = await import("@/lib/readers/split");
    expect(readerState(after!)).toBe("waitingOnYou");

    const result = await requestContact(OWNER, {
      name: "Junk",
      email: "+41796660004",
      locale: "en",
      wantsEmailDigest: false,
      wantsPostcard: false,
      createdVia: "asked",
    });
    expect(result.contactId).toBeNull();
    expect((await listContacts(OWNER)).some((c) => c.email === "+41796660004")).toBe(false);
  });

  test("toll fraud: a self-made contact's number is never texted, however it got one", async () => {
    const { requestContact } = await import("@/lib/contacts");
    const made = await requestContact(OWNER, {
      name: "Premium",
      email: "premium@example.test",
      locale: "en",
      address: { tel: "+44 909 876 5432" },
      wantsEmailDigest: false,
      wantsPostcard: false,
      createdVia: "invite:x",
    });
    const { sendGuestCode } = await import("@/lib/contacts/guestCode");
    expect(await sendGuestCode(OWNER, made.contactId!, "sms", { ip: "198.51.100.60" })).toEqual({
      ok: false,
      reason: "no_channel",
    });
    expect(await textsTo("449098765432")).toBe(0);
  });

  test("LOW-7: an owner-typed number wins the key over an unproven holder", async () => {
    const { addContact, getContactByEmail, updateContactByOwner } = await import("@/lib/contacts");
    const planted = await addApproved({ name: "Planter", email: "planter@example.test", phone: "+41 79 666 00 05" });
    // An owner-typed, never-proved number …
    const real = await addContact(OWNER, { name: "Real", email: "real@example.test", locale: "en", createdVia: "owner" });
    if (!real.ok) throw new Error(real.error);
    await updateContactByOwner(OWNER, real.contact.id, { address: { tel: "+41 79 666 00 05" } });
    expect((await getContactByEmail(OWNER, "+41796660005"))?.id).toBe(real.contact.id);
    expect(planted.id).not.toBe(real.contact.id);
  });
});

describe("proving a number in-session and as a first channel", () => {
  test("a signed-in reader adds a number by proving it; it then signs in as them", async () => {
    const reader = await addApproved({ name: "Yara", email: "yara@example.test" });
    const { sendPhoneProof, confirmPhoneProof } = await import("@/lib/contacts/guestCode");
    const sent = await sendPhoneProof(OWNER, reader.id, "+41 79 666 00 06", { ip: "198.51.100.70" });
    expect(sent.ok).toBe(true);
    expect(await confirmPhoneProof(OWNER, reader.id, "+41 79 666 00 06", "000000")).toBe(false);
    expect(await confirmPhoneProof(OWNER, reader.id, "+41 79 666 00 06", lastCode("41796660006"))).toBe(true);
    const { getContactByEmail } = await import("@/lib/contacts");
    const found = await getContactByEmail(OWNER, "+41796660006");
    expect(found?.id).toBe(reader.id);
    expect(found?.phoneProvenAt).not.toBeNull();
    expect(found?.confirmedAt).not.toBeNull(); // the email proof it already had, untouched
  });

  test("a visitor's first channel: a code to a new number creates a pending contact on proof, and grants nothing", async () => {
    const { sendFirstPhoneCode, proveFirstPhone } = await import("@/lib/contacts/guestCode");
    expect((await sendFirstPhoneCode(OWNER, "+41 79 666 00 07", { ip: "198.51.100.80" })).ok).toBe(true);
    const proved = await proveFirstPhone(OWNER, "+41 79 666 00 07", lastCode("41796660007"), {
      name: "Joiner",
      locale: "en",
      createdVia: "invite:j",
    });
    expect(proved?.contact).toMatchObject({ status: "pending", phone: "+41 79 666 00 07", email: "" });
    expect(proved?.contact.phoneProvenAt).not.toBeNull();
    jar.cookies = { fs_session: proved!.token };
    const { isJournalGuest } = await import("@/lib/contacts/session");
    expect(await isJournalGuest(OWNER)).toBe(false);
    // Waiting on the owner, and not somebody the sign-in door texts until let in.
    const { sendGuestCode } = await import("@/lib/contacts/guestCode");
    expect(await sendGuestCode(OWNER, proved!.contact.id, "sms", { ip: "198.51.100.81" })).toEqual({
      ok: false,
      reason: "no_channel",
    });
    const { readerState } = await import("@/lib/readers/split");
    expect(readerState(proved!.contact)).toBe("waitingOnYou");
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

/** Every cookie the mocked `next/headers` hands back — empty throughout, which
 * is the point: the redemptions below are made by somebody with no session,
 * the way a link followed from a mail is. */
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

/**
 * A place on a trip that lapsed, and the click that is supposed to bring it
 * back — B161. And a place the owner revoked, and the same click — B213.
 *
 * `approveTripPlaces` picked its rows by asking whether they had ever been
 * opened (`granted_at is null`). A row whose `expires_at` had passed fails
 * that test — it *was* granted — while every reader in `lib/tripPeople.ts`
 * asks `grantIsLive` and treats it as no place at all. So the owner clicked
 * approve, `approveContact` reported success, and the person was still not on
 * the trip: the worst shape a bug can take, because the interface said it had
 * worked. The same divergence B82 found in `lib/push.ts` and B130 found in
 * `access_grants`, one table over.
 *
 * Not in `test/trip-people.test.ts`, where B161's acceptance first put it:
 * that file states in its own words that it sets **no `DATABASE_URL`,
 * deliberately**, because what it pins is that a hand-written `people:` block
 * stands entirely on its own with no database at all. Giving it one would
 * dissolve the property it exists to assert, so the database half lives here.
 */

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
/** Redeemed a buddy link, was let on, and then the place ran out. */
const LAPSED = "lapsed@example.test";
/** On the trip and still live — the row that must not be disturbed. */
const LIVE = "live@example.test";

let dir: string;

/** One IP per call: `lib/rateLimit.ts` is a module-level map shared by the
 * whole file, and `/api/contacts/redeem` allows five per address. */
let calls = 0;
function headers(): Record<string, string> {
  calls += 1;
  return { "content-type": "application/json", "x-forwarded-for": `10.0.0.${calls % 250}` };
}

/** The public door somebody with a link knocks on. */
async function redeem(
  body: Record<string, unknown>,
): Promise<{ status: number; body: { status?: string; error?: string } }> {
  const { POST } = await import("@/app/api/contacts/redeem/route");
  const response = await POST(
    new Request("https://example.test/api/contacts/redeem", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ user: OWNER, ...body }),
    }),
  );
  return { status: response.status, body: (await response.json()) as { status?: string } };
}

function writeTrip(id: string) {
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
      "---",
      "",
      "Intro.",
      "",
    ].join("\n"),
  );
}

/** Requested, confirmed, approved — the owner has let them into the journal. */
async function letIn(email: string): Promise<string> {
  const { requestContact, confirmContact, approveContact, getContactByEmail } = await import(
    "@/lib/contacts"
  );
  const { issueCode } = await import("@/lib/auth");
  await requestContact(OWNER, {
    name: "Reader",
    email,
    locale: "en",
    address: null,
    wantsEmailDigest: false,
    wantsPostcard: false,
    createdVia: "owner",
  });
  const { code } = await issueCode(OWNER, email, "guest");
  const confirmed = await confirmContact(OWNER, email, code);
  if (!confirmed.ok) throw new Error(`confirm failed for ${email}`);
  const contact = await getContactByEmail(OWNER, email);
  if (!contact) throw new Error(`no contact for ${email}`);
  const done = await approveContact(OWNER, contact.id);
  if (!done || done.status !== "active") throw new Error(`approval failed for ${email}`);
  return contact.id;
}

/** The one row for this contact on this trip, as the database holds it. */
async function placeRows(contactId: string, tripId: string) {
  const { getDatabase } = await import("@/lib/db");
  const { db } = await getDatabase();
  return db
    .selectFrom("trip_people")
    .select(["id", "granted_at", "granted_by", "revoked_at", "expires_at"])
    .where("owner_id", "=", OWNER)
    .where("contact_id", "=", contactId)
    .where("trip_id", "=", tripId)
    .execute();
}

async function expirePlace(contactId: string, when: string) {
  const { getDatabase } = await import("@/lib/db");
  const { db } = await getDatabase();
  await db
    .updateTable("trip_people")
    .set({ expires_at: when })
    .where("owner_id", "=", OWNER)
    .where("contact_id", "=", contactId)
    .execute();
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-place-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.CONTACTS_ENCRYPTION_KEY = "88".repeat(32);
  process.env.SESSION_SECRET = "99".repeat(32);

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: {
        auth: { enabled: true },
        contacts: { enabled: true },
        // `/api/contacts/redeem` refuses up front when it cannot send the
        // six-digit code a redemption needs (B205), and the B213 case below
        // redeems for real. The file transport needs no credentials and writes
        // into this test's own temp directory.
        mail: { enabled: true, transport: "file" },
      },
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
      features: {
        auth: { enabled: true },
        contacts: { enabled: true },
        mail: { enabled: true, transport: "file" },
      },
    }),
  );

  // Written before anything reads them: `lib/trips.ts` memoises per content
  // root, so a trip created after the first read is invisible.
  writeTrip("bus-2026");

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

describe("a place on a trip that has expired", () => {
  test("comes back live when the owner approves the contact again", async () => {
    const { claimTripPlace, approveTripPlaces, isPersonOn, peopleOf } = await import(
      "@/lib/tripPeople"
    );
    const { getTrip, tripRef } = await import("@/lib/trips");
    const { approveContact } = await import("@/lib/contacts");
    const trip = getTrip(tripRef(OWNER, "bus-2026"))!;

    const contactId = await letIn(LAPSED);
    await claimTripPlace(OWNER, "bus-2026", contactId, null);
    await approveTripPlaces(OWNER, contactId);
    expect(await isPersonOn(trip, LAPSED)).toBe(true);

    // The place runs out. Nothing writes this today — `claimTripPlace`
    // hard-codes null and no caller issues a time-limited place — so it is
    // reached the way the B130 case reaches its grant: into the row.
    await expirePlace(contactId, new Date(Date.now() - 86_400_000).toISOString());

    // Precondition: they really are off the trip before the click, so what
    // follows is the approval working rather than the expiry never landing.
    expect(await isPersonOn(trip, LAPSED)).toBe(false);
    expect(await peopleOf(trip)).not.toContain(LAPSED);

    // The owner clicks approve. `approveContact` is the only thing in the
    // codebase that creates a place, so this is the whole of the fix's route.
    await approveContact(OWNER, contactId);

    expect(await isPersonOn(trip, LAPSED)).toBe(true);
    expect(await peopleOf(trip)).toContain(LAPSED);

    // And the write path agrees, which is the point of asking `grantIsLive`
    // rather than re-deriving the comparison: a place that is back is a place
    // that can be written from.
    const { tripWriteVerdict, tripWriteScope } = await import("@/lib/tripPeople");
    expect(await tripWriteVerdict(tripWriteScope("bus-2026"), LAPSED, trip)).toBe("allowed");

    // One row, not two: reviving a place must not leave a second one behind
    // for the readers to disagree over, and the expiry is gone rather than
    // merely stepped over.
    const rows = await placeRows(contactId, "bus-2026");
    expect(rows).toHaveLength(1);
    expect(rows[0].expires_at).toBe(null);
    expect(rows[0].revoked_at).toBe(null);
    expect(rows[0].granted_by).toBe(OWNER);
  });

  test("and the trips it opened are reported back, so the owner can be told", async () => {
    const { claimTripPlace, approveTripPlaces } = await import("@/lib/tripPeople");
    const contactId = await letIn("second@example.test");
    await claimTripPlace(OWNER, "bus-2026", contactId, null);
    expect(await approveTripPlaces(OWNER, contactId)).toEqual(["bus-2026"]);

    // Already live: nothing to open, and nothing claimed to have been.
    expect(await approveTripPlaces(OWNER, contactId)).toEqual([]);

    await expirePlace(contactId, new Date(Date.now() - 1000).toISOString());
    expect(await approveTripPlaces(OWNER, contactId)).toEqual(["bus-2026"]);
  });
});

describe("a place that never lapsed", () => {
  test("is not restamped by approving again", async () => {
    const { claimTripPlace, approveTripPlaces } = await import("@/lib/tripPeople");
    const { approveContact } = await import("@/lib/contacts");

    const contactId = await letIn(LIVE);
    await claimTripPlace(OWNER, "bus-2026", contactId, null);
    await approveTripPlaces(OWNER, contactId);

    const before = await placeRows(contactId, "bus-2026");
    expect(before).toHaveLength(1);
    expect(before[0].granted_at).not.toBe(null);

    await approveContact(OWNER, contactId);

    const after = await placeRows(contactId, "bus-2026");
    // One row still, and the date it carries is the date it always carried:
    // rewriting a stamp that is still true would lose when they actually came
    // on the trip.
    expect(after).toHaveLength(1);
    expect(after[0].granted_at).toBe(before[0].granted_at);
    expect(after[0].id).toBe(before[0].id);
  });
});

/**
 * B213 — the decision B161 wrote down as open, and the defect that forced it.
 *
 * B161 left a revoked place alone and said so in its own words: revocation
 * marks rather than deletes, and "whether revocation should be reversible at
 * all is a decision about what revocation means". The answer is that it is
 * reversible **by the owner**, because the alternative was observed on the
 * live instance and is worse than the risk it was avoiding. Revoke, then
 * approve again: the contact went back to `active`, the response said `ok`,
 * and the person still met `403 access_revoked` on the trip — with no route
 * back at all, since a fresh buddy link stops at `claimTripPlace`'s existing
 * row. One table over, revocation was already fully reversible: the
 * `access_grants` row is deleted and written again by the same two clicks.
 *
 * What B161 was protecting is protected here instead, where it belongs — in
 * the doors the revoked person can actually reach. That half is asserted
 * below, end to end through `/api/contacts/redeem`, so that "the owner can
 * undo this and the blocked person cannot" is one property with two tests
 * rather than a sentence in a comment.
 */
describe("a place the owner revoked", () => {
  test("comes back when the owner approves the contact again", async () => {
    const { claimTripPlace, approveTripPlaces, isPersonOn, peopleOf } = await import(
      "@/lib/tripPeople"
    );
    const { approveContact, revokeContact } = await import("@/lib/contacts");
    const { getTrip, tripRef } = await import("@/lib/trips");
    const { tripWriteVerdict, tripWriteScope } = await import("@/lib/tripPeople");
    const trip = getTrip(tripRef(OWNER, "bus-2026"))!;
    const email = "blocked@example.test";

    const contactId = await letIn(email);
    await claimTripPlace(OWNER, "bus-2026", contactId, null);
    await approveTripPlaces(OWNER, contactId);
    expect(await isPersonOn(trip, email)).toBe(true);

    // The owner changes their mind, twice.
    await revokeContact(OWNER, contactId);
    expect(await isPersonOn(trip, email)).toBe(false);
    // Precondition, and the exact 403 the live instance answered: the write
    // door is shut, so what follows is the approval working rather than the
    // revocation never having landed.
    expect(await tripWriteVerdict(tripWriteScope("bus-2026"), email, trip)).toBe("revoked");

    await approveContact(OWNER, contactId);

    expect(await isPersonOn(trip, email)).toBe(true);
    expect(await peopleOf(trip)).toContain(email);
    // The half the approve response was claiming and not delivering: their
    // trip-scoped token writes again, without a new invite.
    expect(await tripWriteVerdict(tripWriteScope("bus-2026"), email, trip)).toBe("allowed");

    // One row, not two, and the mark is gone rather than merely stepped over —
    // otherwise the next revocation's `revoked_at is null` guard would find a
    // row it thinks is already revoked and leave the stamp where it was.
    const rows = await placeRows(contactId, "bus-2026");
    expect(rows).toHaveLength(1);
    expect(rows[0].revoked_at).toBe(null);
    expect(rows[0].expires_at).toBe(null);
    expect(rows[0].granted_by).toBe(OWNER);

    // And it survives a second round trip, which is what makes it an undo
    // rather than a one-off.
    await revokeContact(OWNER, contactId);
    expect(await isPersonOn(trip, email)).toBe(false);
    await approveContact(OWNER, contactId);
    expect(await isPersonOn(trip, email)).toBe(true);
  });

  /**
   * The other half of the decision, and the reason B161 hesitated: the owner
   * pressing approve is one act, and the revoked holder re-redeeming their
   * link is a different one. Only the first may put them back.
   */
  test("is not something the revoked person can redeem their own way back into", async () => {
    const { isPersonOn } = await import("@/lib/tripPeople");
    const { createInvite } = await import("@/lib/contacts/invites");
    const { getContactByEmail, revokeContact, approveContact, confirmContact } = await import(
      "@/lib/contacts"
    );
    const { issueCode } = await import("@/lib/auth");
    const { getTrip, tripRef } = await import("@/lib/trips");
    const trip = getTrip(tripRef(OWNER, "bus-2026"))!;
    const email = "buddy@example.test";

    // The whole of B33's route in: a buddy link, redeemed, confirmed, approved.
    const invite = await createInvite(OWNER, { kind: "buddy", tripId: "bus-2026", name: "Bee" });
    expect((await redeem({ token: invite.token, kind: "buddy", email, name: "Bee" })).body).toEqual({
      status: "code",
    });
    const { code } = await issueCode(OWNER, email, "guest");
    expect((await confirmContact(OWNER, email, code)).ok).toBe(true);
    const contactId = (await getContactByEmail(OWNER, email))!.id;
    await approveContact(OWNER, contactId);
    expect(await isPersonOn(trip, email)).toBe(true);

    await revokeContact(OWNER, contactId);
    expect(await isPersonOn(trip, email)).toBe(false);

    // They follow the same live link again. It answers exactly as it answers
    // anybody — the link is not an oracle for having been shown the door — and
    // writes nothing: `requestContact` refuses a blocked contact before
    // `claimTripPlace` is reached.
    const again = await redeem({ token: invite.token, kind: "buddy", email, name: "Bee" });
    expect(again.status).toBe(202);
    expect(again.body).toEqual({ status: "code" });

    expect((await getContactByEmail(OWNER, email))!.status).toBe("blocked");
    expect(await isPersonOn(trip, email)).toBe(false);
    const stillRevoked = await placeRows(contactId, "bus-2026");
    expect(stillRevoked).toHaveLength(1);
    expect(stillRevoked[0].revoked_at).not.toBe(null);

    // And a *second* link is no better once the owner has let them back in:
    // `claimTripPlace` returns on the row that is already there, so a
    // redemption can never write the clean slate a revival would then open.
    await approveContact(OWNER, contactId);
    const fresh = await createInvite(OWNER, { kind: "buddy", tripId: "bus-2026", name: "Bee" });
    await redeem({ token: fresh.token, kind: "buddy", email, name: "Bee" });
    const rows = await placeRows(contactId, "bus-2026");
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(stillRevoked[0].id);
  });
});

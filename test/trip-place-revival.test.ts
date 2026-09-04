import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

/**
 * A place on a trip that lapsed, and the click that is supposed to bring it
 * back — B161.
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

describe("a place the owner revoked", () => {
  /**
   * Deliberately unchanged by B161. `revokeTripPlaces` marks rather than
   * deletes so that somebody shown the door cannot redeem the same link back
   * into a clean slate, and re-approving must not undo that through a side
   * door. Asserted so that a later widening of the filter has to argue with a
   * failing test rather than slide past.
   */
  test("stays revoked when the contact is approved again", async () => {
    const { claimTripPlace, approveTripPlaces, isPersonOn } = await import("@/lib/tripPeople");
    const { approveContact, revokeContact } = await import("@/lib/contacts");
    const { getTrip, tripRef } = await import("@/lib/trips");
    const trip = getTrip(tripRef(OWNER, "bus-2026"))!;
    const email = "blocked@example.test";

    const contactId = await letIn(email);
    await claimTripPlace(OWNER, "bus-2026", contactId, null);
    await approveTripPlaces(OWNER, contactId);
    expect(await isPersonOn(trip, email)).toBe(true);

    await revokeContact(OWNER, contactId);
    expect(await isPersonOn(trip, email)).toBe(false);

    await approveContact(OWNER, contactId);
    expect(await isPersonOn(trip, email)).toBe(false);
    const rows = await placeRows(contactId, "bus-2026");
    expect(rows[0].revoked_at).not.toBe(null);
  });
});

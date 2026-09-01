import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { issueCode } from "@/lib/auth";
import { clearConfigCache } from "@/lib/config";
import { approveContact, confirmContact, requestContact, revokeContact } from "@/lib/contacts";
import { closeDatabase, getDatabase } from "@/lib/db";
import {
  findActiveContactId,
  isGoneSubscription,
  saveSubscription,
  subscribersFor,
} from "@/lib/push";
import type { StoredSubscription } from "@/lib/repos/types";
import type { Trip } from "@/lib/types";
import { clearUserCache } from "@/lib/users";

/**
 * Per-recipient push fan-out (W12).
 *
 * The one behaviour worth being paranoid about: a subscription that cannot
 * prove it may read a closed trip must never be notified about
 * it. Everything else here is in service of that.
 */

const KEY = "22".repeat(32);

function fakeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: "asia-2023",
    username: "ana",
    ref: "ana/asia-2023",
    rates: {},
    title: "Asia 2026",
    start: "2026-01-01",
    end: "2026-01-31",
    status: "current",
    people: [],
    listed: true,
    accent: "sky",
    intro: "",
    visibility: "guest",
    costsVisibility: "public",
    ...overrides,
  };
}

function fakeSub(overrides: Partial<StoredSubscription> = {}): StoredSubscription {
  return {
    username: "ana",
    endpoint: `https://push.example/${Math.random().toString(36).slice(2)}`,
    keys: { p256dh: "p", auth: "a" },
    created: "2026-08-01",
    ...overrides,
  };
}

async function signUpAndConfirm(owner: string, email: string) {
  await requestContact(owner, {
    name: "A Reader",
    email,
    locale: "de",
    address: null,
    wantsEmailDigest: true,
    wantsPostcard: false,
    createdVia: "open",
  });
  const { code } = await issueCode(owner, email, "guest");
  const result = await confirmContact(owner, email, code);
  if (!result.ok) throw new Error("expected the confirmation to succeed");
  return result.contact;
}

let dir: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-push-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "push.db")}`;
  process.env.CONTACTS_ENCRYPTION_KEY = KEY;
  delete process.env.AUTH_DEV_CODE;

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test" },
      users: { reserved: [] },
      features: {},
    }),
  );
  clearConfigCache();
  clearUserCache();

  const { migrateToLatest } = await import("@/lib/db/migrate");
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.CONTACTS_ENCRYPTION_KEY;
  delete process.env.DATA_DIR;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("subscribersFor — public and unlisted trips", () => {
  test("every subscription qualifies, known contact or not", async () => {
    const trip = fakeTrip({ visibility: "public" });
    // A contact tied to a subscription, but never approved — still counts,
    // because a public trip needs no identity check at all.
    const contact = await signUpAndConfirm("ana", "family@example.com");
    await saveSubscription(fakeSub());
    await saveSubscription(fakeSub({ contactId: contact.id }));

    const eligible = await subscribersFor(trip);
    expect(eligible).toHaveLength(2);
  });

  test("unlisted behaves the same as public", async () => {
    const trip = fakeTrip({ visibility: "public" });
    await saveSubscription(fakeSub());
    expect(await subscribersFor(trip)).toHaveLength(1);
  });
});

describe("subscribersFor — closed trips", () => {
  test("a subscription nobody could identify is not notified", async () => {
    const trip = fakeTrip({ visibility: "guest" });
    await saveSubscription(fakeSub({ contactId: null }));
    expect(await subscribersFor(trip)).toEqual([]);
  });

  test("a subscription tied to a pending (unapproved) contact is not notified", async () => {
    const trip = fakeTrip({ visibility: "guest" });
    const contact = await signUpAndConfirm("ana", "waiting@example.com");
    await saveSubscription(fakeSub({ contactId: contact.id }));
    expect(await subscribersFor(trip)).toEqual([]);
  });

  test("a subscription tied to a blocked contact is not notified", async () => {
    const trip = fakeTrip({ visibility: "guest" });
    const contact = await signUpAndConfirm("ana", "family@example.com");
    await approveContact("ana", contact.id);
    await revokeContact("ana", contact.id);
    await saveSubscription(fakeSub({ contactId: contact.id }));
    expect(await subscribersFor(trip)).toEqual([]);
  });

  test("an approved contact's grant covers every trip in the journal", async () => {
    const trip = fakeTrip({ visibility: "guest" });
    const contact = await signUpAndConfirm("ana", "family@example.com");
    await approveContact("ana", contact.id); // approval is the grant
    const sub = fakeSub({ contactId: contact.id });
    await saveSubscription(sub);

    const eligible = await subscribersFor(trip);
    expect(eligible.map((s) => s.endpoint)).toEqual([sub.endpoint]);

    // The same grant, and a second trip: a grant is journal-wide, so it
    // covers a trip that did not exist when it was written.
    const later = fakeTrip({ visibility: "guest", id: "algarve-2024" });
    expect((await subscribersFor(later)).map((s) => s.endpoint)).toEqual([sub.endpoint]);
  });

  /**
   * The negative case, without a trip id in it. Grants used to carry one and
   * nothing ever wrote it (B35); what is left is present or absent, and absent
   * is what an approval taken back looks like.
   */
  test("a contact whose grant is gone is not notified", async () => {
    const trip = fakeTrip({ visibility: "guest", id: "asia-2023" });
    const contact = await signUpAndConfirm("ana", "family@example.com");
    await approveContact("ana", contact.id);
    await saveSubscription(fakeSub({ contactId: contact.id }));
    expect(await subscribersFor(trip)).toHaveLength(1);

    const { db } = await getDatabase();
    await db.deleteFrom("access_grants").where("contact_id", "=", contact.id).execute();
    expect(await subscribersFor(trip)).toEqual([]);
  });

  test("a grant of another scope is not a read grant", async () => {
    const trip = fakeTrip({ visibility: "guest", id: "asia-2023" });
    const contact = await signUpAndConfirm("ana", "family@example.com");
    await approveContact("ana", contact.id);
    const { db } = await getDatabase();
    await db.deleteFrom("access_grants").where("contact_id", "=", contact.id).execute();
    await db
      .insertInto("access_grants")
      .values({
        id: "grant-1",
        owner_id: "ana",
        contact_id: contact.id,
        scope: "costs",
        granted_at: new Date().toISOString(),
        granted_by: "ana",
        expires_at: null,
      })
      .execute();

    await saveSubscription(fakeSub({ contactId: contact.id }));
    expect(await subscribersFor(trip)).toEqual([]);
  });

  test("one user's grants never cover another user's trip", async () => {
    const trip = fakeTrip({ visibility: "guest", username: "other", id: "asia-2023" });
    const contact = await signUpAndConfirm("ana", "family@example.com");
    await approveContact("ana", contact.id);
    // Subscribed to "other", but the only contact/grant on record is "ana"'s.
    await saveSubscription(fakeSub({ username: "other", contactId: contact.id }));
    expect(await subscribersFor(trip)).toEqual([]);
  });
});

/**
 * B68. A `read` grant is journal-wide and means *this person may read the
 * journal's `guest` trips*. It has never meant a `private` one — `mayReadTrip`
 * refuses that to a journal guest before it asks anything else — and this
 * function never asked which kind of closed trip it had.
 *
 * So the approved family member with the PWA installed was pushed a title and
 * a link to a page that then refused them: the digest's stated harm ("it tells
 * somebody something private exists and then refuses them, which is the one
 * thing a private trip is for") arriving by the channel that interrupts.
 */
describe("subscribersFor — a private trip", () => {
  test("notifies nobody, even an active contact holding a live read grant", async () => {
    const contact = await signUpAndConfirm("ana", "family@example.com");
    await approveContact("ana", contact.id); // approval is the grant
    const sub = fakeSub({ contactId: contact.id });
    await saveSubscription(sub);

    // The same contact, the same grant, the same subscription: the `guest`
    // trip reaches them and the `private` one does not. Asserted together, so
    // this cannot pass because the fixture stopped granting anything.
    expect((await subscribersFor(fakeTrip({ visibility: "guest" }))).map((x) => x.endpoint)).toEqual(
      [sub.endpoint],
    );
    expect(await subscribersFor(fakeTrip({ visibility: "private" }))).toEqual([]);
  });

  test("notifies nobody when the device cannot be identified either", async () => {
    await saveSubscription(fakeSub({ contactId: null }));
    expect(await subscribersFor(fakeTrip({ visibility: "private" }))).toEqual([]);
  });

  /**
   * The cost of the line, asserted rather than left to be rediscovered: the
   * people who were actually on the trip get nothing either. They can open it
   * — the gate lets them through on their address — but a subscription carries
   * a `contactId` and `isPersonOn` matches an address, and resolving one to
   * the other here would mean importing `lib/contacts` into the notify path.
   * Refusing is the fail-safe direction and the same one the digest takes.
   */
  test("notifies nobody on `people:` either, which is the accepted cost", async () => {
    const contact = await signUpAndConfirm("ana", "robin@example.com");
    await approveContact("ana", contact.id);
    await saveSubscription(fakeSub({ contactId: contact.id }));

    const trip = fakeTrip({
      visibility: "private",
      people: [{ name: "Robin", email: "robin@example.com" }],
    });
    expect(await subscribersFor(trip)).toEqual([]);
  });
});

/**
 * B70. The same rule the digest was taught, in the surface that sits even
 * closer to the reader.
 *
 * A `test: true` trip is content nobody lived. Every reading surface contains
 * it by wearing a banner; a notification is a title and a link on a lock
 * screen and has nowhere to put one — so the answer is not to notify at all.
 * `public` is the case that matters, because that is what a trip written to
 * prove the pipeline usually is, and because `isOpenToLink` would otherwise
 * hand it every subscription in the journal before any other question is
 * asked.
 */
describe("subscribersFor — a trip nobody lived", () => {
  test("a public test trip notifies nobody, unidentified device or approved contact", async () => {
    const trip = fakeTrip({ visibility: "public", test: true });
    const contact = await signUpAndConfirm("ana", "family@example.com");
    await approveContact("ana", contact.id);
    await saveSubscription(fakeSub());
    await saveSubscription(fakeSub({ contactId: contact.id }));

    // The same two subscriptions on the same trip without the flag: both.
    expect(await subscribersFor(fakeTrip({ visibility: "public" }))).toHaveLength(2);
    expect(await subscribersFor(trip)).toEqual([]);
  });

  test("a guest test trip notifies nobody either", async () => {
    const contact = await signUpAndConfirm("ana", "family@example.com");
    await approveContact("ana", contact.id); // approval is the grant
    await saveSubscription(fakeSub({ contactId: contact.id }));

    expect(await subscribersFor(fakeTrip({ visibility: "guest" }))).toHaveLength(1);
    expect(await subscribersFor(fakeTrip({ visibility: "guest", test: true }))).toEqual([]);
  });
});

describe("subscribersFor — no database", () => {
  beforeEach(() => {
    delete process.env.DATABASE_URL;
    process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-push-file-"));
  });

  test("a public trip still notifies its subscribers", async () => {
    const trip = fakeTrip({ visibility: "public" });
    await saveSubscription(fakeSub());
    expect(await subscribersFor(trip)).toHaveLength(1);
  });

  test("a closed trip notifies nobody — there is no way to tell who may read it", async () => {
    const trip = fakeTrip({ visibility: "guest" });
    await saveSubscription(fakeSub());
    expect(await subscribersFor(trip)).toEqual([]);
  });
});

describe("findActiveContactId", () => {
  test("finds an active contact by email, case-insensitively", async () => {
    const contact = await signUpAndConfirm("ana", "family@example.com");
    await approveContact("ana", contact.id);
    expect(await findActiveContactId("ana", "FAMILY@Example.com")).toBe(contact.id);
  });

  test("a merely-confirmed, not-yet-approved contact does not count", async () => {
    await signUpAndConfirm("ana", "waiting@example.com");
    expect(await findActiveContactId("ana", "waiting@example.com")).toBeNull();
  });

  test("an unknown address is null, not an error", async () => {
    expect(await findActiveContactId("ana", "nobody@example.com")).toBeNull();
  });

  test("without a database, nobody can be identified", async () => {
    delete process.env.DATABASE_URL;
    expect(await findActiveContactId("ana", "family@example.com")).toBeNull();
  });
});

describe("isGoneSubscription", () => {
  test("404 and 410 are gone", () => {
    expect(isGoneSubscription({ statusCode: 404 })).toBe(true);
    expect(isGoneSubscription({ statusCode: 410 })).toBe(true);
  });

  test("anything else is not", () => {
    expect(isGoneSubscription({ statusCode: 500 })).toBe(false);
    expect(isGoneSubscription(new Error("boom"))).toBe(false);
    expect(isGoneSubscription(null)).toBe(false);
    expect(isGoneSubscription(undefined)).toBe(false);
  });
});

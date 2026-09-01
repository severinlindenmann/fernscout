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
 * prove it may read a password-protected trip must never be notified about
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

describe("subscribersFor — password-protected trips", () => {
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

  test("a password-protected trip notifies nobody — there is no way to tell who may read it", async () => {
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

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, expect, test } from "vitest";

/**
 * `scripts/migrate-trip-people.mts` — security review of D3/B2297, F1–F4.
 *
 * Run as a real subprocess, not imported: the script calls `process.exit`
 * on completion, which would kill this test runner if it ran in-process.
 * Each test gets its own `CONTENT_DIR`/sqlite file, since the script's own
 * idempotency is what several of these cases are asking about — sharing
 * state between them would make "brand-new contact" and "a second run
 * changes nothing" both ask a stale question.
 *
 * The rule under test throughout: the migration must give a `people:` entry
 * exactly the access it had before — read+write on the one trip it named —
 * and nothing more. A first pass at this script (before this review) opened
 * every other pending/revoked `trip_people` row the contact happened to
 * hold (F1), wrote a journal-wide `access_grants` row nothing about
 * `people:` ever implied (F2), and defaulted a brand-new contact's mail
 * consent to "on" for a door that had never mailed anyone (F3).
 */

const ROOT = process.cwd();
const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
const ROBIN = "robin@example.test";

let dir: string;

function writeTrip(id: string, visibility: string, people: string[]) {
  const root = path.join(dir, OWNER, "trips", id);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(
    path.join(root, "trip.json"),
    JSON.stringify({
      id,
      title: id,
      dates: { from: "2026-08-25", to: "2026-08-26" },
      visibility,
      people: people.map((email) => ({ name: "R", email })),
    }),
  );
}

function runMigration(extraArgs: string[] = []): string {
  return execFileSync(
    "npx",
    ["tsx", "--conditions=react-server", "scripts/migrate-trip-people.mts", "--user", OWNER, ...extraArgs],
    { cwd: ROOT, env: { ...process.env, CONTENT_DIR: dir }, encoding: "utf8" },
  );
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "migrate-trip-people-"));
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
      title: "T",
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
  // "named": the trip Robin is actually on. "other": a pending buddy-link
  // request the owner never approved. "family": a `guest` trip, open to
  // nobody the migration touches unless it wrongly grants journal-wide read.
  writeTrip("named", "private", [ROBIN]);
  writeTrip("other", "private", []);
  writeTrip("family", "guest", []);

  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.CONTACTS_ENCRYPTION_KEY = "66".repeat(32);
  process.env.SESSION_SECRET = "77".repeat(32);
  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  clearConfigCache();
  clearUserCache();
  const { migrateToLatest } = await import("@/lib/db/migrate");
  const { getDatabase } = await import("@/lib/db");
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  for (const key of ["CONTENT_DIR", "DATABASE_URL", "CONTACTS_ENCRYPTION_KEY", "SESSION_SECRET"]) {
    delete process.env[key];
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test("F1: a pending request on an unrelated trip is not opened by the migration", async () => {
  const { requestContact } = await import("@/lib/contacts");
  const { claimTripPlace, isPersonOn } = await import("@/lib/tripPeople");
  const { getTrip } = await import("@/lib/trips");

  // Robin also has an unapproved buddy request on "other" — pre-existing
  // state the migration must leave exactly as it found it.
  const requested = await requestContact(OWNER, {
    name: "Robin",
    email: ROBIN,
    locale: "en",
    wantsEmailDigest: false,
    wantsPostcard: false,
    createdVia: "invite",
  });
  await claimTripPlace(OWNER, "other", requested.contactId!, null);
  const other = getTrip(`${OWNER}/other` as never)!;
  expect(await isPersonOn(other, ROBIN)).toBe(false);

  runMigration();

  // "named" opens — that is the entry the migration exists for.
  const named = getTrip(`${OWNER}/named` as never)!;
  expect(await isPersonOn(named, ROBIN)).toBe(true);
  // "other" must stay exactly as it was: a request, not a grant.
  expect(await isPersonOn(other, ROBIN)).toBe(false);
});

test("F2: no journal-wide read grant is written, ever", async () => {
  runMigration();
  const { getDatabase } = await import("@/lib/db");
  const grants = await (await getDatabase()).db.selectFrom("access_grants").selectAll().execute();
  expect(grants).toHaveLength(0);

  // Confirms the negative has teeth: a `guest` trip stays closed to an
  // address whose only door was a `people:` entry on a `private` trip.
  const { getContactByEmail } = await import("@/lib/contacts");
  const contact = await getContactByEmail(OWNER, ROBIN);
  expect(contact?.status).toBe("active");
  const { redeemedTripsFor } = await import("@/lib/tripPeople");
  const places = await redeemedTripsFor(OWNER, ROBIN);
  expect(places.has("family")).toBe(false);
});

test("F3: a brand-new contact starts with the digest off; an existing one's consent is untouched", async () => {
  const { getContactByEmail } = await import("@/lib/contacts");
  runMigration();
  const fresh = await getContactByEmail(OWNER, ROBIN);
  expect(fresh?.wantsEmailDigest).toBe(false);

  // The owner later turns the digest on by hand (a real door, unrelated to
  // this migration) — a second run must not touch it.
  const { getDatabase } = await import("@/lib/db");
  const { db } = await getDatabase();
  await db
    .updateTable("contacts")
    .set({ wants_email_digest: 1 })
    .where("owner_id", "=", OWNER)
    .where("id", "=", fresh!.id)
    .execute();

  runMigration();
  const after = await getContactByEmail(OWNER, ROBIN);
  expect(after?.wantsEmailDigest).toBe(true);
});

test("F4: dry-run reports a blocked address as blocked, not as a grant", async () => {
  const email = "blocked@example.test";
  writeTrip("blocked-trip", "private", [email]);
  const { requestContact, confirmContactByOwner, approveContact, revokeContact, getContactByEmail } =
    await import("@/lib/contacts");
  const requested = await requestContact(OWNER, {
    name: "Blocked",
    email,
    locale: "en",
    wantsEmailDigest: false,
    wantsPostcard: false,
    createdVia: "owner",
  });
  await confirmContactByOwner(OWNER, requested.contactId!);
  const approved = await approveContact(OWNER, requested.contactId!);
  await revokeContact(OWNER, approved!.contact.id);

  const out = runMigration(["--dry-run"]);
  expect(out).not.toContain(`would grant ana/blocked-trip: Blocked <${email}>`);
  expect(out).toMatch(/skipped 1 blocked address/);

  const contact = await getContactByEmail(OWNER, email);
  expect(contact?.status).toBe("blocked");
});

test("idempotent: a second real run changes nothing new", async () => {
  runMigration();
  const second = runMigration();
  expect(second).toContain("Granted 0, already granted");
});

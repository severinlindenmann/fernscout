import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

/**
 * B411 — what one address may open, across every journal on the instance.
 *
 * The question the site could not previously ask. Two journals here rather
 * than one, because that is the whole claim: a resolver that reads a
 * journal-scoped cookie can be right about one of them and is structurally
 * incapable of being right about both.
 *
 * The property under test is that this **never widens access**. It reports
 * what `mayReadTrip` would already allow, and being listed a journal you
 * cannot open is the same leak as being shown its trips — which is B41,
 * one level up.
 */

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
const OTHER = "bea";
const OTHER_EMAIL = "bea@example.test";
/** Approved into bea's journal, on no trip anywhere. */
const READER = "oma@example.test";
/** On one of bea's trips by name, approved into nothing. */
const BUDDY = "kim@example.test";
/** Nobody, anywhere. */
const STRANGER = "nils@example.test";

let dir: string;

function writeJournal(username: string, email: string, visibility?: "guest") {
  fs.mkdirSync(path.join(dir, username), { recursive: true });
  fs.writeFileSync(
    path.join(dir, username, "config.json"),
    JSON.stringify({
      title: `${username}'s journal`,
      tagline: "A tagline.",
      owner: { name: username, nickname: username, email },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      ...(visibility ? { visibility } : {}),
      features: { auth: { enabled: true }, contacts: { enabled: true } },
    }),
  );
}

function writeTrip(
  username: string,
  id: string,
  visibility: "public" | "guest" | "private",
  people: string[] = [],
) {
  const root = path.join(dir, username, "trips", id);
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
      `visibility: "${visibility}"`,
      ...(visibility === "public" ? [] : ["listed: false"]),
      ...(people.length > 0
        ? ["people:", ...people.map((e) => `  - { name: "P", email: "${e}" }`)]
        : []),
      "---",
      "",
      "Intro.",
      "",
    ].join("\n"),
  );
}

async function journalsFor(email: string) {
  const { journalsFor: fn } = await import("@/lib/home");
  return fn(email);
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-home-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.CONTACTS_ENCRYPTION_KEY = "33".repeat(32);

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: { auth: { enabled: true }, contacts: { enabled: true } },
    }),
  );

  writeJournal(OWNER, OWNER_EMAIL);
  writeTrip(OWNER, "open-2026", "public");
  writeTrip(OWNER, "ours-2026", "private", [OWNER_EMAIL]);

  // Deliberately an unlisted journal. `listedUsernames()` excludes it, which
  // is exactly why the home view cannot be built from that list: a journal you
  // were invited into is the most likely one to be unadvertised.
  writeJournal(OTHER, OTHER_EMAIL, "guest");
  writeTrip(OTHER, "invited-2026", "guest");
  writeTrip(OTHER, "theirs-2026", "private", [BUDDY]);

  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  clearConfigCache();
  clearUserCache();

  const { getDatabase } = await import("@/lib/db");
  const { migrateToLatest } = await import("@/lib/db/migrate");
  await migrateToLatest(await getDatabase());
});

afterAll(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.CONTACTS_ENCRYPTION_KEY;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("journalsFor", () => {
  test("a stranger holds nothing, however many public trips exist", async () => {
    // `open-2026` is public and readable by them — and a journal whose only
    // trips they can see are public ones is not *theirs*. It belongs in the
    // public list, and claiming it under "your journals" would assert access
    // nobody granted.
    expect(await journalsFor(STRANGER)).toEqual([]);
  });

  test("an owner gets their own journal, labelled as theirs", async () => {
    const journals = await journalsFor(OWNER_EMAIL);
    expect(journals.map((j) => j.username)).toEqual([OWNER]);
    expect(journals[0].role).toBe("owner");
    // Owner sees everything in it, private trip included.
    expect(journals[0].trips.map((t) => t.id).sort()).toEqual(["open-2026", "ours-2026"]);
    expect(journals[0].trips.every((t) => t.through === "owner")).toBe(true);
  });

  test("somebody on a trip gets that journal as a traveller, without any grant", async () => {
    const journals = await journalsFor(BUDDY);
    expect(journals.map((j) => j.username)).toEqual([OTHER]);
    expect(journals[0].role).toBe("traveller");
    // The private trip they are named on. Not the `guest` trip: they were
    // never approved into the journal, and being on one trip is not being a
    // guest of the whole thing.
    expect(journals[0].trips.map((t) => t.id)).toEqual(["theirs-2026"]);
    expect(journals[0].trips[0].through).toBe("traveller");
  });

  /**
   * The unlisted journal is the point of this one. `listedUsernames()` would
   * never return `bea`, so a home view built from the landing page's list
   * would show an approved guest nothing at all.
   */
  test("an approved guest gets the unlisted journal they were let into", async () => {
    const { approveContact, confirmContact, listContacts, requestContact } = await import(
      "@/lib/contacts"
    );
    const { issueCode } = await import("@/lib/auth");

    // Before approval: confirmed, but let into nothing.
    await requestContact(OTHER, {
      name: "Oma",
      email: READER,
      locale: "en",
      address: null,
      wantsEmailDigest: false,
      wantsPostcard: false,
      createdVia: "open",
    });
    const { code } = await issueCode(OTHER, READER, "guest");
    expect((await confirmContact(OTHER, READER, code)).ok).toBe(true);
    expect(await journalsFor(READER)).toEqual([]);

    // Approving is what writes the grant, and the grant is what opens it.
    const contact = (await listContacts(OTHER)).find((c) => c.email === READER)!;
    await approveContact(OTHER, contact.id);

    const journals = await journalsFor(READER);
    expect(journals.map((j) => j.username)).toEqual([OTHER]);
    expect(journals[0].role).toBe("guest");
    // The `guest` trip, and never the `private` one — a trip held back from
    // the people who are otherwise let in is exactly what `private` is for.
    expect(journals[0].trips.map((t) => t.id)).toEqual(["invited-2026"]);
    expect(journals[0].trips[0].through).toBe("guest");
  });

  test("revoking the approval takes the journal away again", async () => {
    const { listContacts, revokeContact } = await import("@/lib/contacts");
    const contact = (await listContacts(OTHER)).find((c) => c.email === READER)!;
    await revokeContact(OTHER, contact.id);
    expect(await journalsFor(READER)).toEqual([]);
  });

  test("owner first, then traveller, then guest", async () => {
    const { approveContact, confirmContact, listContacts, requestContact } = await import(
      "@/lib/contacts"
    );
    const { issueCode } = await import("@/lib/auth");

    // ana already owns her own journal; let her into bea's as a guest too.
    await requestContact(OTHER, {
      name: "Ana",
      email: OWNER_EMAIL,
      locale: "en",
      address: null,
      wantsEmailDigest: false,
      wantsPostcard: false,
      createdVia: "open",
    });
    const { code } = await issueCode(OTHER, OWNER_EMAIL, "guest");
    expect((await confirmContact(OTHER, OWNER_EMAIL, code)).ok).toBe(true);
    const contact = (await listContacts(OTHER)).find((c) => c.email === OWNER_EMAIL)!;
    await approveContact(OTHER, contact.id);

    const journals = await journalsFor(OWNER_EMAIL);
    // Two journals, and the one that is hers comes first — it is what she
    // came to the page for.
    expect(journals.map((j) => [j.username, j.role])).toEqual([
      [OWNER, "owner"],
      [OTHER, "guest"],
    ]);
  });
});

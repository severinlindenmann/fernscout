import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import type { Trip } from "@/lib/types";

/**
 * The panel and the gate, asked the same question.
 *
 * B41. `resolveViewer` told an approved contact, on their own `/<user>/me`
 * page, that they could open every `visibility: guest` trip in the journal;
 * `mayReadTrip` then asked them for a password nobody had ever issued. Two
 * pieces of code answering "may this person read this trip" differently is the
 * whole bug, so the test that matters is a table over every viewer and every
 * trip, asserting the two agree.
 *
 * The one divergence the table permits is stated in it and asserted to be the
 * only one: a `public` trip with `listed: false` is readable by anybody and
 * advertised to nobody, which is what `listed` is for. Everywhere else the
 * panel's answer and the gate's answer are the same answer.
 */

/** Every cookie the mocked `next/headers` hands back — session and trip alike. */
const jar = vi.hoisted(() => ({ cookies: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.cookies[name] === undefined ? undefined : { value: jar.cookies[name] },
  }),
}));

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
/** Approved: an active contact, holding the journal-wide read grant. */
const GUEST = "oma@example.test";
/** Confirmed their address and waiting for the owner. */
const PENDING = "knock@example.test";
/** Approved once, then revoked. */
const BLOCKED = "gone@example.test";
/** On `people:` for one trip, and not a contact at all. */
const ROBIN = "robin@example.test";

/** A hash no password matches — the anonymous door, left shut throughout. */
const A_HASH = "scrypt$32768$8$1$c2FsdA$a2V5";

type TripSpec = {
  id: string;
  /** Written into the frontmatter verbatim, older words included. */
  visibility: string;
  password: boolean;
  people: string[];
  costsVisibility: "public" | "guests";
};

/**
 * `quiet-2026` says `unlisted` rather than `public` + `listed: false` because
 * that is the only spelling the parser honours — `lib/trips.ts` derives
 * `listed` from `visibility` and never reads a `listed:` key at all, which is
 * B51.
 */
const TRIPS: TripSpec[] = [
  { id: "open-2026", visibility: "public", password: false, people: [], costsVisibility: "guests" },
  { id: "quiet-2026", visibility: "unlisted", password: false, people: [], costsVisibility: "public" },
  { id: "invited-2026", visibility: "guest", password: true, people: [], costsVisibility: "guests" },
  { id: "secret-2026", visibility: "private", password: false, people: [], costsVisibility: "guests" },
  { id: "robins-2026", visibility: "private", password: false, people: [ROBIN], costsVisibility: "guests" },
];

/**
 * What each viewer should be told, and what each viewer should be let into.
 *
 * `panel` is `resolveViewer`'s `through` value, or null for "not mentioned".
 * `read` is `mayReadTrip`. Written out per case rather than derived, because a
 * table that recomputes the implementation cannot disagree with it.
 */
type Expectation = { panel: "public" | "traveller" | "guest" | null; read: boolean };

const EXPECTED: Record<string, Record<string, Expectation>> = {
  // Nobody signed in.
  anonymous: {
    "open-2026": { panel: "public", read: true },
    "quiet-2026": { panel: null, read: true }, // unlisted, not locked
    "invited-2026": { panel: null, read: false },
    "secret-2026": { panel: null, read: false },
    "robins-2026": { panel: null, read: false },
  },
  // Signed in, confirmed, never approved. Reads no more than a stranger.
  pending: {
    "open-2026": { panel: "public", read: true },
    "quiet-2026": { panel: null, read: true },
    "invited-2026": { panel: null, read: false },
    "secret-2026": { panel: null, read: false },
    "robins-2026": { panel: null, read: false },
  },
  // Approved. A guest of the journal — every `guest` trip, no `private` one.
  approved: {
    "open-2026": { panel: "public", read: true },
    "quiet-2026": { panel: null, read: true },
    "invited-2026": { panel: "guest", read: true },
    "secret-2026": { panel: null, read: false },
    "robins-2026": { panel: null, read: false },
  },
  // Approved and then revoked. Back to a stranger.
  revoked: {
    "open-2026": { panel: "public", read: true },
    "quiet-2026": { panel: null, read: true },
    "invited-2026": { panel: null, read: false },
    "secret-2026": { panel: null, read: false },
    "robins-2026": { panel: null, read: false },
  },
  // On one trip's `people:`, and nothing else. Their own private trip, and
  // not the journal's other one — and no more than a stranger everywhere else,
  // because being on a trip is not being a guest of the journal.
  traveller: {
    "open-2026": { panel: "public", read: true },
    "quiet-2026": { panel: null, read: true },
    "invited-2026": { panel: null, read: false },
    "secret-2026": { panel: null, read: false },
    "robins-2026": { panel: "traveller", read: true },
  },
  // The journal's owner reads their own journal, including the trip they did
  // not put themselves on `people:` for.
  owner: {
    "open-2026": { panel: "traveller", read: true },
    "quiet-2026": { panel: "traveller", read: true },
    "invited-2026": { panel: "traveller", read: true },
    "secret-2026": { panel: "traveller", read: true },
    "robins-2026": { panel: "traveller", read: true },
  },
};

let dir: string;
/** Session tokens by viewer name; `anonymous` has none. */
const tokens: Record<string, string | null> = { anonymous: null };

function writeConfigs() {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: { auth: { enabled: true }, contacts: { enabled: true } },
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

function writeTrip(spec: TripSpec) {
  const root = path.join(dir, OWNER, "trips", spec.id);
  fs.mkdirSync(path.join(root, "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "trip.md"),
    [
      "---",
      `id: "${spec.id}"`,
      `title: "${spec.id}"`,
      'start: "2026-08-25"',
      'end: "2026-08-26"',
      'status: "past"',
      `visibility: "${spec.visibility}"`,
      `costsVisibility: "${spec.costsVisibility}"`,
      ...(spec.password ? [`passwordHash: "${A_HASH}"`] : []),
      ...(spec.people.length > 0
        ? ["people:", ...spec.people.map((e) => `  - { name: "Robin", email: "${e}" }`)]
        : []),
      "---",
      "",
      "Intro.",
      "",
    ].join("\n"),
  );
}

async function signIn(email: string): Promise<string> {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, email, "guest");
  const session = await verifyCode(OWNER, email, code, "guest");
  if (!session.ok) throw new Error(`sign-in failed for ${email}: ${session.reason}`);
  return session.token;
}

/** Somebody who filled the form and proved they can read the address. */
async function addContact(email: string) {
  const { confirmContact, requestContact } = await import("@/lib/contacts");
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
}

async function contactIdFor(email: string): Promise<string> {
  const { listContacts } = await import("@/lib/contacts");
  const contact = (await listContacts(OWNER)).find((c) => c.email === email);
  if (!contact) throw new Error(`no contact for ${email}`);
  return contact.id;
}

/** Puts the named viewer behind the cookie jar for the calls that follow. */
function as(viewer: string) {
  jar.cookies = {};
  const token = tokens[viewer];
  if (token) jar.cookies.fs_session = token;
}

async function tripsByRef(): Promise<Map<string, Trip>> {
  const { getTrips } = await import("@/lib/trips");
  return new Map(getTrips(OWNER).map((t) => [t.id, t]));
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-gate-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.CONTACTS_ENCRYPTION_KEY = "44".repeat(32);
  process.env.SESSION_SECRET = "55".repeat(32);
  writeConfigs();
  for (const spec of TRIPS) writeTrip(spec);

  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  clearConfigCache();
  clearUserCache();

  const { approveContact, revokeContact } = await import("@/lib/contacts");

  await addContact(GUEST);
  await approveContact(OWNER, await contactIdFor(GUEST));

  await addContact(PENDING);

  await addContact(BLOCKED);
  const blockedId = await contactIdFor(BLOCKED);
  await approveContact(OWNER, blockedId);
  await revokeContact(OWNER, blockedId);

  tokens.approved = await signIn(GUEST);
  tokens.pending = await signIn(PENDING);
  tokens.revoked = await signIn(BLOCKED);
  tokens.traveller = await signIn(ROBIN);
  tokens.owner = await signIn(OWNER_EMAIL);
});

afterAll(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.CONTACTS_ENCRYPTION_KEY;
  delete process.env.SESSION_SECRET;
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Every viewer against every trip — the assertion the whole task is about. */
const CASES = Object.keys(EXPECTED).flatMap((viewer) =>
  TRIPS.map((spec) => [viewer, spec.id] as const),
);

describe("the panel and the gate agree", () => {
  test.each(CASES)("%s / %s", async (viewer, id) => {
    const expected = EXPECTED[viewer][id];
    as(viewer);

    const { resolveViewer } = await import("@/lib/viewer");
    const { mayReadTrip } = await import("@/lib/tripGate");

    const panel = (await resolveViewer(OWNER)).trips.find((t) => t.id === id)?.through ?? null;
    expect(panel, "what /me tells them").toBe(expected.panel);

    as(viewer);
    const trip = (await tripsByRef()).get(id);
    if (!trip) throw new Error(`no trip ${id}`);
    expect(await mayReadTrip(trip), "what the gate allows").toBe(expected.read);
  });

  /**
   * The property `test/viewer.test.ts` has always claimed and B45 reported as
   * false: the panel never widens access. Derived from the table rather than
   * stated again, so it cannot be satisfied by a table that lies.
   */
  test("nothing the panel mentions is refused by the gate", () => {
    for (const [viewer, rows] of Object.entries(EXPECTED)) {
      for (const [id, { panel, read }] of Object.entries(rows)) {
        if (panel !== null) {
          expect(read, `${viewer} is told about ${id}`).toBe(true);
        }
      }
    }
  });

  /**
   * And the converse, with its one deliberate exception. A `public` trip with
   * `listed: false` is the old `unlisted`: openable by anybody holding the
   * link, advertised to nobody — including in the panel of somebody who could
   * open it. Any *other* trip the gate opens and the panel stays quiet about
   * is a bug in one of the two.
   */
  test("the only trip the gate opens without the panel saying so is an unlisted public one", () => {
    const quiet: string[] = [];
    for (const [viewer, rows] of Object.entries(EXPECTED)) {
      for (const [id, { panel, read }] of Object.entries(rows)) {
        if (read && panel === null) quiet.push(`${viewer}/${id}`);
      }
    }
    expect(new Set(quiet.map((q) => q.split("/")[1]))).toEqual(new Set(["quiet-2026"]));
  });
});

describe("an approved contact needs no password", () => {
  test("opens a guest trip with no trip cookie at all", async () => {
    as("approved");
    const trip = (await tripsByRef()).get("invited-2026")!;
    const { mayReadTrip } = await import("@/lib/tripGate");
    expect(jar.cookies).not.toHaveProperty("fs_trip_ana_invited-2026");
    expect(await mayReadTrip(trip)).toBe(true);
  });

  test("a stranger still meets the password form", async () => {
    as("anonymous");
    const trip = (await tripsByRef()).get("invited-2026")!;
    const { mayReadTrip, tripLockReason } = await import("@/lib/tripGate");
    expect(await mayReadTrip(trip)).toBe(false);
    expect(await tripLockReason(trip)).toBe("locked");
  });
});

/**
 * `private` does not widen — the decision B41 records.
 *
 * The gate's own doc comment says what "refused" has to mean here: a layout
 * that hides the page does not stop the page component running, so the page
 * returns null and `generateMetadata` answers `lockedMetadata`. Both hang off
 * `mayReadTrip` being false, which is what this asserts; that every gated page
 * actually calls it is `test/trip-gate.test.ts`. Nothing that lists trips may
 * mention it either, which is the RSC payload the user layout ships.
 */
describe("a journal guest is refused a private trip", () => {
  test("the gate, the costs, the switcher and the panel all say no", async () => {
    as("approved");
    const trips = await tripsByRef();
    const secret = trips.get("secret-2026")!;

    const { isGuestOf, listableTrips, mayReadTrip, lockedMetadata } = await import(
      "@/lib/tripGate"
    );
    expect(await mayReadTrip(secret)).toBe(false);

    // Costs: not a guest of a trip they may not read, whatever the journal
    // let them into.
    as("approved");
    expect(await isGuestOf(secret)).toBe(false);
    as("approved");
    const { mayViewCosts } = await import("@/lib/tripGate");
    expect(await mayViewCosts(secret)).toBe(false);

    // The trip switcher, which travels in the RSC payload of every page.
    as("approved");
    const listed = await listableTrips([...trips.values()]);
    expect(listed.map((t) => t.id)).not.toContain("secret-2026");

    // The panel.
    as("approved");
    const { resolveViewer } = await import("@/lib/viewer");
    const viewer = await resolveViewer(OWNER);
    expect(viewer.trips.map((t) => t.id)).not.toContain("secret-2026");

    // And the metadata a locked trip is allowed to emit carries no prose.
    const meta = lockedMetadata(secret);
    expect(meta.description).toBeUndefined();
    expect(meta.openGraph).toBeUndefined();
    expect(meta.robots).toEqual({ index: false, follow: false });
  });
});

describe("costs marked for guests", () => {
  test("render for an approved contact and not for a stranger", async () => {
    const trip = (await tripsByRef()).get("invited-2026")!;
    const { mayViewCosts } = await import("@/lib/tripGate");

    as("approved");
    expect(await mayViewCosts(trip)).toBe(true);

    as("anonymous");
    expect(await mayViewCosts(trip)).toBe(false);

    as("pending");
    expect(await mayViewCosts(trip)).toBe(false);
  });
});

/**
 * The expiry decision, recorded in B41 and enforced in one place.
 *
 * `access_grants.expires_at` is the record of *until when* somebody was let
 * in, and it is the question both the panel and the gate ask — the same
 * question `contactsWithReadGrant` has always asked for the digest. Nothing
 * writes a non-null expiry today, so this reaches into the row directly: the
 * point is that the answer changes for both surfaces at once.
 */
describe("a grant that has expired is not a grant", () => {
  test("the panel stops listing the trip and the gate stops opening it", async () => {
    const { getDatabase } = await import("@/lib/db");
    const { db } = await getDatabase();
    const contactId = await contactIdFor(GUEST);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();

    await db
      .updateTable("access_grants")
      .set({ expires_at: yesterday })
      .where("owner_id", "=", OWNER)
      .where("contact_id", "=", contactId)
      .execute();

    try {
      const trip = (await tripsByRef()).get("invited-2026")!;
      as("approved");
      const { mayReadTrip } = await import("@/lib/tripGate");
      expect(await mayReadTrip(trip)).toBe(false);

      as("approved");
      const { resolveViewer } = await import("@/lib/viewer");
      const viewer = await resolveViewer(OWNER);
      expect(viewer.guest).toBe(false);
      expect(viewer.trips.map((t) => t.id)).not.toContain("invited-2026");
    } finally {
      await db
        .updateTable("access_grants")
        .set({ expires_at: null })
        .where("owner_id", "=", OWNER)
        .where("contact_id", "=", contactId)
        .execute();
    }
  });
});

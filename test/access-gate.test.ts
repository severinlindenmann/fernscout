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
 * B39 removed the password, which makes the grant the only door into a `guest`
 * trip — and makes one row of the table the most important assertion in the
 * project: **`stranger`, somebody who has proved an address and been granted
 * nothing, reads exactly what `anonymous` reads.** Proving an address is free;
 * `/api/auth/request` mails a code to anyone who asks, because answering
 * differently would say who reads somebody's journal. The mail proves who you
 * are; the grant decides what you may read. If those two ever merge, every
 * closed trip on the instance is readable by anyone with an inbox, and this
 * table is what says so.
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
/**
 * Signed in, and nothing else: never a contact, never invited, never on a
 * trip. Anybody at all can be this, which is the point.
 */
const STRANGER = "anyone@example.test";

type TripSpec = {
  id: string;
  /** Written into the frontmatter verbatim, older words included. */
  visibility: string;
  people: string[];
  costsVisibility: "public" | "guests";
  /** Written into the frontmatter when set. Omitted otherwise, which is what
   * an ordinary trip.md looks like. */
  listed?: boolean;
  /** Content nobody lived. Orthogonal to visibility, which is the point. */
  test?: boolean;
};

/**
 * `quiet-2026` is written the way the documentation has always described an
 * unadvertised public trip — `visibility: public` plus `listed: false` — and
 * that spelling is the one this table runs on. It used to say `unlisted`,
 * because until B51 the legacy word was the only spelling the parser honoured:
 * `listed` was derived from `visibility` and the key itself read by nothing.
 * The whole table below is the evidence that the two spellings are one
 * behaviour rather than two.
 */
const TRIPS: TripSpec[] = [
  { id: "open-2026", visibility: "public", people: [], costsVisibility: "guests" },
  { id: "quiet-2026", visibility: "public", listed: false, people: [], costsVisibility: "public" },
  { id: "invited-2026", visibility: "guest", people: [], costsVisibility: "guests" },
  { id: "secret-2026", visibility: "private", people: [], costsVisibility: "guests" },
  { id: "robins-2026", visibility: "private", people: [ROBIN], costsVisibility: "guests" },
  // `test: true` is a second dimension, not a sixth visibility (B70). Both
  // spellings are here because the harm differs: the public one is what an
  // agent proving the pipeline writes on a fresh instance, the guest one is
  // what it writes on a journal already in use — and B52 is what put the
  // second within reach of the digest.
  { id: "proving-2026", visibility: "public", people: [], costsVisibility: "guests", test: true },
  {
    id: "proving-guest-2026",
    visibility: "guest",
    people: [],
    costsVisibility: "guests",
    test: true,
  },
];

/** The trips nobody lived — the column the announcing surfaces must skip. */
const TEST_TRIPS = TRIPS.filter((t) => t.test).map((t) => t.id);

/**
 * What each viewer should be told, what each viewer should be let into, and
 * what each *announcing* surface may say to them unprompted.
 *
 * Four columns, four surfaces, one table:
 *
 * - `read` is `mayReadTrip` — the gate, and the only thing that actually
 *   opens a page. Every other column is measured against it.
 * - `panel` is `resolveViewer`'s `through` value, or null for "not
 *   mentioned": what `/<user>/me` tells somebody who came looking.
 * - `switcher` is `listableTrips` — the trip list `app/[user]/layout.tsx`
 *   and `app/[user]/trips/page.tsx` both render, and the one that travels in
 *   the RSC payload of every page whether the reader opened a menu or not
 *   (B45).
 * - `digest` is `digestableTrips` — what arrives in their inbox uninvited.
 * - `push` is `subscribersFor` — what arrives on their lock screen (B68).
 *
 * The two halves are different questions and it is worth keeping them apart.
 * `read`, `panel` and `switcher` answer "may I", asked by somebody already
 * here. `digest` and `push` answer "should we say", asked by nobody — which is why those
 * columns can be `false` where `read` is `true` (an unlisted trip, a trip
 * nobody lived) and **must never be `true` where `read` is `false`**. That
 * last relation is asserted below, derived from the table, for both.
 *
 * The two announcing columns differ in one place and it is not a mistake:
 * `quiet-2026` is push `true` and digest `false`. An unlisted trip is
 * openable by anyone with the link, so notifying a device that asked for
 * notifications tells it nothing it could not already reach; mailing every
 * address on the contact list *is* the advertising `listed: false` refuses.
 * Push is asked by a device that opted in, the digest by an owner writing to
 * a list.
 *
 * `push` is also the one column not keyed to a session: a subscription is
 * identified by the `contactId` recorded when it was saved, so each viewer
 * here owns one subscription — carrying their contact id where they have one,
 * and `null` where they do not, which is what an unidentified device is.
 *
 * Written out per case rather than derived, because a table that recomputes
 * the implementation cannot disagree with it.
 */
type Expectation = {
  panel: "public" | "owner" | "traveller" | "guest" | null;
  /**
   * Whether `listableTrips` puts it in the trip switcher — the list the user
   * layout ships in the RSC payload of every page in the journal (B45).
   */
  switcher: boolean;
  read: boolean;
  /** Whether `digestableTrips` would put this trip in this reader's mail. */
  digest: boolean;
  /** Whether `subscribersFor` would put it on this reader's lock screen. */
  push: boolean;
};

const EXPECTED: Record<string, Record<string, Expectation>> = {
  // Nobody signed in.
  anonymous: {
    "open-2026": { panel: "public", switcher: true, read: true, digest: true, push: true },
    // unlisted, not locked — openable by link, advertised nowhere.
    "quiet-2026": { panel: null, switcher: false, read: true, digest: false, push: true },
    "invited-2026": { panel: null, switcher: false, read: false, digest: false, push: false },
    "secret-2026": { panel: null, switcher: false, read: false, digest: false, push: false },
    "robins-2026": { panel: null, switcher: false, read: false, digest: false, push: false },
    // Nobody lived it: openable, banner and all, and mailed to no one.
    "proving-2026": { panel: "public", switcher: true, read: true, digest: false, push: false },
    "proving-guest-2026": { panel: null, switcher: false, read: false, digest: false, push: false },
  },
  // Signed in, and that is all. Never a contact, never invited. **Identical
  // to `anonymous` above, deliberately and forever**: signing in is an
  // identity claim, not a key. Any diff that makes this row differ from the
  // anonymous one has opened every closed trip on the instance.
  stranger: {
    "open-2026": { panel: "public", switcher: true, read: true, digest: true, push: true },
    "quiet-2026": { panel: null, switcher: false, read: true, digest: false, push: true },
    "invited-2026": { panel: null, switcher: false, read: false, digest: false, push: false },
    "secret-2026": { panel: null, switcher: false, read: false, digest: false, push: false },
    "robins-2026": { panel: null, switcher: false, read: false, digest: false, push: false },
    "proving-2026": { panel: "public", switcher: true, read: true, digest: false, push: false },
    "proving-guest-2026": { panel: null, switcher: false, read: false, digest: false, push: false },
  },
  // Signed in, confirmed, never approved. Reads no more than a stranger.
  pending: {
    "open-2026": { panel: "public", switcher: true, read: true, digest: true, push: true },
    "quiet-2026": { panel: null, switcher: false, read: true, digest: false, push: true },
    "invited-2026": { panel: null, switcher: false, read: false, digest: false, push: false },
    "secret-2026": { panel: null, switcher: false, read: false, digest: false, push: false },
    "robins-2026": { panel: null, switcher: false, read: false, digest: false, push: false },
    "proving-2026": { panel: "public", switcher: true, read: true, digest: false, push: false },
    "proving-guest-2026": { panel: null, switcher: false, read: false, digest: false, push: false },
  },
  // Approved. A guest of the journal — every `guest` trip, no `private` one.
  // The only reader whose digest goes beyond what the world may read (B52),
  // and the reason the test rows below matter: the guest test trip is one
  // they *can* open and must still never be mailed about (B70).
  approved: {
    "open-2026": { panel: "public", switcher: true, read: true, digest: true, push: true },
    "quiet-2026": { panel: null, switcher: false, read: true, digest: true, push: true },
    "invited-2026": { panel: "guest", switcher: true, read: true, digest: true, push: true },
    "secret-2026": { panel: null, switcher: false, read: false, digest: false, push: false },
    "robins-2026": { panel: null, switcher: false, read: false, digest: false, push: false },
    "proving-2026": { panel: "public", switcher: true, read: true, digest: false, push: false },
    "proving-guest-2026": { panel: "guest", switcher: true, read: true, digest: false, push: false },
  },
  // Approved and then revoked. Back to a stranger.
  revoked: {
    "open-2026": { panel: "public", switcher: true, read: true, digest: true, push: true },
    "quiet-2026": { panel: null, switcher: false, read: true, digest: false, push: true },
    "invited-2026": { panel: null, switcher: false, read: false, digest: false, push: false },
    "secret-2026": { panel: null, switcher: false, read: false, digest: false, push: false },
    "robins-2026": { panel: null, switcher: false, read: false, digest: false, push: false },
    "proving-2026": { panel: "public", switcher: true, read: true, digest: false, push: false },
    "proving-guest-2026": { panel: null, switcher: false, read: false, digest: false, push: false },
  },
  // On one trip's `people:`, and nothing else. Their own private trip, and
  // not the journal's other one — and no more than a stranger everywhere else,
  // because being on a trip is not being a guest of the journal.
  traveller: {
    "open-2026": { panel: "public", switcher: true, read: true, digest: true, push: true },
    "quiet-2026": { panel: null, switcher: false, read: true, digest: false, push: true },
    "invited-2026": { panel: null, switcher: false, read: false, digest: false, push: false },
    "secret-2026": { panel: null, switcher: false, read: false, digest: false, push: false },
    "robins-2026": { panel: "traveller", switcher: true, read: true, digest: false, push: false },
    "proving-2026": { panel: "public", switcher: true, read: true, digest: false, push: false },
    "proving-guest-2026": { panel: null, switcher: false, read: false, digest: false, push: false },
  },
  // The journal's owner reads their own journal, including the trip they did
  // not put themselves on `people:` for — and is told so in those words.
  // They are not a contact, so the digest treats them as ungranted: they are
  // not on its list at all.
  //
  // Every row here is `owner` and not one is `traveller`, which is the whole
  // of B80: Ana is on nobody's `people:` block, `robins-2026` is Robin's
  // fortnight written up in her journal, and the panel used to tell her she
  // had been there.
  owner: {
    "open-2026": { panel: "owner", switcher: true, read: true, digest: true, push: true },
    "quiet-2026": { panel: "owner", switcher: false, read: true, digest: false, push: true },
    "invited-2026": { panel: "owner", switcher: true, read: true, digest: false, push: false },
    "secret-2026": { panel: "owner", switcher: true, read: true, digest: false, push: false },
    "robins-2026": { panel: "owner", switcher: true, read: true, digest: false, push: false },
    "proving-2026": { panel: "owner", switcher: true, read: true, digest: false, push: false },
    "proving-guest-2026": { panel: "owner", switcher: true, read: true, digest: false, push: false },
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
      ...(spec.listed === undefined ? [] : [`listed: ${spec.listed}`]),
      `costsVisibility: "${spec.costsVisibility}"`,
      ...(spec.test ? ["test: true"] : []),
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

/**
 * The push subscription belonging to one viewer.
 *
 * Push is the one surface in this table that is not asked through a cookie: a
 * subscription is a device, tied at subscribe time to an active contact if it
 * could be told which one (`findActiveContactId`). So each viewer owns exactly
 * one endpoint, and `anonymous`, `stranger`, `traveller` and `owner` own an
 * unidentified one — which is what a device that subscribed without a session,
 * or with a session that matches no contact, actually is.
 */
function endpointFor(viewer: string): string {
  return `https://push.example/${viewer}`;
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

  const { saveSubscription } = await import("@/lib/push");
  // One device per viewer, carrying their contact id where they have one.
  // `pending` and `revoked` are contacts and would still be `null` in
  // production (the route only ties an *active* one), which would make their
  // rows pass for the wrong reason — so they carry theirs, and the status and
  // grant checks are what have to refuse them.
  const contactIds: Record<string, string | null> = {
    anonymous: null,
    stranger: null,
    traveller: null,
    owner: null,
    approved: await contactIdFor(GUEST),
    pending: await contactIdFor(PENDING),
    revoked: await contactIdFor(BLOCKED),
  };
  for (const [viewer, contactId] of Object.entries(contactIds)) {
    await saveSubscription({
      username: OWNER,
      endpoint: endpointFor(viewer),
      keys: { p256dh: "p", auth: "a" },
      created: "2026-08-01",
      contactId,
    });
  }

  tokens.approved = await signIn(GUEST);
  tokens.stranger = await signIn(STRANGER);
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

    // The switcher, asked over the whole journal exactly as the layout asks
    // it — one call, not one per trip, because `listableTrips` does a single
    // grant lookup for the list and asking per trip would not exercise that.
    as(viewer);
    const { listableTrips } = await import("@/lib/tripGate");
    const listed = await listableTrips([...(await tripsByRef()).values()]);
    expect(listed.some((t) => t.id === id), "what the switcher advertises").toBe(
      expected.switcher,
    );
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
   * The same property for the switcher, which is the surface B45 named as
   * worth checking alongside the panel. It is the stronger of the two: the
   * panel is a page somebody navigated to, while the switcher is serialised
   * into every page of the journal, so a trip named here is named to a reader
   * who never asked. Derived from the table for the same reason.
   */
  test("nothing the switcher advertises is refused by the gate", () => {
    for (const [viewer, rows] of Object.entries(EXPECTED)) {
      for (const [id, { switcher, read }] of Object.entries(rows)) {
        if (switcher) expect(read, `${viewer} is shown ${id} in the switcher`).toBe(true);
      }
    }
  });

  /**
   * And the switcher's converse, with the same single exception the panel
   * has. `listableTrips` is deliberately narrower than the gate for a
   * `public` trip with `listed: false` — not advertising a trip anybody could
   * open is what the field is for. Any *other* trip the gate opens and the
   * switcher stays quiet about is a bug.
   */
  test("the only trip the gate opens without the switcher listing it is an unlisted public one", () => {
    const quiet: string[] = [];
    for (const [viewer, rows] of Object.entries(EXPECTED)) {
      for (const [id, { switcher, read }] of Object.entries(rows)) {
        if (read && !switcher) quiet.push(`${viewer}/${id}`);
      }
    }
    expect(new Set(quiet.map((q) => q.split("/")[1]))).toEqual(new Set(["quiet-2026"]));
  });

  /**
   * And the same property for the two surfaces that speak first. The panel
   * answers somebody who came looking; the digest and push arrive unasked, so
   * the rule is the same one and it matters more. Derived from the table, so a
   * table that lies cannot satisfy it.
   */
  test("nothing the digest or push announces is refused by the gate", () => {
    for (const [viewer, rows] of Object.entries(EXPECTED)) {
      for (const [id, { read, digest, push }] of Object.entries(rows)) {
        if (digest) expect(read, `${viewer} is mailed about ${id}`).toBe(true);
        if (push) expect(read, `${viewer} is pushed about ${id}`).toBe(true);
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

/**
 * The digest, held to the same table. B52.
 *
 * `digestableTrips` (`lib/digest/visibility.ts`) states its own rule: **a
 * digest never contains a line about a trip the reader cannot open.** That is
 * not a property of the digest alone — it is a relation between two files, and
 * the only way to assert it is to run both against the same readers and the
 * same trips. So: whatever the digest would mention to a reader must be a
 * subset of what the gate would open for that same reader, for every row of the
 * table above.
 *
 * B52 widened the digest to include `guest` trips, which is why this is here.
 * Before it, the subset was trivially satisfied by mentioning almost nothing;
 * the two positive assertions below are what stop it being satisfied that way
 * again, and `private` is asserted to be in nobody's mail at all.
 *
 * The two sides are joined by one word, `granted`, and it has to mean the same
 * thing twice: a live `read` grant here, and `isJournalGuest` — an **active**
 * contact holding a live grant — at the gate. `planDigest` drops every contact
 * that is not active before it calls `digestableTrips`, so `grantedFor` below
 * asks both questions in the same order the digest run does.
 */
describe("the digest never mentions a trip the gate would refuse", () => {
  const EMAILS: Record<string, string | null> = {
    anonymous: null,
    stranger: STRANGER,
    pending: PENDING,
    approved: GUEST,
    revoked: BLOCKED,
    traveller: ROBIN,
    owner: OWNER_EMAIL,
  };

  /**
   * The `granted` bit the digest run would pass for this viewer — asked of the
   * database, not written down, so it cannot drift from what `runDigest` does.
   */
  async function grantedFor(viewer: string): Promise<boolean> {
    const email = EMAILS[viewer];
    if (!email) return false;
    const { listContacts } = await import("@/lib/contacts");
    const contact = (await listContacts(OWNER)).find((c) => c.email === email);
    // Exactly `planDigest`'s order: a contact, active, holding a live grant.
    if (!contact || contact.status !== "active") return false;
    const { contactsWithReadGrant } = await import("@/lib/grants");
    return (await contactsWithReadGrant(OWNER, new Date())).has(contact.id);
  }

  test.each(Object.keys(EXPECTED))("%s: every line leads somewhere open", async (viewer) => {
    const trips = [...(await tripsByRef()).values()];
    const { digestableTrips } = await import("@/lib/digest/visibility");
    const { mayReadTrip } = await import("@/lib/tripGate");

    const mentioned = digestableTrips(trips, await grantedFor(viewer));
    for (const trip of mentioned) {
      as(viewer);
      expect(await mayReadTrip(trip), `${viewer} is mailed about ${trip.id}`).toBe(true);
      // And the table, so a gate that started saying yes to everything would
      // not quietly make this pass.
      expect(EXPECTED[viewer][trip.id].read, `${trip.id} in the table`).toBe(true);
    }
  });

  /** And the column itself, exactly — not a subset of it. */
  test.each(Object.keys(EXPECTED))("%s: the digest column, trip by trip", async (viewer) => {
    const trips = [...(await tripsByRef()).values()];
    const { digestableTrips } = await import("@/lib/digest/visibility");

    const mentioned = new Set(
      digestableTrips(trips, await grantedFor(viewer)).map((t) => t.id),
    );
    for (const [id, expected] of Object.entries(EXPECTED[viewer])) {
      expect(mentioned.has(id), `${viewer} is mailed about ${id}`).toBe(expected.digest);
    }
  });

  /**
   * B70. `test: true` is the second dimension of this table, and the digest is
   * where forgetting it costs the most.
   *
   * Every other surface that hides a test trip has somewhere to explain
   * itself: the page carries a banner, the markdown twin carries the flag
   * twice over (B47). A digest line is a date, a title, a location and a link,
   * and a mail cannot be walked back — so invented content does not go out by
   * mail at all, which was the decision rather than making the mail able to
   * disclaim it.
   *
   * The `guest` one is the case B52 created: before it, this needed a `public`
   * trip carrying the flag; now a grant-holder reaches the guest one too.
   */
  test("a trip nobody lived is in nobody's digest, grant or no grant", async () => {
    const trips = [...(await tripsByRef()).values()];
    const { digestableTrips } = await import("@/lib/digest/visibility");
    for (const granted of [true, false]) {
      const ids = digestableTrips(trips, granted).map((t) => t.id);
      for (const id of TEST_TRIPS) expect(ids, `granted: ${granted}`).not.toContain(id);
    }
    // And the flag really is on them, so this is not passing because the
    // fixture stopped writing it.
    for (const id of TEST_TRIPS) expect((await tripsByRef()).get(id)?.test).toBe(true);
  });

  /**
   * The one thing a test trip is *not*: locked. It opens for anyone the
   * visibility lets in, banner and all — the containment is about announcing
   * it, never about refusing it, and a fix that quietly gated test trips would
   * be a different change from the one B70 asked for.
   */
  test("a test trip is hidden from the mail and not from the gate", async () => {
    const { mayReadTrip } = await import("@/lib/tripGate");
    as("anonymous");
    expect(await mayReadTrip((await tripsByRef()).get("proving-2026")!)).toBe(true);
    as("approved");
    expect(await mayReadTrip((await tripsByRef()).get("proving-guest-2026")!)).toBe(true);
  });

  test("an approved reader is told about the guest trip", async () => {
    const trips = [...(await tripsByRef()).values()];
    const { digestableTrips } = await import("@/lib/digest/visibility");
    expect(digestableTrips(trips, await grantedFor("approved")).map((t) => t.id)).toContain(
      "invited-2026",
    );
  });

  test("a reader with no grant is told only what the world may read", async () => {
    const trips = [...(await tripsByRef()).values()];
    const { digestableTrips } = await import("@/lib/digest/visibility");
    for (const viewer of ["anonymous", "stranger", "pending", "revoked", "traveller"]) {
      // `proving-2026` is public, listed and would be advertised anywhere
      // else on the instance — it is absent because nobody lived it.
      expect(digestableTrips(trips, await grantedFor(viewer)).map((t) => t.id), viewer).toEqual([
        "open-2026",
      ]);
    }
  });

  test("a private trip is in nobody's digest, grant or no grant", async () => {
    const trips = [...(await tripsByRef()).values()];
    const { digestableTrips } = await import("@/lib/digest/visibility");
    for (const granted of [true, false]) {
      const ids = digestableTrips(trips, granted).map((t) => t.id);
      expect(ids, `granted: ${granted}`).not.toContain("secret-2026");
      // Not even the trip its own traveller can open: the digest is addressed
      // by contact and cannot know a contact was on the bus.
      expect(ids, `granted: ${granted}`).not.toContain("robins-2026");
    }
  });
});

/**
 * Push, held to the same table. B68.
 *
 * `subscribersFor` (`lib/push.ts`) asked two questions and skipped a third: it
 * let everybody through for a trip `isOpenToLink`, and otherwise took any
 * subscription tied to an active contact holding a `read` grant. It never
 * asked what kind of *closed* trip it had. A `read` grant is journal-wide and
 * means "this person may read the journal's `guest` trips"; `mayReadTrip`
 * refuses a `private` one to a journal guest before it asks anything else. So
 * the approved family member with the PWA installed was pushed a title and a
 * link to a page that then refused them.
 *
 * B41 established this property for the panel and B52 for the digest, both in
 * this file. Push was the last surface still answering on its own, which is
 * why the fix is a column here rather than a test of its own: what the table
 * is for is that a fifth surface cannot be written that forgets one of these
 * questions.
 */
describe("push never announces a trip the gate would refuse", () => {
  test.each(Object.keys(EXPECTED))("%s: the push column, trip by trip", async (viewer) => {
    const trips = await tripsByRef();
    const { subscribersFor } = await import("@/lib/push");

    for (const [id, expected] of Object.entries(EXPECTED[viewer])) {
      const trip = trips.get(id);
      if (!trip) throw new Error(`no trip ${id}`);
      const endpoints = (await subscribersFor(trip)).map((sub) => sub.endpoint);
      expect(endpoints.includes(endpointFor(viewer)), `${viewer} is pushed about ${id}`).toBe(
        expected.push,
      );
    }
  });

  /** The line that was missing, stated on its own so a regression names itself. */
  test("a private trip is on nobody's lock screen, grant or no grant", async () => {
    const trips = await tripsByRef();
    const { subscribersFor } = await import("@/lib/push");
    for (const id of ["secret-2026", "robins-2026"]) {
      expect(await subscribersFor(trips.get(id)!), id).toEqual([]);
    }
    // And the approved contact really is subscribed and really is granted —
    // the same device reaches the guest trip, so this is not passing because
    // nobody was eligible for anything.
    const invited = await subscribersFor(trips.get("invited-2026")!);
    expect(invited.map((sub) => sub.endpoint)).toEqual([endpointFor("approved")]);
  });

  /**
   * Push and the digest disagree on exactly one trip, and it is deliberate.
   * `quiet-2026` is `public` with `listed: false` — openable by anyone with
   * the link. Notifying a device that asked to be notified adds nothing it
   * could not already reach; mailing the whole contact list is the advertising
   * `listed: false` exists to refuse. Pinned so the next person to "make them
   * consistent" has to argue with a test.
   */
  test("the one place push says more than the digest is an unlisted public trip", () => {
    const wider: string[] = [];
    for (const [viewer, rows] of Object.entries(EXPECTED)) {
      for (const [id, { digest, push }] of Object.entries(rows)) {
        if (push && !digest) wider.push(`${viewer}/${id}`);
      }
    }
    expect(new Set(wider.map((w) => w.split("/")[1]))).toEqual(new Set(["quiet-2026"]));
  });
});

describe("an approved contact is let in by the grant alone", () => {
  test("opens a guest trip with nothing but a session cookie", async () => {
    as("approved");
    const trip = (await tripsByRef()).get("invited-2026")!;
    const { mayReadTrip } = await import("@/lib/tripGate");
    expect(Object.keys(jar.cookies)).toEqual(["fs_session"]);
    expect(await mayReadTrip(trip)).toBe(true);
  });

  test("a stranger still meets the gate", async () => {
    as("anonymous");
    const trip = (await tripsByRef()).get("invited-2026")!;
    const { mayReadTrip } = await import("@/lib/tripGate");
    expect(await mayReadTrip(trip)).toBe(false);
  });
});

/**
 * **The assertion this whole task turns on.** B39.
 *
 * The obvious way to replace a password form with a sign-in form is to let the
 * sign-in be what opens the trip: enter an address, get a code, be let in.
 * That would be a strictly worse gate than the password it replaced, because
 * everybody has an address and `/api/auth/request` will mail a code to any of
 * them. So: a session grants nothing. What a stranger sees signed in is what
 * they saw signed out — the page, the metadata, the switcher, the panel and
 * the costs, all five.
 *
 * Asserted against `anonymous` rather than against a list of `false`s, so it
 * cannot be satisfied by a change that locks both of them out of something
 * they should both be able to read.
 */
describe("a signed-in stranger", () => {
  test("sees exactly what they saw signed out, trip by trip", async () => {
    const trips = [...(await tripsByRef()).values()];
    const { mayReadTrip, isGuestOf, mayViewCosts } = await import("@/lib/tripGate");

    const answers = async (viewer: string, trip: Trip) => {
      as(viewer);
      return {
        read: await mayReadTrip(trip),
        guest: await isGuestOf(trip),
        costs: await mayViewCosts(trip),
      };
    };

    for (const trip of trips) {
      const before = await answers("anonymous", trip);
      const after = await answers("stranger", trip);
      expect(after, `${trip.id}: signing in changed something`).toEqual(before);
    }
  });

  test("the switcher and the panel mention no more than they did", async () => {
    const trips = [...(await tripsByRef()).values()];
    const { listableTrips } = await import("@/lib/tripGate");
    const { resolveViewer } = await import("@/lib/viewer");

    as("anonymous");
    const listedOut = (await listableTrips(trips)).map((t) => t.id);
    as("anonymous");
    const panelOut = (await resolveViewer(OWNER)).trips.map((t) => t.id);

    as("stranger");
    const listedIn = (await listableTrips(trips)).map((t) => t.id);
    as("stranger");
    const panelIn = (await resolveViewer(OWNER)).trips.map((t) => t.id);

    expect(listedIn).toEqual(listedOut);
    expect(panelIn).toEqual(panelOut);
  });

  /**
   * And the page itself. `mayReadTrip` being false is what makes every gated
   * page return `null` and answer `lockedMetadata` — see `test/trip-gate.ts`,
   * which asserts each of them actually calls it. Here: the metadata a refused
   * trip is allowed to emit carries nothing of the trip at all — not even its
   * title, which B117 took out of the browser tab.
   */
  test("gets locked metadata, with no prose in it", async () => {
    as("stranger");
    const trip = (await tripsByRef()).get("invited-2026")!;
    const { mayReadTrip, lockedMetadata } = await import("@/lib/tripGate");
    expect(await mayReadTrip(trip)).toBe(false);

    const meta = lockedMetadata();
    expect(meta.description).toBeUndefined();
    expect(meta.openGraph).toBeUndefined();
    expect(meta.robots).toEqual({ index: false, follow: false });
    // Not even the trip's name, since B117 — see lib/tripGate.ts.
    expect(JSON.stringify(meta)).not.toContain(trip.title);
  });

  /**
   * The gate has to *say* something different to them, though. A stranger with
   * no session needs the sign-in form; somebody already signed in needs to be
   * told this trip is not theirs, or they will sign in again and conclude the
   * site is broken. That is the only thing signing in changes.
   */
  test("is recognised by name, which is what the gate says back to them", async () => {
    const { signedInAs } = await import("@/lib/tripGate");
    as("anonymous");
    expect(await signedInAs(OWNER)).toBeNull();
    as("stranger");
    expect(await signedInAs(OWNER)).toBe(STRANGER);
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
    const meta = lockedMetadata();
    expect(meta.description).toBeUndefined();
    expect(meta.openGraph).toBeUndefined();
    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(JSON.stringify(meta)).not.toContain(secret.title);
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
 * in, and it is the question the panel, the gate and push all ask — the same
 * question `contactsWithReadGrant` has always asked for the digest. Nothing
 * writes a non-null expiry today, so this reaches into the row directly: the
 * point is that the answer changes for every surface at once.
 *
 * Push is here because of B82. It was the one reader of `access_grants` that
 * ran its own query and treated *a row exists* as *the person is let in*,
 * which made an expired grant keep interrupting somebody's lock screen long
 * after the panel and the gate had stopped letting them in. It now asks
 * `lib/grants.ts` like everybody else, and the way to keep it that way is for
 * the expiry case to cover all three surfaces rather than two.
 */
describe("a grant that has expired is not a grant", () => {
  test("the panel, the gate and push all stop, together", async () => {
    const { getDatabase } = await import("@/lib/db");
    const { db } = await getDatabase();
    const { subscribersFor } = await import("@/lib/push");
    const contactId = await contactIdFor(GUEST);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();

    // While the grant is live, all three say yes — so nothing below passes
    // because the fixture stopped being eligible for anything.
    const live = (await tripsByRef()).get("invited-2026")!;
    as("approved");
    const { mayReadTrip } = await import("@/lib/tripGate");
    expect(await mayReadTrip(live)).toBe(true);
    expect((await subscribersFor(live)).map((sub) => sub.endpoint)).toContain(
      endpointFor("approved"),
    );

    await db
      .updateTable("access_grants")
      .set({ expires_at: yesterday })
      .where("owner_id", "=", OWNER)
      .where("contact_id", "=", contactId)
      .execute();

    try {
      const trip = (await tripsByRef()).get("invited-2026")!;
      as("approved");
      expect(await mayReadTrip(trip)).toBe(false);

      as("approved");
      const { resolveViewer } = await import("@/lib/viewer");
      const viewer = await resolveViewer(OWNER);
      expect(viewer.guest).toBe(false);
      expect(viewer.trips.map((t) => t.id)).not.toContain("invited-2026");

      // And the channel that interrupts. The device is still subscribed and
      // its contact is still `active`; only the grant has run out (B82).
      expect((await subscribersFor(trip)).map((sub) => sub.endpoint)).not.toContain(
        endpointFor("approved"),
      );
      expect(await subscribersFor(trip)).toEqual([]);
    } finally {
      await db
        .updateTable("access_grants")
        .set({ expires_at: null })
        .where("owner_id", "=", OWNER)
        .where("contact_id", "=", contactId)
        .execute();
    }
  });

  /**
   * B130. The writer's half of the same rule.
   *
   * The test above is about every *reader* agreeing that an expired row is not
   * a grant. This one is about the one thing that can undo that: the owner
   * clicking approve again. `approveContact` guarded its insert on the row
   * merely existing, so the lapsed row stayed lapsed, the contact went
   * `active`, and the person was still refused everywhere — the worst shape a
   * bug can take, because the interface reported success.
   *
   * Asserted on all three surfaces, for the same reason the expiry case is:
   * the answer has to change for the panel, the gate and push at once, or
   * `lib/grants.ts` has stopped being the single place that decides.
   */
  test("approving again revives it, on all three surfaces", async () => {
    const { getDatabase } = await import("@/lib/db");
    const { db } = await getDatabase();
    const { subscribersFor } = await import("@/lib/push");
    const { approveContact } = await import("@/lib/contacts");
    const { contactsWithReadGrant } = await import("@/lib/grants");
    const contactId = await contactIdFor(GUEST);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();

    await db
      .updateTable("access_grants")
      .set({ expires_at: yesterday })
      .where("owner_id", "=", OWNER)
      .where("contact_id", "=", contactId)
      .execute();

    try {
      // Precondition: they really are shut out before the click, so what
      // follows is the approval working rather than the expiry never landing.
      expect([...(await contactsWithReadGrant(OWNER, new Date()))]).not.toContain(contactId);

      await approveContact(OWNER, contactId);

      // One grant, not two: reviving the row must not leave a second one
      // behind for the readers to disagree over.
      const rows = await db
        .selectFrom("access_grants")
        .select(["expires_at"])
        .where("owner_id", "=", OWNER)
        .where("contact_id", "=", contactId)
        .where("scope", "=", "read")
        .execute();
      expect(rows).toHaveLength(1);
      expect(rows[0].expires_at).toBe(null);

      expect([...(await contactsWithReadGrant(OWNER, new Date()))]).toContain(contactId);

      const trip = (await tripsByRef()).get("invited-2026")!;
      as("approved");
      const { mayReadTrip } = await import("@/lib/tripGate");
      expect(await mayReadTrip(trip)).toBe(true);

      as("approved");
      const { resolveViewer } = await import("@/lib/viewer");
      const viewer = await resolveViewer(OWNER);
      expect(viewer.guest).toBe(true);
      expect(viewer.trips.map((t) => t.id)).toContain("invited-2026");

      expect((await subscribersFor(trip)).map((sub) => sub.endpoint)).toContain(
        endpointFor("approved"),
      );
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

/**
 * The other way onto a trip, held to the same relation. B45.
 *
 * Everything above reaches a trip through the file on disk or through a
 * journal-wide grant. A **buddy link** is the third door (B33): the owner
 * issues a link naming one trip, somebody redeems it, the owner approves them,
 * and a row in `trip_people` puts them on that trip — a `private` one, which
 * no grant can ever open.
 *
 * It is worth a block of its own because the panel and the gate reach that row
 * by two *different queries*. `resolveViewer` and `listableTrips` call
 * `redeemedTripsFor` (one query, every trip, keyed by address);
 * `mayReadTrip` calls `isTravellerOn` → `isPersonOn` → `redeemedPeopleOf` (one
 * query, one trip, keyed by trip id). Two queries answering one question is
 * exactly the shape of the bug this task reported — a panel computing its own,
 * more generous answer — so the thing to assert is that they agree, and
 * especially that they agree about the trips this reader was *not* invited to.
 *
 * Approving a buddy does both halves at once (`approveContact` →
 * `approveTripPlaces`), so this reader is a journal guest *and* on one private
 * trip. That makes `robins-2026` the assertion that carries the weight: a
 * second `private` trip in the same journal, which neither door opens.
 */
describe("somebody let onto one trip by a buddy link", () => {
  const BUDDY = "buddy@example.test";
  let buddyId: string;

  beforeAll(async () => {
    const { approveContact } = await import("@/lib/contacts");
    const { claimTripPlace } = await import("@/lib/tripPeople");
    await addContact(BUDDY);
    buddyId = await contactIdFor(BUDDY);
    // Redeeming the link writes a request, not a place; the approval below is
    // what turns it into access, and it is the only thing that does.
    await claimTripPlace(OWNER, "secret-2026", buddyId, null);
    await approveContact(OWNER, buddyId);
    tokens.buddy = await signIn(BUDDY);
  });

  test("the gate, the panel and the switcher all name the one trip", async () => {
    const trips = await tripsByRef();
    const { mayReadTrip, listableTrips } = await import("@/lib/tripGate");
    const { resolveViewer } = await import("@/lib/viewer");

    as("buddy");
    expect(await mayReadTrip(trips.get("secret-2026")!)).toBe(true);

    as("buddy");
    const panel = (await resolveViewer(OWNER)).trips;
    // `traveller` and not `guest`: a redeemed place reads the same as a name
    // typed into `people:`, which is what `isPersonOnWith` is for.
    expect(panel.find((t) => t.id === "secret-2026")?.through).toBe("traveller");

    as("buddy");
    const listed = (await listableTrips([...trips.values()])).map((t) => t.id);
    expect(listed).toContain("secret-2026");
  });

  /**
   * The negative, and the one that matters. `robins-2026` is the journal's
   * other `private` trip: this reader holds a live journal grant and a live
   * place on a different trip, and neither is a way in. If the two queries
   * ever disagree — a place read as journal-wide, a grant read as a place —
   * this is the row that says so.
   */
  test("is told nothing about the private trip they were not invited to", async () => {
    const trips = await tripsByRef();
    const { mayReadTrip, listableTrips, isGuestOf, mayViewCosts } = await import(
      "@/lib/tripGate"
    );
    const { resolveViewer } = await import("@/lib/viewer");

    as("buddy");
    expect(await mayReadTrip(trips.get("robins-2026")!)).toBe(false);
    as("buddy");
    expect(await isGuestOf(trips.get("robins-2026")!)).toBe(false);
    as("buddy");
    expect(await mayViewCosts(trips.get("robins-2026")!)).toBe(false);

    as("buddy");
    expect((await resolveViewer(OWNER)).trips.map((t) => t.id)).not.toContain("robins-2026");

    as("buddy");
    const listed = (await listableTrips([...trips.values()])).map((t) => t.id);
    expect(listed).not.toContain("robins-2026");
  });

  /**
   * Revoking the place, and nothing else. The journal grant stays, so the
   * `guest` trip still opens — which is what makes this an assertion about the
   * place rather than about the contact being blocked. All three surfaces have
   * to stop together; a panel or a switcher still naming the trip is B45 again
   * in the one place the gate reads a different query.
   */
  test("loses the trip from all three surfaces when the place is revoked", async () => {
    const { getDatabase } = await import("@/lib/db");
    const { db } = await getDatabase();
    const { revokeTripPlaces } = await import("@/lib/tripPeople");
    await revokeTripPlaces(OWNER, buddyId);

    try {
      const trips = await tripsByRef();
      const { mayReadTrip, listableTrips } = await import("@/lib/tripGate");
      const { resolveViewer } = await import("@/lib/viewer");

      as("buddy");
      expect(await mayReadTrip(trips.get("secret-2026")!)).toBe(false);

      as("buddy");
      expect((await resolveViewer(OWNER)).trips.map((t) => t.id)).not.toContain("secret-2026");

      as("buddy");
      const listed = (await listableTrips([...trips.values()])).map((t) => t.id);
      expect(listed).not.toContain("secret-2026");

      // The journal grant is untouched, so this is the place being revoked and
      // not the reader being blocked.
      as("buddy");
      expect(await mayReadTrip(trips.get("invited-2026")!)).toBe(true);
    } finally {
      await db
        .updateTable("trip_people")
        .set({ revoked_at: null })
        .where("owner_id", "=", OWNER)
        .where("contact_id", "=", buddyId)
        .execute();
    }
  });
});

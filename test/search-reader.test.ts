import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

/**
 * B635 — search finds nothing on a trip the reader is allowed to read.
 *
 * `buildDocs`/`buildSearchIndexJson` (test/search.test.ts) stay exactly as
 * they were: the public index, for a signed-out reader or one signed in with
 * no more than a stranger's rights. This file is the reader-scoped sibling —
 * `buildDocsForReader`/`buildSearchIndexJsonForReader` — asked as five
 * different readers over one fixture:
 *
 * - `open-2026`: public, listed. Carries a plain update and a `guest`-labelled
 *   one (B632), so the same "narrows, never widens" rule applies here too.
 * - `quiet-2026`: public, `listed: false`. The one deliberately asymmetric
 *   case (see the task file's design note): found by the owner and by
 *   whoever was on it, not by a stranger or an approved guest, matching
 *   `listableTrips`.
 * - `invited-2026`: `guest`. Found by the owner, by the person on it, and by
 *   an approved journal contact — the same three `mayReadTrip` lets in.
 * - `secret-2026`: `private`, nobody on it but the owner. The owner's own
 *   trip that started this ticket.
 * - `buddy-2026`: `private`, with BUDDY on `people:`. Proves a traveller
 *   finds *their* closed trip and no other closed one.
 * - `proving-2026`: `test: true`. Never found by anyone, owner included —
 *   B70, unconditionally.
 */

const jar = vi.hoisted(() => ({ cookies: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.cookies[name] === undefined ? undefined : { value: jar.cookies[name] },
  }),
}));

const OWNER = "quinn";
const OWNER_EMAIL = "quinn@example.test";
const BUDDY_EMAIL = "buddy@example.test";
const GUEST_EMAIL = "friend@example.test";
const STRANGER_EMAIL = "anyone@example.test";

const TRIPS: {
  id: string;
  visibility: string;
  listed?: boolean;
  people?: string[];
  test?: boolean;
}[] = [
  { id: "open-2026", visibility: "public" },
  { id: "quiet-2026", visibility: "public", listed: false },
  { id: "invited-2026", visibility: "guest" },
  { id: "secret-2026", visibility: "private" },
  { id: "buddy-2026", visibility: "private", people: [BUDDY_EMAIL] },
  { id: "proving-2026", visibility: "public", test: true },
];

function writeConfigs(dir: string) {
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
      title: "Quinn's Journal",
      owner: { name: "Quinn R", nickname: "Quinn", email: OWNER_EMAIL },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      features: { auth: { enabled: true }, contacts: { enabled: true } },
    }),
  );
}

function writeTrip(dir: string, spec: (typeof TRIPS)[number]) {
  const root = path.join(dir, OWNER, "trips", spec.id);
  fs.mkdirSync(path.join(root, "entries"), { recursive: true });
  const marker = spec.id.toUpperCase().replace(/[^A-Z]/g, "") + "MARKER";
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
      ...(spec.test ? ["test: true"] : []),
      ...(spec.people && spec.people.length > 0
        ? ["people:", ...spec.people.map((e) => `  - { name: "Person", email: "${e}" }`)]
        : []),
      "---",
      "",
      "Intro.",
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(root, "entries", "2026-08-25-day.md"),
    [
      "---",
      `title: "${spec.id} day"`,
      'date: "2026-08-25"',
      'location: "Bellinzona"',
      'country: "Switzerland"',
      "---",
      "",
      `Update. Marker: ${marker}.`,
      "",
    ].join("\n"),
  );

  // `open-2026` alone also carries a `guest`-labelled update, for the B632
  // grain check.
  if (spec.id === "open-2026") {
    fs.writeFileSync(
      path.join(root, "entries", "2026-08-25-day-guest-note.md"),
      [
        "---",
        'title: "open-2026 guest note"',
        'date: "2026-08-25"',
        'location: "Bellinzona"',
        'country: "Switzerland"',
        'visibility: "guest"',
        "---",
        "",
        "Update. Marker: OPENGUESTLABELMARKER.",
        "",
      ].join("\n"),
    );
  }
}

async function signIn(email: string): Promise<string> {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, email, "guest");
  const session = await verifyCode(OWNER, email, code, "guest");
  if (!session.ok) throw new Error(`sign-in failed for ${email}: ${session.reason}`);
  return session.token;
}

async function addApprovedContact(email: string) {
  const { approveContact, confirmContact, listContacts, requestContact } = await import(
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
  const contact = (await listContacts(OWNER)).find((c) => c.email === email);
  if (!contact) throw new Error(`no contact for ${email}`);
  await approveContact(OWNER, contact.id);
}

const tokens: Record<string, string | null> = { anonymous: null };
function as(viewer: string) {
  jar.cookies = {};
  const token = tokens[viewer];
  if (token) jar.cookies.fs_session = token;
}

let dir: string;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-search-reader-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.CONTACTS_ENCRYPTION_KEY = "88".repeat(32);
  process.env.SESSION_SECRET = "99".repeat(32);
  writeConfigs(dir);
  for (const spec of TRIPS) writeTrip(dir, spec);

  await addApprovedContact(GUEST_EMAIL);
  tokens.owner = await signIn(OWNER_EMAIL);
  tokens.buddy = await signIn(BUDDY_EMAIL);
  tokens.guest = await signIn(GUEST_EMAIL);
  tokens.stranger = await signIn(STRANGER_EMAIL);
});

afterAll(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.CONTACTS_ENCRYPTION_KEY;
  delete process.env.SESSION_SECRET;
});

/** All the markers this fixture can produce, keyed by what wrote them. */
const OPEN = "OPENMARKER";
const OPEN_GUEST_NOTE = "OPENGUESTLABELMARKER";
const QUIET = "QUIETMARKER";
const INVITED = "INVITEDMARKER";
const SECRET = "SECRETMARKER";
const BUDDYM = "BUDDYMARKER";
const PROVING = "PROVINGMARKER";

async function jsonFor(viewer: string): Promise<string> {
  const { buildSearchIndexJsonForReader } = await import("@/lib/search");
  as(viewer);
  return (await buildSearchIndexJsonForReader(OWNER))!;
}

/**
 * MiniSearch tokenises into lowercase and (per `SEARCH_OPTIONS`) does not
 * store `body` at all — only its postings — so a marker's *presence* has to
 * be checked case-insensitively against the serialized index. Its *absence*
 * needs no such care: content never indexed is not in the JSON in any case.
 */
function found(json: string, marker: string): boolean {
  return json.toLowerCase().includes(marker.toLowerCase());
}

describe("the owner's search", () => {
  test("finds their own private trip's days — the ticket's own case", async () => {
    const json = await jsonFor("owner");
    expect(found(json, SECRET)).toBe(true);
  });

  test("finds every closed trip, the unlisted one, and the guest-labelled update", async () => {
    const json = await jsonFor("owner");
    expect(found(json, OPEN)).toBe(true);
    expect(found(json, OPEN_GUEST_NOTE)).toBe(true);
    expect(found(json, QUIET)).toBe(true);
    expect(found(json, INVITED)).toBe(true);
    expect(found(json, SECRET)).toBe(true);
    expect(found(json, BUDDYM)).toBe(true);
  });

  test("never finds a trip nobody lived, even their own", async () => {
    const json = await jsonFor("owner");
    expect(json).not.toContain(PROVING);
  });
});

describe("a person on a trip", () => {
  test("finds their own closed trip and no other closed one", async () => {
    const json = await jsonFor("buddy");
    expect(found(json, BUDDYM)).toBe(true);
    expect(json).not.toContain(SECRET);
    expect(json).not.toContain(INVITED);
  });

  test("does not get the owner's unlisted trip for free", async () => {
    const json = await jsonFor("buddy");
    expect(json).not.toContain(QUIET);
  });

  test("still finds the ordinary public trip", async () => {
    const json = await jsonFor("buddy");
    expect(found(json, OPEN)).toBe(true);
  });
});

describe("an approved journal guest", () => {
  test("finds the guest trip they were let into", async () => {
    const json = await jsonFor("guest");
    expect(found(json, INVITED)).toBe(true);
  });

  test("finds the guest-labelled update on the public trip", async () => {
    const json = await jsonFor("guest");
    expect(found(json, OPEN_GUEST_NOTE)).toBe(true);
  });

  test("never finds a private trip, or the unlisted one", async () => {
    const json = await jsonFor("guest");
    expect(json).not.toContain(SECRET);
    expect(json).not.toContain(BUDDYM);
    expect(json).not.toContain(QUIET);
  });
});

describe("a signed-in stranger", () => {
  test("finds exactly what the anonymous, prerendered index finds — nothing more", async () => {
    const { buildSearchIndexJson } = await import("@/lib/search");
    const anonymousJson = buildSearchIndexJson(OWNER)!;
    const strangerJson = await jsonFor("stranger");

    for (const marker of [OPEN]) {
      expect(found(anonymousJson, marker)).toBe(true);
      expect(found(strangerJson, marker)).toBe(true);
    }
    for (const marker of [OPEN_GUEST_NOTE, QUIET, INVITED, SECRET, BUDDYM, PROVING]) {
      expect(anonymousJson).not.toContain(marker);
      expect(strangerJson).not.toContain(marker);
    }
  });
});

describe("the prerendered public JSON", () => {
  test("stays isIndexable-only regardless of who else has signed in this run", async () => {
    const { buildSearchIndexJson } = await import("@/lib/search");
    const json = buildSearchIndexJson(OWNER)!;
    expect(found(json, OPEN)).toBe(true);
    expect(json).not.toContain(OPEN_GUEST_NOTE);
    expect(json).not.toContain(QUIET);
    expect(json).not.toContain(INVITED);
    expect(json).not.toContain(SECRET);
    expect(json).not.toContain(BUDDYM);
    expect(json).not.toContain(PROVING);
  });
});

/**
 * B823 — destinations, not only days, are searchable.
 *
 * The account page (B821) is the sharpest case: an index built once and
 * served to everybody must not tell a stranger this journal even has a
 * storage page. This fixture's journal offers English only
 * (`writeConfigs` above), so the word checked is the ticket's own example in
 * that language, "storage" — `search.accountTerms` in site/locales/en.json.
 */
describe("the destinations in the index", () => {
  test("a trip's own pages (Gallery, Map) are searchable for a reader who may open it", async () => {
    const json = await jsonFor("stranger");
    // No trip in this fixture is `status: current`, so `open-2026` keeps its
    // own trip-scoped URLs rather than the bare journal ones.
    expect(json).toContain(`/${OWNER}/trips/open-2026/gallery`);
    expect(json).toContain(`/${OWNER}/trips/open-2026/map`);
  });

  test("the owner's search finds the account page", async () => {
    const json = await jsonFor("owner");
    expect(json).toContain(`/${OWNER}/account`);
    expect(json.toLowerCase()).toContain("storage");
  });

  test("nobody else's search finds it — not a fellow traveller, not an approved guest, not a stranger", async () => {
    for (const viewer of ["buddy", "guest", "stranger"]) {
      const json = await jsonFor(viewer);
      expect(json).not.toContain(`/${OWNER}/account`);
    }
    // And not in the anonymous, prerendered index either.
    const { buildSearchIndexJson } = await import("@/lib/search");
    const anonymousJson = buildSearchIndexJson(OWNER)!;
    expect(anonymousJson).not.toContain(`/${OWNER}/account`);
  });
});

/**
 * B890 — the journal-scoped destinations, and the trips themselves.
 *
 * Same discipline as the account page above: `/contacts` is the owner's own
 * page, so search must not be the surface that tells anybody else it exists.
 * `/me` is every signed-in reader's, and `/trips` is everybody's.
 */
describe("journal-scoped destinations and trip rows", () => {
  test("the owner finds their contacts page; nobody else does", async () => {
    expect(await jsonFor("owner")).toContain(`/${OWNER}/contacts`);
    for (const viewer of ["buddy", "guest", "stranger"]) {
      expect(await jsonFor(viewer)).not.toContain(`/${OWNER}/contacts`);
    }
    const { buildSearchIndexJson } = await import("@/lib/search");
    expect(buildSearchIndexJson(OWNER)!).not.toContain(`/${OWNER}/contacts`);
  });

  test("the sign-in door is in everybody's index, and it is named for who is reading — B903", async () => {
    for (const viewer of ["owner", "buddy", "guest", "stranger"]) {
      const json = await jsonFor(viewer);
      expect(json).toContain(`/${OWNER}/me`);
      // A reader with a session is offered their own page, not a door they
      // are already through.
      expect(json).toContain('"title":"Your access"');
    }
    const { buildSearchIndexJson } = await import("@/lib/search");
    const anonymous = buildSearchIndexJson(OWNER)!;
    expect(anonymous).toContain(`/${OWNER}/me`);
    expect(anonymous).toContain('"title":"Sign in"');
  });

  test("a capability that is off has no row at all — the helper here, for everybody including the owner", async () => {
    // This fixture's journal has no `helper`, so nobody's index may carry it.
    // The row's own gate — owner only — is covered in test/search-helper.test.ts,
    // where the capability is on.
    for (const viewer of ["owner", "buddy", "guest", "stranger"]) {
      expect(await jsonFor(viewer)).not.toContain(`/agent/${OWNER}`);
    }
    const { buildSearchIndexJson } = await import("@/lib/search");
    expect(buildSearchIndexJson(OWNER)!).not.toContain(`/agent/${OWNER}`);
  });

  test("a closed trip's own row reaches only a reader who may open it", async () => {
    expect(await jsonFor("owner")).toContain("trip:secret-2026");
    for (const viewer of ["guest", "stranger"]) {
      expect(await jsonFor(viewer)).not.toContain("trip:secret-2026");
    }
  });

  test("the documentation is in everybody's index, signed in or not", async () => {
    const { buildSearchIndexJson } = await import("@/lib/search");
    for (const json of [
      buildSearchIndexJson(OWNER)!,
      await jsonFor("stranger"),
      await jsonFor("owner"),
    ]) {
      expect(json).toContain("/docs/guide/guest");
      expect(json).toContain("/docs/api");
    }
  });
});

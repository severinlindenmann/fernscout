import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import type { Trip } from "@/lib/types";

/**
 * Who may see a trip's unpublished days — B327.
 *
 * The codebase held two answers and the narrower one was on the surface a
 * person reads. The API's answer has been *owner, or somebody on the trip*
 * since B296 — `GET .../days` reads with `includeDrafts: true` behind
 * `mayWriteTrip`. The site asked `isOwner(user)` at nine reading paths, so
 * somebody who had just written a day through an agent could not find it
 * anywhere: not on the trip page, not at its own URL, not in the gallery, not
 * on the map. Nothing errored, which is the worst shape for it to fail in.
 *
 * The table is over viewers and trips because the two failure directions are
 * opposite and both matter. Too narrow and a buddy cannot read their own
 * writing back — the bug. Too wide and somebody's unfinished words are on the
 * open web, which is worse and quieter.
 *
 * **The row that must never move is `stranger`.** Proving an address is free:
 * `/api/auth/request` mails a code to anybody who asks, because answering
 * otherwise would say who reads somebody's journal. So a signed-in stranger
 * must see exactly what an anonymous reader sees — nothing — and the same
 * holds for `guest`, who has been let in to *read the journal* and was never
 * on any trip. Being let in is not being there.
 */

const jar = vi.hoisted(() => ({ cookies: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.cookies[name] === undefined ? undefined : { value: jar.cookies[name] },
  }),
}));

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
/** Approved into the journal, and on no trip. */
const GUEST = "oma@example.test";
/** Named in one trip's `people:`, and not a contact at all. */
const ROBIN = "robin@example.test";
/** Signed in and nothing else. Anybody at all can be this. */
const STRANGER = "anyone@example.test";

/**
 * Two trips Robin is not on and one they are, so "sees drafts" cannot pass by
 * being true everywhere. `open-2026` is the sharp one: Robin may *read* it —
 * it is public — and must still not see its drafts, which is what makes the
 * rule per-trip rather than per-journal.
 */
const TRIPS = [
  { id: "open-2026", visibility: "public", people: [] as string[] },
  { id: "invited-2026", visibility: "guest", people: [] as string[] },
  { id: "robins-2026", visibility: "guest", people: [ROBIN] },
];

/** `draftsVisibleTo(trip).visible`, per viewer and trip. */
const EXPECTED: Record<string, Record<string, boolean>> = {
  // Not signed in. Nothing, anywhere, ever.
  anonymous: { "open-2026": false, "invited-2026": false, "robins-2026": false },
  // Signed in, and that is all — identical to `anonymous`, deliberately and
  // forever. Any diff that makes this row differ has put every unfinished day
  // on the instance within reach of anyone with an inbox.
  stranger: { "open-2026": false, "invited-2026": false, "robins-2026": false },
  // Let into the journal to read. Not on any trip, so no drafts: a grant is
  // about published days, and approving somebody is not putting them on a bus.
  guest: { "open-2026": false, "invited-2026": false, "robins-2026": false },
  // On one trip. Sees that trip's drafts and no others — including
  // `open-2026`, which they can read every published word of.
  traveller: { "open-2026": false, "invited-2026": false, "robins-2026": true },
  // Unchanged by this ticket.
  owner: { "open-2026": true, "invited-2026": true, "robins-2026": true },
};

let dir: string;
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

function writeTrip(spec: (typeof TRIPS)[number]) {
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
      ...(spec.people.length > 0
        ? ["people:", ...spec.people.map((e) => `  - { name: "Robin", email: "${e}" }`)]
        : []),
      "---",
      "",
      "Intro.",
      "",
    ].join("\n"),
  );
  // One published day and one draft, so a reader who may see drafts sees two
  // and everyone else sees one — a difference a count can catch.
  for (const [name, title, draft] of [
    ["2026-08-25-arrival.md", "Arrival", false],
    ["2026-08-26-unfinished.md", "Unfinished", true],
  ] as const) {
    fs.writeFileSync(
      path.join(root, "entries", name),
      [
        "---",
        `title: "${title}"`,
        `date: "${name.slice(0, 10)}"`,
        'location: "Bangkok"',
        'country: "Thailand"',
        ...(draft ? ["status: draft"] : []),
        "---",
        "",
        title,
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

/** Confirmed their address, and approved by the owner: a guest of the journal. */
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-drafts-audience-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.CONTACTS_ENCRYPTION_KEY = "44".repeat(32);
  process.env.SESSION_SECRET = "55".repeat(32);
  writeConfigs();
  for (const spec of TRIPS) writeTrip(spec);

  await addApprovedContact(GUEST);
  tokens.owner = await signIn(OWNER_EMAIL);
  tokens.guest = await signIn(GUEST);
  tokens.traveller = await signIn(ROBIN);
  tokens.stranger = await signIn(STRANGER);
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("who may see a trip's drafts", () => {
  for (const [viewer, byTrip] of Object.entries(EXPECTED)) {
    for (const [tripId, expected] of Object.entries(byTrip)) {
      test(`${viewer} on ${tripId}: ${expected}`, async () => {
        const { draftsVisibleTo } = await import("@/lib/tripGate");
        as(viewer);
        const trip = (await tripsByRef()).get(tripId);
        expect(trip).toBeDefined();
        expect((await draftsVisibleTo(trip!)).visible).toBe(expected);
      });
    }
  }

  /**
   * The other half of the answer, and the reason it travels beside `visible`
   * rather than being re-derived on the page: seeing a draft and being able to
   * put it on the site are different permissions, and they come apart for
   * exactly the person this ticket is about. Publishing is the owner's (B28).
   */
  test("and only the owner may publish one, including on their own trip", async () => {
    const { draftsVisibleTo } = await import("@/lib/tripGate");
    const trips = await tripsByRef();

    as("traveller");
    const robin = await draftsVisibleTo(trips.get("robins-2026")!);
    expect(robin).toEqual({ visible: true, canPublish: false });

    as("owner");
    expect(await draftsVisibleTo(trips.get("robins-2026")!)).toEqual({
      visible: true,
      canPublish: true,
    });
  });

  /**
   * The count is what the pages actually render, so it is worth asserting
   * once end to end rather than trusting that `visible` is threaded correctly
   * — this is the assertion that fails on `main`.
   */
  test("a traveller reading their trip gets the draft day, and a guest does not", async () => {
    const { getDays } = await import("@/lib/entries");
    const { draftsVisibleTo } = await import("@/lib/tripGate");
    const trip = (await tripsByRef()).get("robins-2026")!;

    as("traveller");
    const forRobin = getDays(trip.ref, { includeDrafts: (await draftsVisibleTo(trip)).visible });
    expect(forRobin).toHaveLength(2);

    as("guest");
    const forGuest = getDays(trip.ref, { includeDrafts: (await draftsVisibleTo(trip)).visible });
    expect(forGuest).toHaveLength(1);
  });
});

/**
 * The structural half, in the spirit of `test/trip-gate.test.ts`: the failure
 * this guards against is somebody adding a page next year and reaching for
 * `isOwner` because that is what the neighbouring pages used to do. Grepping
 * is blunt, and it is the instrument that catches the thing that happens.
 */
describe("no page under the trip gate decides drafts for itself", () => {
  const dirs = ["app/[user]/(trip)", "app/[user]/trips/[trip]"];

  function pagesUnder(d: string): string[] {
    const root = path.join(process.cwd(), d);
    const out: string[] = [];
    const walk = (at: string) => {
      for (const e of fs.readdirSync(at, { withFileTypes: true })) {
        const full = path.join(at, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name === "page.tsx") out.push(full);
      }
    };
    walk(root);
    return out;
  }

  const pages = dirs.flatMap(pagesUnder);

  test("there are pages to check", () => {
    expect(pages.length).toBeGreaterThanOrEqual(10);
  });

  test.each(pages.map((p) => [path.relative(process.cwd(), p), p]))(
    "%s never gates includeDrafts on isOwner",
    (_label, file) => {
      const src = fs.readFileSync(file, "utf8");
      expect(src).not.toMatch(/includeDrafts:\s*(await\s+)?isOwner/);
      expect(src).not.toMatch(/includeDrafts:\s*owner\b/);
    },
  );
});

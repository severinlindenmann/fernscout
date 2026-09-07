import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import type { Trip } from "@/lib/types";

/**
 * B363 — `mayMailTrip`/`mayMailCosts` (`lib/digest/dayLetter.ts`) are a second,
 * hand-restated copy of `mayReadTrip`/`mayViewCosts` (`lib/tripGate.ts`), and
 * nothing before this test compared them. `test/day-mail.test.ts` pins what
 * the mail gate itself produces; it never asks whether that agrees with what
 * the site would show the same person, so a change to `mayReadTrip` could
 * leave the letter behind with a green suite everywhere else.
 *
 * This drives both gates for the same trip and the same viewer — a traveller,
 * an approved journal guest, and a signed-in stranger, over every
 * `{visibility, costsVisibility}` combination — and asserts they agree. The
 * owner is deliberately not a row here: `recipientsFor` in `dayLetter.ts`
 * never calls `mayMailTrip`/`mayMailCosts` for the owner's own copy (it is
 * always included, free, upstream of both), the same way `mayReadTrip`'s
 * `isOwner` branch has no counterpart in `mayMailTrip`'s signature. Comparing
 * that row would fail for a reason that says nothing about drift.
 *
 * Harness copied from `test/draft-audience.test.ts` rather than invented, per
 * AGENTS.md's B346/B363 note.
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
/** Named in every trip's `people:`. */
const ROBIN = "robin@example.test";
/** Signed in and nothing else. */
const STRANGER = "anyone@example.test";

const VISIBILITIES = ["public", "guest", "private"] as const;
const COSTS_VISIBILITIES = ["public", "guests"] as const;

const TRIPS = VISIBILITIES.flatMap((visibility) =>
  COSTS_VISIBILITIES.map((costsVisibility) => ({
    id: `${visibility}-${costsVisibility}`,
    visibility,
    costsVisibility,
  })),
);

let dir: string;
const tokens: Record<string, string> = {};

function writeConfigs() {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: { auth: { enabled: true }, contacts: { enabled: true }, costs: { enabled: true } },
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
      features: { auth: { enabled: true }, contacts: { enabled: true }, costs: { enabled: true } },
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
      `costsVisibility: "${spec.costsVisibility}"`,
      "people:",
      `  - { name: "Robin", email: "${ROBIN}" }`,
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
  jar.cookies = { fs_session: tokens[viewer] };
}

async function tripsByRef(): Promise<Map<string, Trip>> {
  const { getTrips } = await import("@/lib/trips");
  return new Map(getTrips(OWNER).map((t) => [t.id, t]));
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-day-mail-parity-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.CONTACTS_ENCRYPTION_KEY = "44".repeat(32);
  process.env.SESSION_SECRET = "55".repeat(32);
  writeConfigs();
  for (const spec of TRIPS) writeTrip(spec);

  await addApprovedContact(GUEST);
  tokens.guest = await signIn(GUEST);
  tokens.traveller = await signIn(ROBIN);
  tokens.stranger = await signIn(STRANGER);
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the letter's gate agrees with the site's, for every viewer but the owner", () => {
  for (const viewer of ["guest", "traveller", "stranger"] as const) {
    for (const spec of TRIPS) {
      test(`${viewer} on ${spec.id}`, async () => {
        const { mayReadTrip, mayViewCosts, isTravellerOn } = await import("@/lib/tripGate");
        const { isJournalGuest } = await import("@/lib/contacts/session");
        const { mayMailTrip, mayMailCosts } = await import("@/lib/digest/dayLetter");

        as(viewer);
        const trip = (await tripsByRef()).get(spec.id);
        expect(trip).toBeDefined();

        const isTraveller = await isTravellerOn(trip!);
        const granted = await isJournalGuest(trip!.username);

        expect(mayMailTrip(trip!, isTraveller, granted)).toBe(await mayReadTrip(trip!));
        expect(mayMailCosts(trip!, isTraveller, granted)).toBe(await mayViewCosts(trip!));
      });
    }
  }
});

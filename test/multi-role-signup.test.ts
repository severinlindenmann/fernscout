import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { writeTripFixture } from "./fixtures/content";

/**
 * B1498 — one address holding three roles at once: a guest and a buddy on
 * somebody else's journal, and the owner of a brand-new journal of their own.
 *
 * `fs_identity` is bound to an address and to no journal, and every gate
 * re-derives access per journal per request (`resolveAccess`,
 * `journalReader`, `isOwner`) — so the design says this should already work
 * with no new grant kind and no cross-journal permission. This is the
 * end-to-end check the ticket asked for: approve the same address as a guest
 * and as a buddy on one journal, then run it through the real signup route
 * (POST /api/auth/codes(/redeem) → POST /api/v2/journals) for a second
 * journal, and confirm nothing along the way drops the first journal's
 * access or needs a second grant to see it.
 */

const jar: { cookies: Record<string, string> } = { cookies: {} };
const written: Record<string, string> = {};

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.cookies[name] === undefined ? undefined : { value: jar.cookies[name] },
    set: (name: string, value: string) => {
      written[name] = value;
      jar.cookies[name] = value;
    },
  }),
}));

const FRIEND = "ana";
const FRIEND_EMAIL = "ana@example.test";
const READER = "viktoria@example.test";

let dir: string;
let ipCounter = 0;
function ip(): string {
  ipCounter += 1;
  return `198.51.100.${ipCounter % 250}`;
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-multi-role-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.CONTACTS_ENCRYPTION_KEY = "44".repeat(32);
  process.env.SESSION_SECRET = "b1498-test-secret-b1498-secret!!";
  jar.cookies = {};
  for (const key of Object.keys(written)) delete written[key];

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test" },
      users: { reserved: [] },
      features: { signup: { enabled: true }, auth: { enabled: true }, contacts: { enabled: true } },
    }),
  );

  fs.mkdirSync(path.join(dir, FRIEND), { recursive: true });
  fs.writeFileSync(
    path.join(dir, FRIEND, "config.json"),
    JSON.stringify({
      title: "Ana's journal",
      tagline: "A tagline.",
      owner: { name: "Ana", nickname: "Ana", email: FRIEND_EMAIL },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      visibility: "guest",
      features: { auth: { enabled: true }, contacts: { enabled: true } },
    }),
  );
  writeTripFixture(FRIEND, {
    id: "welcome-2026",
    title: "welcome-2026",
    start: "2026-01-01",
    end: "2026-01-02",
    status: "past",
    visibility: "guest",
    listed: false,
    intro: "Intro.",
  });
  writeTripFixture(FRIEND, {
    id: "algarve-2026",
    title: "algarve-2026",
    start: "2026-02-01",
    end: "2026-02-05",
    status: "past",
    visibility: "private",
    listed: false,
    intro: "Intro.",
  });
  // A second private trip nobody invites her onto — the negative half of the
  // claim: holding a guest grant and a buddy place on ONE trip must never
  // widen into every closed trip in the journal.
  writeTripFixture(FRIEND, {
    id: "secret-2026",
    title: "secret-2026",
    start: "2026-03-01",
    end: "2026-03-02",
    status: "past",
    visibility: "private",
    listed: false,
    intro: "Intro.",
  });

  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  clearConfigCache();
  clearUserCache();

  const { getDatabase } = await import("@/lib/db");
  const { migrateToLatest } = await import("@/lib/db/migrate");
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.CONTACTS_ENCRYPTION_KEY;
  delete process.env.SESSION_SECRET;
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a guest-and-buddy address keeps both, once approved, after signing up for its own journal", async () => {
  const { requestContact, confirmContact, approveContact, listContacts } = await import(
    "@/lib/contacts"
  );
  const { createInvite } = await import("@/lib/contacts/invites");
  const { claimTripPlace } = await import("@/lib/tripPeople");
  const { issueCode, resolveSession } = await import("@/lib/auth");
  const { issueIdentityCookie } = await import("@/lib/auth/identityCookie");

  // She asks in as a guest of ana's journal, and confirms her address —
  // exactly what `requestContact` + `confirmContact` do for a redeemed guest
  // link, minus the HTTP plumbing this test does not need.
  const guestRequest = await requestContact(FRIEND, {
    name: "Vika",
    email: READER,
    locale: "en",
    address: null,
    wantsEmailDigest: false,
    wantsPostcard: false,
    createdVia: "open",
  });
  expect(guestRequest.outcome).not.toBe("ignored");
  const { code } = await issueCode(FRIEND, READER, "guest");
  const confirmed = await confirmContact(FRIEND, READER, code);
  expect(confirmed.ok).toBe(true);

  // She also asks to join the private trip, through a real buddy invite —
  // the same `claimTripPlace` a redeemed buddy link calls.
  const buddyInvite = await createInvite(FRIEND, { kind: "buddy", tripId: "algarve-2026" });
  await claimTripPlace(FRIEND, "algarve-2026", guestRequest.contactId as string, buddyInvite.id);

  // One approval opens both: the journal-wide read grant, and every trip
  // place claimed by this contact (`approveTripPlaces`, called inside
  // `approveContact`) — never a second grant-writer, per `approveContact`'s
  // own contract as the only thing that creates a grant.
  const contact = (await listContacts(FRIEND)).find((c) => c.email === READER)!;
  const approval = await approveContact(FRIEND, contact.id);
  expect(approval?.tripsOpened).toEqual(["algarve-2026"]);

  // She proves her address once more, for an *identity* rather than a
  // journal session — the credential `/agent`'s signup flow and every
  // ordinary journal sign-in mints alongside the journal cookie (B410).
  await issueIdentityCookie(READER);

  const { journalsFor } = await import("@/lib/home");
  const before = await journalsFor(READER);
  expect(before.map((j) => j.username)).toEqual([FRIEND]);
  expect(before[0].trips.map((t) => t.id).sort()).toEqual(["algarve-2026", "welcome-2026"]);

  // Now she signs up for her own journal, through the real routes: a signup
  // token from the code flow, then POST /api/v2/journals. Nothing here
  // touches `fs_identity` — a signup token is a bearer credential, never a
  // cookie — which is the property under test: the identity that already
  // proves her address for ana's journal must still prove it for her own.
  const { code: signupCode } = await issueCode("*", READER, "signup");
  const { POST: redeemCode } = await import("@/app/api/auth/codes/redeem/route");
  const redeemResponse = await redeemCode(
    new Request("https://example.test/api/auth/codes/redeem", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip() },
      body: JSON.stringify({ for: "signup", email: READER, code: signupCode }),
    }),
  );
  expect(redeemResponse.status).toBe(200);
  const { token: signupToken } = (await redeemResponse.json()) as { token: string };

  const { POST: createJournalRoute } = await import("@/app/api/v2/journals/route");
  const createResponse = await createJournalRoute(
    new Request("https://example.test/api/v2/journals", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${signupToken}`,
        "x-forwarded-for": ip(),
      },
      body: JSON.stringify({
        // "test-" exempts a signup from the phone-proof step (B1222), which is
        // its own, unrelated flow — this ticket is about identity and roles
        // surviving signup, not about proving a phone number.
        username: "test-vika-travels",
        title: "Vika's journal",
        ownerName: "Viktoria",
        ownerNickname: "Vika",
        visibility: "public",
        defaultLocale: "en",
        locales: ["en"],
        baseCurrency: "CHF",
      }),
    }),
  );
  expect(createResponse.status).toBe(201);

  // The identity cookie in the jar is untouched by any of the above — no
  // route in the signup path calls `set` on it, so the same token from
  // `issueIdentityCookie` above is still resolvable.
  expect(await resolveSession(jar.cookies.fs_identity, "identity")).toMatchObject({
    email: READER,
  });

  // The claim under test: both journals, at once, from one address — the
  // guest/traveller grant on ana's journal untouched by having just become
  // an owner elsewhere.
  // `journalsFor`'s ordinary call drops a journal with nothing in it yet —
  // B1019, deliberate: it answers "what can I read", and a journal made a
  // moment ago has nothing to read. `evenIfEmpty` is the question `/agent`
  // asks instead ("whose journals are these"), and is the one that matters
  // right after signing up.
  const after = await journalsFor(READER, { evenIfEmpty: true });
  expect(after.map((j) => [j.username, j.role]).sort()).toEqual([
    [FRIEND, "traveller"],
    ["test-vika-travels", "owner"],
  ]);
  const friendEntry = after.find((j) => j.username === FRIEND)!;
  expect(friendEntry.trips.map((t) => t.id).sort()).toEqual(["algarve-2026", "welcome-2026"]);

  // And `isOwner` on her own, new journal answers from the identity alone —
  // no journal session for it was ever minted in this test.
  const { isOwner } = await import("@/lib/contacts/session");
  expect(await isOwner("test-vika-travels")).toBe(true);
});

/**
 * The other order the ticket asks for — sign up first, take the invites
 * after. Nothing above reads in a direction that would make this different,
 * but the ticket's own acceptance is "both setup orders", so it is checked
 * rather than assumed.
 */
test("an existing owner is still recognised as a guest and buddy after taking both invites", async () => {
  const { requestContact, confirmContact, approveContact, listContacts } = await import(
    "@/lib/contacts"
  );
  const { createInvite } = await import("@/lib/contacts/invites");
  const { claimTripPlace } = await import("@/lib/tripPeople");
  const { issueCode } = await import("@/lib/auth");
  const { issueIdentityCookie } = await import("@/lib/auth/identityCookie");

  // She already owns a journal of her own — created directly, since the
  // signup route itself is exercised by the other test in this file.
  const { createJournal } = await import("@/lib/journals");
  const created = createJournal({
    visibility: "public",
    username: "test-vika-first",
    title: "Vika's journal",
    ownerName: "Viktoria",
    ownerNickname: "Vika",
    ownerEmail: READER,
    defaultLocale: "en",
    locales: ["en"],
    baseCurrency: "CHF",
  });
  expect(created.ok).toBe(true);

  // Now she takes both links on ana's journal, exactly as the first test did.
  const guestRequest = await requestContact(FRIEND, {
    name: "Vika",
    email: READER,
    locale: "en",
    address: null,
    wantsEmailDigest: false,
    wantsPostcard: false,
    createdVia: "open",
  });
  expect(guestRequest.outcome).not.toBe("ignored");
  const { code } = await issueCode(FRIEND, READER, "guest");
  expect((await confirmContact(FRIEND, READER, code)).ok).toBe(true);

  const buddyInvite = await createInvite(FRIEND, { kind: "buddy", tripId: "algarve-2026" });
  await claimTripPlace(FRIEND, "algarve-2026", guestRequest.contactId as string, buddyInvite.id);

  const contact = (await listContacts(FRIEND)).find((c) => c.email === READER)!;
  const approval = await approveContact(FRIEND, contact.id);
  expect(approval?.tripsOpened).toEqual(["algarve-2026"]);

  await issueIdentityCookie(READER);

  const { journalsFor } = await import("@/lib/home");
  const after = await journalsFor(READER, { evenIfEmpty: true });
  expect(after.map((j) => [j.username, j.role]).sort()).toEqual([
    [FRIEND, "traveller"],
    ["test-vika-first", "owner"],
  ]);
  const friendEntry = after.find((j) => j.username === FRIEND)!;
  expect(friendEntry.trips.map((t) => t.id).sort()).toEqual(["algarve-2026", "welcome-2026"]);

  const { isOwner } = await import("@/lib/contacts/session");
  expect(await isOwner("test-vika-first")).toBe(true);
});

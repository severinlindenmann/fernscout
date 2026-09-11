import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * B1301 — an already-`active` reader's buddy link must still ask the owner.
 *
 * `preapprovedEmailFor` used to be driven by `contact.createdVia`, which is
 * stamped once, on insert, and never rewritten by `requestContact`'s update
 * branch (see that function's own comment, and `/api/contacts/self`'s). So a
 * reader who was already vouched for on one invite — a guest link the owner
 * mailed to her address, the ordinary B319 case — carried that same
 * `createdVia` into a *second*, unrelated buddy link, and the buddy
 * redemption read the first invite's email match as consent for the second.
 * `approveContact` ran, and a buddy link that was never mailed to her, for a
 * trip nobody asked her onto, opened on the spot.
 *
 * The fix is a status gate in `preapprovedEmailFor` itself, the one function
 * every caller of it routes through: an already-`active` contact is never
 * pre-approved again, whatever `createdVia` says. This asserts the escalation
 * is closed (the trip stays a request, `granted_at: null`) and that it is
 * visible rather than silently swallowed — the owner's own page picks it up
 * via `pendingTripRequestsFor`. `status` staying "active" throughout is
 * correct and expected (that field is a fact about the *journal*, not about
 * any one trip — see `test/invite-links.test.ts`'s "signed in here, a
 * redemption is one confirmation and no form at all"); what closes the
 * escalation is that nothing granted the trip alongside it.
 *
 * Driven through `/api/contacts/redeem` and `/api/contacts/confirm` — the
 * mailed-code path, which needs no session cookie to exercise — because that
 * is the second call site the same stale-`createdVia` bug reached, beside the
 * signed-in branch of `/api/contacts/redeem` B1301 was originally reported
 * against.
 */

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {} }),
}));

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
const GUEST_TRIP_ID = "guest-trip-2026";
const BUDDY_TRIP_ID = "buddy-trip-2026";
const BUDDY_TRIP_TITLE = "A Second, Unrelated Trip";
const BEA_EMAIL = "bea-escalation@example.test";

let dir: string;
let calls = 0;
function headers(): Record<string, string> {
  calls += 1;
  return { "content-type": "application/json", "x-forwarded-for": `10.9.1.${calls % 250}` };
}

async function ownerToken(): Promise<string> {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, OWNER_EMAIL, "agent");
  const result = await verifyCode(OWNER, OWNER_EMAIL, code, "agent");
  if (!result.ok) throw new Error("no owner token");
  return result.token;
}

async function createLink(
  token: string,
  body: Record<string, unknown>,
): Promise<{ token: string; id: string }> {
  const { POST } = await import("@/app/api/v1/[user]/invites/route");
  const response = await POST(
    new Request("https://example.test/api/v1/ana/invites", {
      method: "POST",
      headers: { ...headers(), authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user: OWNER }) },
  );
  const parsed = (await response.json()) as { invite?: { id?: string; url?: string } };
  const url = parsed.invite!.url!;
  return { token: url.slice(url.lastIndexOf("/") + 1), id: parsed.invite!.id! };
}

async function redeem(kind: "guest" | "buddy", token: string, email: string): Promise<string> {
  const { POST } = await import("@/app/api/contacts/redeem/route");
  const response = await POST(
    new Request("https://example.test/api/contacts/redeem", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ user: OWNER, token, kind, name: "Bea", email }),
    }),
  );
  const body = (await response.json()) as { status?: string };
  if (body.status !== "code") throw new Error(`redeem did not reach a code: ${JSON.stringify(body)}`);
  return body.status;
}

async function confirm(email: string): Promise<{ status?: string }> {
  const { issueCode } = await import("@/lib/auth");
  const { POST } = await import("@/app/api/contacts/confirm/route");
  const { code } = await issueCode(OWNER, email, "guest");
  const response = await POST(
    new Request("https://example.test/api/contacts/confirm", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ user: OWNER, email, code }),
    }),
  );
  const body = (await response.json()) as { ok?: boolean; status?: string };
  if (!body.ok) throw new Error(`confirm failed for ${email}: ${JSON.stringify(body)}`);
  return body;
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-buddy-escalation-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.CONTACTS_ENCRYPTION_KEY = "66".repeat(32);
  process.env.SESSION_SECRET = "77".repeat(32);
  delete process.env.AUTH_DEV_CODE;

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: { auth: { enabled: true }, contacts: { enabled: true }, mail: { enabled: true, transport: "file" } },
    }),
  );
  for (const tripId of [GUEST_TRIP_ID, BUDDY_TRIP_ID]) {
    fs.mkdirSync(path.join(dir, OWNER, "trips", tripId, "entries"), { recursive: true });
  }
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Two Backpacks",
      tagline: "t",
      owner: { name: "Ana B", nickname: "Ana", email: OWNER_EMAIL },
      startLocation: "X",
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features: { auth: { enabled: true }, contacts: { enabled: true } },
    }),
  );
  fs.writeFileSync(
    path.join(dir, OWNER, "trips", GUEST_TRIP_ID, "trip.md"),
    [
      "---",
      `id: "${GUEST_TRIP_ID}"`,
      'title: "A Guest Trip"',
      'start: "2026-08-01"',
      'end: "2026-08-02"',
      'status: "past"',
      'visibility: "guest"',
      "---",
      "",
      "Intro.",
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(dir, OWNER, "trips", BUDDY_TRIP_ID, "trip.md"),
    [
      "---",
      `id: "${BUDDY_TRIP_ID}"`,
      `title: "${BUDDY_TRIP_TITLE}"`,
      'start: "2026-09-01"',
      'end: "2026-09-02"',
      'status: "past"',
      'visibility: "private"',
      "---",
      "",
      "Intro.",
      "",
    ].join("\n"),
  );

  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  clearConfigCache();
  clearUserCache();

  const { migrateToLatest } = await import("@/lib/db/migrate");
  const { getDatabase } = await import("@/lib/db");
  await migrateToLatest(await getDatabase());
});

afterAll(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  for (const key of [
    "CONTENT_DIR",
    "DATA_DIR",
    "DATABASE_URL",
    "CONTACTS_ENCRYPTION_KEY",
    "SESSION_SECRET",
    "AUTH_DEV_CODE",
  ]) {
    delete process.env[key];
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test("an already-active guest's later buddy link stays a request, not a grant", async () => {
  const token = await ownerToken();

  // The ordinary B319 case first: the owner types Bea's address into a guest
  // invite, she redeems it, and her first confirmation is rightly
  // pre-approved — this must still work after the fix.
  const guestInvite = await createLink(token, { kind: "guest", email: BEA_EMAIL });
  await redeem("guest", guestInvite.token, BEA_EMAIL);
  const firstConfirm = await confirm(BEA_EMAIL);
  expect(firstConfirm.status).toBe("active");

  const { getContactByEmail } = await import("@/lib/contacts");
  const contact = await getContactByEmail(OWNER, BEA_EMAIL);
  expect(contact?.status).toBe("active");
  expect(contact?.createdVia).toBe(`invite:${guestInvite.id}`);

  // Now a second, unrelated buddy link — never mailed to her, naming a
  // different trip entirely. Her `createdVia` still points at the guest
  // invite above (unchanged, by design — see `requestContact`), so the
  // unfixed code read that invite's own `email_key` match as consent for
  // this one too.
  const buddyInvite = await createLink(token, { kind: "buddy", trip: BUDDY_TRIP_ID });
  await redeem("buddy", buddyInvite.token, BEA_EMAIL);
  const secondConfirm = await confirm(BEA_EMAIL);

  // The escalation, closed: she is still an active guest (nothing about her
  // journal access changed, which is honestly what "active" reports), but the
  // trip itself was never silently granted — checked below on the row
  // itself and on the owner's own queue, which is where B1301 said the
  // decision belongs.
  expect(secondConfirm.status).toBe("active");

  const { getDatabase } = await import("@/lib/db");
  const { db } = await getDatabase();
  const row = await db
    .selectFrom("trip_people")
    .select(["granted_at"])
    .where("owner_id", "=", OWNER)
    .where("trip_id", "=", BUDDY_TRIP_ID)
    .where("contact_id", "=", contact!.id)
    .executeTakeFirst();
  expect(row).toBeDefined();
  expect(row?.granted_at).toBeNull();

  // Visible to the owner, not merely inert in the database — B1301's second
  // symptom, "the owner's queue stays empty", closed by
  // `pendingTripRequestsFor`, which is what the contacts page reads.
  const { pendingTripRequestsFor } = await import("@/lib/tripPeople");
  const pending = await pendingTripRequestsFor(OWNER);
  expect(pending.get(contact!.id)).toEqual([BUDDY_TRIP_ID]);

  // And the owner's own approve click still opens it — the mechanism that was
  // never broken, only reached without permission.
  const { POST: adminPost } = await import("@/app/api/contacts/admin/route");
  const approveResponse = await adminPost(
    new Request("https://example.test/api/contacts/admin", {
      method: "POST",
      headers: { ...headers(), authorization: `Bearer ${token}` },
      body: JSON.stringify({ user: OWNER, action: "approve", id: contact!.id }),
    }),
  );
  const approveBody = (await approveResponse.json()) as { ok?: boolean; tripsOpened?: string[] };
  expect(approveBody.ok).toBe(true);
  expect(approveBody.tripsOpened).toContain(BUDDY_TRIP_TITLE);

  const opened = await db
    .selectFrom("trip_people")
    .select(["granted_at"])
    .where("owner_id", "=", OWNER)
    .where("trip_id", "=", BUDDY_TRIP_ID)
    .where("contact_id", "=", contact!.id)
    .executeTakeFirst();
  expect(opened?.granted_at).not.toBeNull();

  const stillPending = await pendingTripRequestsFor(OWNER);
  expect(stillPending.get(contact!.id) ?? []).not.toContain(BUDDY_TRIP_ID);
});

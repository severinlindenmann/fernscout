import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

/**
 * The two links an owner can hand somebody — B33.
 *
 * Before this a journal could be shared exactly two ways: a shared password,
 * which everybody who ever received it holds forever and which can only be
 * revoked by cutting off everyone at once, or a person opening `trip.md` in an
 * editor. Neither is something you can send.
 *
 * The property every assertion here circles is the one that makes a link safe
 * to forward: **holding a link is not access.** Redeeming one writes a
 * `pending` contact and nothing else, and `approveContact` — the owner, by
 * hand — is still the only thing in the codebase that creates a grant. So a
 * redeemed but unapproved guest is asserted, directly, to read exactly what an
 * anonymous visitor reads: the same assertion `test/access-gate.test.ts` makes
 * about a signed-in stranger, made again about the person this feature is for.
 */

/** Every cookie the mocked `next/headers` hands back. */
const jar = vi.hoisted(() => ({ cookies: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.cookies[name] === undefined ? undefined : { value: jar.cookies[name] },
  }),
}));

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
/** Somebody who already has a journal of their own on this instance. */
const NEIGHBOUR = "blake";
const NEIGHBOUR_EMAIL = "blake@example.test";

let dir: string;
/** One IP per call: `lib/rateLimit.ts` is a module-level map shared by the
 * whole file, so a shared address would make the ninth call fail for a reason
 * that has nothing to do with what is being tested. */
let calls = 0;
function headers(extra: Record<string, string> = {}): Record<string, string> {
  calls += 1;
  return { "content-type": "application/json", "x-forwarded-for": `10.0.0.${calls % 250}`, ...extra };
}

function writeJournal(username: string, email: string) {
  fs.mkdirSync(path.join(dir, username, "trips"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, username, "config.json"),
    JSON.stringify({
      title: username === OWNER ? "Two Backpacks" : "Blake's Book",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email },
      startLocation: "X",
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features: { auth: { enabled: true }, contacts: { enabled: true } },
    }),
  );
}

function writeTrip(username: string, id: string, visibility: string) {
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
      "---",
      "",
      "Intro.",
      "",
    ].join("\n"),
  );
}

/** An agent bearer token for the journal's owner. */
async function ownerToken(): Promise<string> {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, OWNER_EMAIL, "agent");
  const result = await verifyCode(OWNER, OWNER_EMAIL, code, "agent");
  if (!result.ok) throw new Error("no owner token");
  return result.token;
}

/** A browser session for one journal, as `/api/auth/verify` would set it. */
async function signIn(username: string, email: string): Promise<string> {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(username, email, "guest");
  const result = await verifyCode(username, email, code, "guest");
  if (!result.ok) throw new Error(`sign-in failed for ${email}`);
  return result.token;
}

function as(token: string | null) {
  jar.cookies = {};
  if (token) jar.cookies.fs_session = token;
}

type InviteBody = {
  ok?: boolean;
  invite?: {
    id: string;
    kind: string;
    scope: string;
    trip: string | null;
    url?: string;
    expiresAt: string | null;
  };
  error?: string;
};

async function createLink(
  token: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: InviteBody }> {
  const { POST } = await import("@/app/api/v1/[user]/invites/route");
  const response = await POST(
    new Request("https://example.test/api/v1/ana/invites", {
      method: "POST",
      headers: headers({ authorization: `Bearer ${token}` }),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user: OWNER }) },
  );
  return { status: response.status, body: (await response.json()) as InviteBody };
}

async function redeem(
  body: Record<string, unknown>,
): Promise<{ status: number; body: { status?: string; error?: string } }> {
  const { POST } = await import("@/app/api/contacts/redeem/route");
  const response = await POST(
    new Request("https://example.test/api/contacts/redeem", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ user: OWNER, ...body }),
    }),
  );
  return { status: response.status, body: (await response.json()) as { status?: string } };
}

/** The six digits, then the owner. Exactly the two steps a person takes. */
async function confirm(email: string) {
  const { issueCode } = await import("@/lib/auth");
  const { confirmContact } = await import("@/lib/contacts");
  const { code } = await issueCode(OWNER, email, "guest");
  const result = await confirmContact(OWNER, email, code);
  if (!result.ok) throw new Error(`confirm failed for ${email}`);
}

async function contactFor(email: string) {
  const { getContactByEmail } = await import("@/lib/contacts");
  return getContactByEmail(OWNER, email);
}

async function approve(email: string) {
  const { approveContact } = await import("@/lib/contacts");
  const contact = await contactFor(email);
  if (!contact) throw new Error(`no contact for ${email}`);
  const done = await approveContact(OWNER, contact.id);
  if (!done || done.status !== "active") throw new Error(`approval failed for ${email}`);
}

async function tripsByRef() {
  const { getTrips } = await import("@/lib/trips");
  return new Map((await getTrips(OWNER)).map((t) => [t.id, t]));
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-invites-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.CONTACTS_ENCRYPTION_KEY = "66".repeat(32);
  process.env.SESSION_SECRET = "77".repeat(32);
  delete process.env.AUTH_DEV_CODE;

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: {
        auth: { enabled: true },
        contacts: { enabled: true },
        // Invitations, codes and approvals are things this instance says to
        // people by mail, so a fixture that had none was describing a server
        // where none of it works. It went unnoticed while every mail call
        // returned null quietly; since B160 `/api/auth/request` refuses up
        // front rather than issuing a code nobody can be told, and the
        // buddy-token test below asked for one. The file transport needs no
        // credentials and writes into this test's own temp directory.
        mail: { enabled: true, transport: "file" },
      },
    }),
  );
  writeJournal(OWNER, OWNER_EMAIL);
  writeJournal(NEIGHBOUR, NEIGHBOUR_EMAIL);
  // Written before anything reads them: `lib/trips.ts` memoises per content
  // root, so a trip created after the first read is invisible.
  writeTrip(OWNER, "open-2026", "public");
  writeTrip(OWNER, "invited-2026", "guest");
  writeTrip(OWNER, "bus-2026", "private");
  writeTrip(OWNER, "secret-2026", "private");

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
    "DATABASE_URL",
    "CONTACTS_ENCRYPTION_KEY",
    "SESSION_SECRET",
    "AUTH_DEV_CODE",
  ]) {
    delete process.env[key];
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("issuing a link", () => {
  test("a guest link and a buddy link, each naming what it opens", async () => {
    as(null);
    const token = await ownerToken();

    const guest = await createLink(token, { kind: "guest" });
    expect(guest.status).toBe(201);
    expect(guest.body.invite?.kind).toBe("guest");
    // Journal-wide. A guest is a guest of the journal and never of one trip.
    expect(guest.body.invite?.scope).toBe(OWNER);
    expect(guest.body.invite?.trip).toBeNull();
    expect(guest.body.invite?.url).toMatch(/\/ana\/invite\/guest\/fs_inv_/);

    const buddy = await createLink(token, { kind: "buddy", trip: "bus-2026" });
    expect(buddy.status).toBe(201);
    expect(buddy.body.invite?.kind).toBe("buddy");
    // A trip ref, never a bare id: ids are unique within a user, not across
    // the instance.
    expect(buddy.body.invite?.scope).toBe("ana/bus-2026");
    expect(buddy.body.invite?.url).toMatch(/\/ana\/invite\/buddy\/fs_inv_/);

    // Both dated. A link that never expires is the shared password again,
    // wearing a URL.
    expect(guest.body.invite?.expiresAt).toBeTruthy();
    expect(buddy.body.invite?.expiresAt).toBeTruthy();
  });

  test("the token is in the answer once, and in the database only as a hash", async () => {
    as(null);
    const token = await ownerToken();
    const created = await createLink(token, { kind: "guest" });
    const url = created.body.invite?.url ?? "";
    const secret = url.slice(url.lastIndexOf("/") + 1);
    expect(secret).toMatch(/^fs_inv_/);

    const { getDatabase } = await import("@/lib/db");
    const { hashSecret } = await import("@/lib/auth");
    const { db } = await getDatabase();
    const row = await db
      .selectFrom("contact_invites")
      .selectAll()
      .where("id", "=", created.body.invite!.id)
      .executeTakeFirstOrThrow();
    expect(row.token_hash).toBe(hashSecret(secret));
    // Nowhere else in the row, under any column.
    expect(JSON.stringify(row)).not.toContain(secret);

    // And never again from the listing: only the hash was stored, so a link
    // that is lost is reissued rather than looked up.
    const { GET } = await import("@/app/api/v1/[user]/invites/route");
    const listed = await GET(
      new Request("https://example.test/api/v1/ana/invites", {
        headers: headers({ authorization: `Bearer ${token}` }),
      }),
      { params: Promise.resolve({ user: OWNER }) },
    );
    const body = (await listed.json()) as { invites: { url?: string }[] };
    expect(JSON.stringify(body)).not.toContain(secret);
    expect(body.invites.every((invite) => invite.url === undefined)).toBe(true);
  });

  test("only the owner may issue one", async () => {
    as(null);
    // A trip-scoped token — somebody who came on one trip. They may write days
    // into it; handing out invitations to it is not the same authority.
    const { issueCode, verifyCode } = await import("@/lib/auth");
    const { tripWriteScope } = await import("@/lib/tripPeople");
    const { code } = await issueCode(OWNER, OWNER_EMAIL, "agent");
    const scoped = await verifyCode(
      OWNER,
      OWNER_EMAIL,
      code,
      "agent",
      tripWriteScope("bus-2026"),
    );
    if (!scoped.ok) throw new Error("no scoped token");

    // `isOwner` asks who holds the token, not how wide it is, so this one is
    // still the owner's address and still passes — the refusal that matters is
    // for somebody who is not the owner at all.
    const stranger = await signIn(OWNER, "nobody@example.test");
    as(stranger);
    const { POST } = await import("@/app/api/v1/[user]/invites/route");
    const refused = await POST(
      new Request("https://example.test/api/v1/ana/invites", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ kind: "guest" }),
      }),
      { params: Promise.resolve({ user: OWNER }) },
    );
    expect(refused.status).toBe(403);
    as(null);
  });

  /**
   * B79 — the arm the copy-a-link control on `/{user}/me` stands on.
   *
   * That panel is a page the owner is *reading in a browser*, so its request
   * carries the session cookie and no `Authorization` header at all. `isOwner`
   * accepts either credential on purpose (decision 24 gives the owner both),
   * and this asserts the cookie arm with the header genuinely absent rather
   * than merely unused — drop it and the panel's two buttons both answer 403.
   */
  test("the owner's own browser, cookie only and no bearer, may issue both", async () => {
    as(await signIn(OWNER, OWNER_EMAIL));
    const { POST } = await import("@/app/api/v1/[user]/invites/route");

    async function fromTheBrowser(body: Record<string, unknown>) {
      const sent = headers();
      expect(sent).not.toHaveProperty("authorization");
      const response = await POST(
        new Request("https://example.test/api/v1/ana/invites", {
          method: "POST",
          headers: sent,
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ user: OWNER }) },
      );
      return { status: response.status, body: (await response.json()) as InviteBody };
    }

    const guest = await fromTheBrowser({ kind: "guest" });
    expect(guest.status).toBe(201);
    expect(guest.body.invite?.url).toMatch(/\/ana\/invite\/guest\/fs_inv_/);
    // Dated, which is what the panel reads back to say when it stops working.
    expect(guest.body.invite?.expiresAt).toBeTruthy();

    const buddy = await fromTheBrowser({ kind: "buddy", trip: "bus-2026" });
    expect(buddy.status).toBe(201);
    expect(buddy.body.invite?.scope).toBe("ana/bus-2026");
    expect(buddy.body.invite?.url).toMatch(/\/ana\/invite\/buddy\/fs_inv_/);

    as(null);
  });

  test("a guest link cannot be narrowed to one trip, and a buddy link needs one", async () => {
    as(null);
    const token = await ownerToken();
    expect((await createLink(token, { kind: "guest", trip: "bus-2026" })).status).toBe(400);
    expect((await createLink(token, { kind: "buddy" })).status).toBe(400);
    expect((await createLink(token, { kind: "buddy", trip: "no-such" })).status).toBe(404);
    expect((await createLink(token, { kind: "whatever" })).status).toBe(400);
  });
});

describe("redeeming a guest link", () => {
  const OMA = "oma@example.test";
  let link = "";
  let inviteId = "";

  test("from a cold browser it creates a pending contact and grants nothing", async () => {
    as(null);
    const token = await ownerToken();
    const created = await createLink(token, { kind: "guest" });
    inviteId = created.body.invite!.id;
    const url = created.body.invite!.url!;
    link = url.slice(url.lastIndexOf("/") + 1);

    as(null);
    const result = await redeem({ token: link, kind: "guest", name: "Oma", email: OMA });
    expect(result.status).toBe(202);
    // Not "you are in" — a code is on the way, and then somebody decides.
    expect(result.body.status).toBe("code");

    const contact = await contactFor(OMA);
    expect(contact?.status).toBe("pending");
    expect(contact?.approvedAt).toBeNull();
    expect(contact?.createdVia).toBe(`invite:${inviteId}`);

    const { getDatabase } = await import("@/lib/db");
    const { db } = await getDatabase();
    const grants = await db
      .selectFrom("access_grants")
      .selectAll()
      .where("contact_id", "=", contact!.id)
      .execute();
    expect(grants).toEqual([]);
  });

  test("a redeemed but unapproved guest reads exactly what a stranger reads", async () => {
    await confirm(OMA);
    expect((await contactFor(OMA))?.status).toBe("pending");

    const trips = [...(await tripsByRef()).values()];
    const { mayReadTrip, isGuestOf, mayViewCosts } = await import("@/lib/tripGate");
    const session = await signIn(OWNER, OMA);

    const answers = async (token: string | null, trip: (typeof trips)[number]) => {
      as(token);
      return {
        read: await mayReadTrip(trip),
        guest: await isGuestOf(trip),
        costs: await mayViewCosts(trip),
      };
    };

    for (const trip of trips) {
      const anonymous = await answers(null, trip);
      const redeemed = await answers(session, trip);
      expect(redeemed, `${trip.id}: redeeming changed something`).toEqual(anonymous);
    }
    as(null);
  });

  test("after the owner approves, that address reads every guest trip", async () => {
    await approve(OMA);
    const session = await signIn(OWNER, OMA);
    const trips = await tripsByRef();
    const { mayReadTrip } = await import("@/lib/tripGate");

    as(session);
    expect(await mayReadTrip(trips.get("invited-2026")!)).toBe(true);
    // And no `private` one. Being let into a journal is the one thing that
    // never widens to a trip held back from the people who are let in.
    as(session);
    expect(await mayReadTrip(trips.get("secret-2026")!)).toBe(false);
    as(null);
  });

  test("the same link works again, from a second browser", async () => {
    as(null);
    const second = await redeem({
      token: link,
      kind: "guest",
      name: "Opa",
      email: "opa@example.test",
    });
    expect(second.body.status).toBe("code");
    expect((await contactFor("opa@example.test"))?.status).toBe("pending");

    const { listInvites } = await import("@/lib/contacts/invites");
    const invite = (await listInvites(OWNER)).find((row) => row.id === inviteId);
    // Counted rather than limited: a link meant for one grandmother and used
    // eleven times is worth noticing.
    expect(invite?.uses).toBeGreaterThanOrEqual(2);
  });

  test("revoking it stops the next person and moves nobody already let in", async () => {
    as(null);
    const token = await ownerToken();
    const { DELETE } = await import("@/app/api/v1/[user]/invites/[id]/route");
    const gone = await DELETE(
      new Request(`https://example.test/api/v1/ana/invites/${inviteId}`, {
        method: "DELETE",
        headers: headers({ authorization: `Bearer ${token}` }),
      }),
      { params: Promise.resolve({ user: OWNER, id: inviteId }) },
    );
    expect(gone.status).toBe(200);

    as(null);
    const late = await redeem({
      token: link,
      kind: "guest",
      name: "Too Late",
      email: "late@example.test",
    });
    expect(late.body.status).toBe("expired");
    expect(await contactFor("late@example.test")).toBeNull();

    // The whole point of leaving the shared password behind: one person is cut
    // off and everybody else stays exactly where they were.
    const session = await signIn(OWNER, OMA);
    as(session);
    const { mayReadTrip } = await import("@/lib/tripGate");
    expect(await mayReadTrip((await tripsByRef()).get("invited-2026")!)).toBe(true);
    as(null);
  });
});

describe("redeeming a buddy link", () => {
  const ROBIN = "robin@example.test";
  let link = "";

  test("puts the person on that trip, once the owner approves", async () => {
    as(null);
    const token = await ownerToken();
    const created = await createLink(token, { kind: "buddy", trip: "bus-2026" });
    const url = created.body.invite!.url!;
    link = url.slice(url.lastIndexOf("/") + 1);

    as(null);
    expect((await redeem({ token: link, kind: "buddy", name: "Robin", email: ROBIN })).body.status)
      .toBe("code");

    const trips = await tripsByRef();
    const { isPersonOn } = await import("@/lib/tripPeople");
    // Redeeming grants nothing, here as everywhere.
    expect(await isPersonOn(trips.get("bus-2026")!, ROBIN)).toBe(false);

    await confirm(ROBIN);
    expect(await isPersonOn(trips.get("bus-2026")!, ROBIN)).toBe(false);

    await approve(ROBIN);
    expect(await isPersonOn(trips.get("bus-2026")!, ROBIN)).toBe(true);
    // The trip file still says what it always said. The merge is additive.
    expect(trips.get("bus-2026")!.people).toEqual([]);
  });

  test("and can write to that trip, and is refused against another one", async () => {
    process.env.AUTH_DEV_CODE = "424242";
    try {
      const { POST: request } = await import("@/app/api/auth/request/route");
      const ask = async (trip: string) =>
        request(
          new Request("https://example.test/api/auth/request", {
            method: "POST",
            headers: headers(),
            body: JSON.stringify({ user: OWNER, email: ROBIN, kind: "agent", trip }),
          }),
        );

      // The journal recognises them for the trip they were let onto...
      expect((await ask("bus-2026")).status).toBe(202);
      // ...and not for one they were not. `/api/auth/request` answers this
      // truthfully on purpose, so an agent is told rather than left waiting.
      expect((await ask("secret-2026")).status).toBe(403);

      const { POST: verify } = await import("@/app/api/auth/verify/route");
      const verified = await verify(
        new Request("https://example.test/api/auth/verify", {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({
            user: OWNER,
            email: ROBIN,
            code: "424242",
            kind: "agent",
            trip: "bus-2026",
          }),
        }),
      );
      expect(verified.status).toBe(200);
      const body = (await verified.json()) as { token: string; scope: string[] };
      expect(body.scope).toEqual(["write:trip:bus-2026"]);

      // And the write check itself, which is what actually guards the API.
      const { resolveSession } = await import("@/lib/auth");
      const { mayWriteTrip } = await import("@/lib/api/auth");
      const session = await resolveSession(body.token, "agent");
      const trips = await tripsByRef();
      expect(await mayWriteTrip(session!, trips.get("bus-2026")!)).toEqual({ ok: true });
      // Not "revoked" — they were never on this one, and a trip they are not on
      // has to answer exactly as a trip that does not exist (B98).
      expect(await mayWriteTrip(session!, trips.get("secret-2026")!)).toEqual({
        ok: false,
        status: 404,
        error: "unknown_trip",
      });
    } finally {
      delete process.env.AUTH_DEV_CODE;
    }
  });

  test("taking the contact back takes the trip with it", async () => {
    const { revokeContact } = await import("@/lib/contacts");
    const { isPersonOn } = await import("@/lib/tripPeople");
    const contact = await contactFor(ROBIN);
    await revokeContact(OWNER, contact!.id);
    expect(await isPersonOn((await tripsByRef()).get("bus-2026")!, ROBIN)).toBe(false);
  });
});

describe("somebody who already owns a journal on this instance", () => {
  let guestLink = "";
  let buddyLink = "";

  test("redeeming makes one contact here and nothing at all in their own journal", async () => {
    as(null);
    const token = await ownerToken();
    const guest = await createLink(token, { kind: "guest" });
    const buddy = await createLink(token, { kind: "buddy", trip: "bus-2026" });
    const cut = (url: string) => url.slice(url.lastIndexOf("/") + 1);
    guestLink = cut(guest.body.invite!.url!);
    buddyLink = cut(buddy.body.invite!.url!);

    // Signed in to their *own* journal, which is not this one. That session is
    // deliberately not proof here — sessions belong to one journal — so they
    // get the ordinary code, not a shortcut.
    as(await signIn(NEIGHBOUR, NEIGHBOUR_EMAIL));
    const result = await redeem({
      token: guestLink,
      kind: "guest",
      name: "Blake",
      email: NEIGHBOUR_EMAIL,
    });
    expect(result.body.status).toBe("code");

    const { listContacts } = await import("@/lib/contacts");
    expect((await listContacts(OWNER)).filter((c) => c.email === NEIGHBOUR_EMAIL)).toHaveLength(1);
    // Their own journal has no record of any of this.
    expect(await listContacts(NEIGHBOUR)).toEqual([]);
    as(null);
  });

  test("signed in here, a redemption is one confirmation and no form at all", async () => {
    await confirm(NEIGHBOUR_EMAIL);
    await approve(NEIGHBOUR_EMAIL);

    // What this journal already knows about them, which a redemption must not
    // overwrite or ask for again.
    const { updateContactByOwner } = await import("@/lib/contacts");
    const before = await contactFor(NEIGHBOUR_EMAIL);
    await updateContactByOwner(OWNER, before!.id, {
      address: {
        name: "Blake",
        line1: "Bahnhofstrasse 1",
        line2: "",
        postcode: "8001",
        city: "Zurich",
        country: "Switzerland",
        tel: "+41 00 000 00 00",
      },
      wantsEmailDigest: true,
      wantsPostcard: true,
    });

    as(await signIn(OWNER, NEIGHBOUR_EMAIL));
    // No name, no address, no email in the body: the session carries the
    // address and the record carries the name.
    const again = await redeem({ token: buddyLink, kind: "buddy" });
    expect(again.status).toBe(202);
    // Already approved, so there is nothing to wait for and they are told so.
    expect(again.body.status).toBe("in");

    const { listContacts } = await import("@/lib/contacts");
    const rows = (await listContacts(OWNER)).filter((c) => c.email === NEIGHBOUR_EMAIL);
    expect(rows).toHaveLength(1);
    // Everything a redemption never asked about is exactly as it was. A form
    // that never showed somebody their postal address must not be able to
    // delete it.
    expect(rows[0].name).toBe("Blake");
    expect(rows[0].postalAddress?.line1).toBe("Bahnhofstrasse 1");
    expect(rows[0].wantsPostcard).toBe(true);
    expect(rows[0].wantsEmailDigest).toBe(true);
    as(null);
  });

  test("the buddy place they asked for is still waiting on the owner", async () => {
    const { isPersonOn } = await import("@/lib/tripPeople");
    const trips = await tripsByRef();
    // They were already an approved *contact* when they redeemed, so nothing
    // approved the new trip request. Approving again is what opens it — and
    // until then, being a guest of the journal is not being on the bus.
    expect(await isPersonOn(trips.get("bus-2026")!, NEIGHBOUR_EMAIL)).toBe(false);
    await approve(NEIGHBOUR_EMAIL);
    expect(await isPersonOn(trips.get("bus-2026")!, NEIGHBOUR_EMAIL)).toBe(true);
  });
});

describe("an invite token is not a credential", () => {
  test("presenting one as Authorization: Bearer is refused", async () => {
    as(null);
    const token = await ownerToken();
    const created = await createLink(token, { kind: "buddy", trip: "bus-2026" });
    const url = created.body.invite!.url!;
    const secret = url.slice(url.lastIndexOf("/") + 1);

    const { GET } = await import("@/app/api/v1/[user]/trips/route");
    const refused = await GET(
      new Request("https://example.test/api/v1/ana/trips", {
        headers: headers({ authorization: `Bearer ${secret}` }),
      }),
      { params: Promise.resolve({ user: OWNER }) },
    );
    expect(refused.status).toBe(401);
    expect((await refused.json()).error).toBe("invalid_token");

    // And it cannot issue links either, which is the endpoint it was minted by.
    const { GET: listing } = await import("@/app/api/v1/[user]/invites/route");
    const alsoRefused = await listing(
      new Request("https://example.test/api/v1/ana/invites", {
        headers: headers({ authorization: `Bearer ${secret}` }),
      }),
      { params: Promise.resolve({ user: OWNER }) },
    );
    expect(alsoRefused.status).toBe(403);
  });

  test("a buddy token pasted at the guestbook reads as a dead link", async () => {
    as(null);
    const token = await ownerToken();
    const created = await createLink(token, { kind: "buddy", trip: "bus-2026" });
    const url = created.body.invite!.url!;
    const secret = url.slice(url.lastIndexOf("/") + 1);

    // `/api/contacts/request` is the guestbook's endpoint. It records nothing
    // about a trip, so accepting a buddy token there would quietly turn "come
    // along on the bus" into "add me to the mailing list" — approved, and
    // still unable to write, with nothing to say why.
    const { POST } = await import("@/app/api/contacts/request/route");
    const response = await POST(
      new Request("https://example.test/api/contacts/request", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          user: OWNER,
          name: "Wrong Form",
          email: "wrongform@example.test",
          invite: secret,
          wantsEmailDigest: false,
          wantsPostcard: false,
        }),
      }),
    );
    // The same 202 every other refusal on that route gives, so it stays no
    // kind of oracle — and nothing written.
    expect(response.status).toBe(202);
    expect(await contactFor("wrongform@example.test")).toBeNull();
  });

  test("and a token of the wrong kind does not open the other door", async () => {
    as(null);
    const token = await ownerToken();
    const created = await createLink(token, { kind: "buddy", trip: "bus-2026" });
    const url = created.body.invite!.url!;
    const secret = url.slice(url.lastIndexOf("/") + 1);

    as(null);
    const wrong = await redeem({
      token: secret,
      kind: "guest",
      name: "Wrong Door",
      email: "wrong@example.test",
    });
    expect(wrong.body.status).toBe("expired");
    expect(await contactFor("wrong@example.test")).toBeNull();
  });
});

describe("the documents that describe them", () => {
  test("the guide names both kinds and says which one grants write access", async () => {
    const { agentGuide } = await import("@/lib/api/documentation");
    const guide = agentGuide();
    expect(guide).toContain("/invite/guest/");
    expect(guide).toContain("/invite/buddy/");
    expect(guide).toContain("POST /api/v1/");
    expect(guide.toLowerCase()).toContain("group chat");
  });

  test("openapi lists the endpoints", async () => {
    const { GET } = await import("@/app/openapi.json/route");
    const document = (await (await GET()).json()) as { paths: Record<string, unknown> };
    expect(Object.keys(document.paths)).toContain("/api/v1/{user}/invites");
    expect(Object.keys(document.paths)).toContain("/api/v1/{user}/invites/{id}");
  });
});

/**
 * B153 — the journal an agent actually makes.
 *
 * Everything above builds its journal with `writeJournal`, a fixture that
 * writes `contacts: { enabled: true }` into config.json by hand. So the whole
 * of B33 was verified against a journal no agent can create: `createJournal`
 * wrote `reactions`, `costs` and `auth` and stopped, and nothing in the
 * codebase could change a `features` block afterwards. Every journal made
 * through the API answered `404 contacts_disabled` to the very next call.
 *
 * This is the same two links, issued on a journal created the way the guide
 * tells an agent to create one.
 */
describe("a journal created through the API can share itself", () => {
  const NEW_USER = "freshly";
  const NEW_EMAIL = "freshly@example.test";

  async function issueOn(
    username: string,
    token: string,
    body: Record<string, unknown>,
  ): Promise<{ status: number; body: InviteBody }> {
    const { POST } = await import("@/app/api/v1/[user]/invites/route");
    const response = await POST(
      new Request(`https://example.test/api/v1/${username}/invites`, {
        method: "POST",
        headers: headers({ authorization: `Bearer ${token}` }),
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ user: username }) },
    );
    return { status: response.status, body: (await response.json()) as InviteBody };
  }

  test("both link kinds, with nobody touching the server", async () => {
    const { createJournal } = await import("@/lib/journals");
    const created = createJournal({
      username: NEW_USER,
      title: "Freshly Made",
      ownerEmail: NEW_EMAIL,
      ownerName: "Fresh Owner",
      ownerNickname: "Fresh",
    });
    expect(created.ok).toBe(true);

    // A trip for the buddy link to name, written the way create_trip does.
    const { createTrip } = await import("@/lib/tripWrite");
    expect(
      createTrip(NEW_USER, {
        id: "first-2026",
        title: "First",
        start: "2026-05-01",
        end: "2026-05-10",
      }).ok,
    ).toBe(true);

    const { issueCode, verifyCode } = await import("@/lib/auth");
    const { code } = await issueCode(NEW_USER, NEW_EMAIL, "agent");
    const verified = await verifyCode(NEW_USER, NEW_EMAIL, code, "agent");
    if (!verified.ok) throw new Error("no token for the new journal's owner");

    // This is the call that answered 404 for every journal an agent had ever
    // made — the one the guide tells it to make immediately after creating one.
    const guest = await issueOn(NEW_USER, verified.token, { kind: "guest" });
    expect(guest.status).toBe(201);
    expect(guest.body.invite?.url).toContain(`/${NEW_USER}/invite/guest/`);

    const buddy = await issueOn(NEW_USER, verified.token, {
      kind: "buddy",
      trip: "first-2026",
    });
    expect(buddy.status).toBe(201);
    expect(buddy.body.invite?.url).toContain(`/${NEW_USER}/invite/buddy/`);
    expect(buddy.body.invite?.trip).toBe("first-2026");
  });
});

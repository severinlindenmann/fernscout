import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { writeTripFixture } from "./fixtures/content";

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
  writeTripFixture(username, {
    id,
    title: id,
    start: "2026-08-25",
    end: "2026-08-26",
    status: "past",
    visibility: visibility as "private" | "public" | "guest",
  });
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

/**
 * `invitePutResponse` directly, the way `/api/web/[user]/invites` (Studio ›
 * Readers' own door) makes a link now — B2295 (one door for readers, B2291)
 * removed the agent bearer route this used to go through — reshaped into
 * the pre-v2 `{invite: {id, kind, scope, trip, url, expiresAt}}` shape this
 * file's assertions were written against. `_token` is unused and kept only
 * so call sites did not all need editing too.
 */
async function issueOn(
  username: string,
  _token: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: InviteBody }> {
  const { invitePutResponse } = await import("@/lib/contacts/invitesResponse");
  const id = crypto.randomUUID();
  const response = await invitePutResponse(
    username,
    id,
    new Request(`https://example.test/api/web/${username}/invites`, {
      method: "PUT",
      headers: headers(),
      body: JSON.stringify(body),
    }),
  );
  const status = response.status;
  const raw = (await response.json()) as {
    id?: string;
    kind?: string;
    trip?: string | null;
    url?: string;
    expiresAt?: string | null;
    error?: string;
  };
  if (status >= 400) return { status, body: { error: raw.error } };
  return {
    status,
    body: {
      ok: true,
      invite: {
        id: raw.id!,
        kind: raw.kind!,
        scope: raw.trip ? `${username}/${raw.trip}` : username,
        trip: raw.trip ?? null,
        url: raw.url,
        expiresAt: raw.expiresAt ?? null,
      },
    },
  };
}

async function createLink(
  token: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: InviteBody }> {
  return issueOn(OWNER, token, body);
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-invites-"));
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
    // that is lost is reissued rather than looked up. `invitesListResponse`
    // directly — B2295 (one door for readers, B2291) removed the agent
    // bearer route this used to go through; Studio › Readers' own listing
    // still calls exactly this function.
    const { invitesListResponse } = await import("@/lib/contacts/invitesResponse");
    const listed = await invitesListResponse(
      OWNER,
      new Request("https://example.test/api/web/ana/invites"),
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
    const { POST } = await import("@/app/api/web/[user]/invites/route");
    const refused = await POST(
      new Request("https://example.test/api/web/ana/invites", {
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
   * carries the session cookie and no `Authorization` header at all. Since
   * B1595 that arm is a separate door, `POST /api/web/{user}/invites` —
   * v2's own `PUT /api/v2/{user}/invites/{id}` is bearer-only and refuses
   * `Authorization` outright on the web proxy — this asserts the cookie
   * door with the header genuinely absent rather than merely unused.
   */
  test("the owner's own browser, cookie only and no bearer, may issue both", async () => {
    as(await signIn(OWNER, OWNER_EMAIL));
    const { POST } = await import("@/app/api/web/[user]/invites/route");

    async function fromTheBrowser(body: Record<string, unknown>) {
      const sent = headers();
      expect(sent).not.toHaveProperty("authorization");
      const response = await POST(
        new Request("https://example.test/api/web/ana/invites", {
          method: "POST",
          headers: sent,
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ user: OWNER }) },
      );
      const status = response.status;
      const raw = (await response.json()) as {
        id?: string;
        trip?: string | null;
        url?: string;
        expiresAt?: string | null;
      };
      const invite = { ...raw, scope: raw.trip ? `${OWNER}/${raw.trip}` : OWNER };
      return { status, body: { invite } as InviteBody };
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

describe("an invite token is not a credential", () => {
  test("presenting one as Authorization: Bearer is refused", async () => {
    as(null);
    const token = await ownerToken();
    const created = await createLink(token, { kind: "buddy", trip: "bus-2026" });
    const url = created.body.invite!.url!;
    const secret = url.slice(url.lastIndexOf("/") + 1);

    const { GET } = await import("@/app/api/v2/[user]/trips/route");
    const refused = await GET(
      new Request("https://example.test/api/v2/ana/trips", {
        headers: headers({ authorization: `Bearer ${secret}` }),
      }),
      { params: Promise.resolve({ user: OWNER }) },
    );
    expect(refused.status).toBe(401);
    expect((await refused.json()).error).toBe("invalid_token");
    // It used to also be checked against `GET /api/v2/{user}/invites`, the
    // endpoint it was minted by — B2295 (one door for readers, B2291)
    // removed that agent bearer route entirely, so there is no second door
    // here to try it against any more.
  });

});

describe("the documents that describe them", () => {
  // The v2 guide (`/skill/invite-someone.md`) and its schema tests used to
  // live here. B2295 (one door for readers, B2291) removed the route, the
  // schema and the guide together — an agent no longer issues or reads an
  // invite at all, so there is nothing left to document.

  // Superseded by B1595, then retired outright by B1734: v1's hand-written
  // openapi document (and /openapi.json, which served it) is gone. What is
  // left to assert is only that the retired address says so rather than
  // lying with a 404.
  test("/openapi.json is retired and names its replacement", async () => {
    const { GET } = await import("@/app/openapi.json/route");
    const res = GET();
    expect(res.status).toBe(410);
    const body = (await res.json()) as { error: string; replacedBy: string };
    expect(body.error).toBe("gone");
    expect(body.replacedBy).toContain("/api/v2/openapi.json");
  });
});

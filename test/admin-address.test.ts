import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * The one address that owns every journal on the instance — B480.
 *
 * Access here is per journal and has no storey above it: `owner.email` in a
 * journal's own `config.json` is the whole answer. `FERNSCOUT_ADMIN_EMAIL`
 * adds one, for the person who runs the machine, and the two halves of this
 * file are the two things that have to be true about it.
 *
 * **Unset, nothing changed.** Every case below is run once with no variable at
 * all, asserting the refusal that stood before this existed. That is the more
 * important half: the variable is absent on every instance but the one that
 * sets it, and a widening that leaked into the default would be a hole in all
 * of them.
 *
 * **Set, it is an owner and not a skeleton key.** It reads a `private` trip in
 * a journal it does not own, sees the drafts in it, and writes to it with a
 * token minted against a *different* journal — that last one is the whole
 * point of an instance-wide address, and the thing `ownsUser` had to be taught.
 * What it is not is a way to widen a narrow token: a trip-scoped token in this
 * address's hands is still refused on every other trip, because the scope is
 * checked as well as the address.
 */

/** The cookie jar behind `resolveAccess`, for the browser-side half. */
const jar = vi.hoisted(() => ({ cookies: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.cookies[name] === undefined ? undefined : { value: jar.cookies[name] },
  }),
}));

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
/** The instance operator. Owns `admin-journal`, and is a stranger to `ana`. */
const ADMIN = "agent@example.test";
const ADMIN_JOURNAL = "operator";
/** The code every issue in this file produces — `AUTH_DEV_CODE`. */
const CODE = "123456";

let dir: string;
/** The admin's guest cookie for Ana's journal, and a token per state. */
let adminCookie: string;

let calls = 0;
/** One IP per call — `lib/rateLimit.ts` is a module-level map for the file. */
function headers(extra: Record<string, string> = {}): Record<string, string> {
  calls += 1;
  return {
    "content-type": "application/json",
    "x-forwarded-for": `10.9.0.${calls % 250}`,
    ...extra,
  };
}

function writeJournal(username: string, email: string) {
  fs.mkdirSync(path.join(dir, username, "trips"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, username, "config.json"),
    JSON.stringify({
      title: username,
      tagline: "t",
      owner: { name: "N", nickname: "N", email },
      startLocation: "X",
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features: { auth: { enabled: true }, mail: { enabled: true } },
    }),
  );
}

function writeTrip(username: string, id: string) {
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
      'visibility: "private"',
      'costsVisibility: "guests"',
      "---",
      "",
      "Intro.",
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(root, "entries", "2026-08-25-the-quiet-week.md"),
    ["---", 'title: "Quiet"', 'date: "2026-08-25"', "status: draft", "---", "", "Unread.", ""].join(
      "\n",
    ),
  );
}

/** Ask for an agent code the way an agent does — the route is the gate. */
async function requestCode(username: string, email: string, trip?: string) {
  const { POST } = await import("@/app/api/auth/request/route");
  const response = await POST(
    new Request("https://example.test/api/auth/request", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ user: username, email, kind: "agent", ...(trip ? { trip } : {}) }),
    }),
  );
  return { status: response.status, body: (await response.json()) as { error?: string } };
}

async function agentToken(username: string, email: string): Promise<string> {
  const asked = await requestCode(username, email);
  expect(asked.status, `a code for ${username}`).toBe(202);
  const { POST } = await import("@/app/api/auth/verify/route");
  const response = await POST(
    new Request("https://example.test/api/auth/verify", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ user: username, email, code: CODE, kind: "agent" }),
    }),
  );
  const body = (await response.json()) as { token?: string; scope?: string[] };
  expect(body.scope).toEqual(["write:content"]);
  return body.token!;
}

/** A day written into one of Ana's trips, over the API. */
async function writeDay(token: string, trip: string, title: string) {
  const { POST } = await import("@/app/api/v1/[user]/trips/[trip]/days/route");
  const response = await POST(
    new Request(`https://example.test/api/v1/${OWNER}/trips/${trip}/days`, {
      method: "POST",
      headers: headers({ authorization: `Bearer ${token}` }),
      body: JSON.stringify({ date: "2026-08-25", title, content: "Something happened." }),
    }),
    { params: Promise.resolve({ user: OWNER, trip }) },
  );
  return { status: response.status, body: (await response.json()) as { error?: string } };
}

async function tripFor(id: string) {
  const { getTrips } = await import("@/lib/trips");
  const trip = getTrips(OWNER).find((t) => t.id === id);
  if (!trip) throw new Error(`no trip ${id}`);
  return trip;
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-admin-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.SESSION_SECRET = "88".repeat(32);
  process.env.AUTH_DEV_CODE = CODE;
  delete process.env.FERNSCOUT_ADMIN_EMAIL;

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: { auth: { enabled: true }, mail: { enabled: true, transport: "file" } },
    }),
  );
  writeJournal(OWNER, OWNER_EMAIL);
  writeJournal(ADMIN_JOURNAL, ADMIN);
  writeTrip(OWNER, "honeymoon-2026");
  writeTrip(OWNER, "alps-2026");
  // The operator's own journal has a trip in it too, because a journal with
  // nothing to open is dropped from this list whoever is asking — and a
  // fixture where their own journal is missing for an unrelated reason would
  // prove nothing about the two roles.
  writeTrip(ADMIN_JOURNAL, "their-own-2026");

  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  clearConfigCache();
  clearUserCache();

  // The admin proves their address to Ana's journal the way anybody can — a
  // guest code is mailed to whoever asks for one, which is exactly why proving
  // an address must not by itself open anything.
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, ADMIN, "guest");
  const session = await verifyCode(OWNER, ADMIN, code, "guest");
  if (!session.ok) throw new Error(`sign-in failed: ${session.reason}`);
  adminCookie = session.token;
});

afterAll(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  delete process.env.AUTH_DEV_CODE;
  delete process.env.FERNSCOUT_ADMIN_EMAIL;
  fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  jar.cookies = { fs_session: adminCookie };
});

describe("with no FERNSCOUT_ADMIN_EMAIL, the address is a stranger", () => {
  beforeEach(() => {
    delete process.env.FERNSCOUT_ADMIN_EMAIL;
  });

  test("cannot be issued an agent code for a journal it does not own", async () => {
    const asked = await requestCode(OWNER, ADMIN);
    expect(asked.status).toBe(403);
    expect(asked.body.error).toBe("not_authorised");
  });

  test("is not the owner, and cannot read a private trip", async () => {
    const { isOwner } = await import("@/lib/contacts/session");
    const { mayReadTrip, draftsVisibleTo } = await import("@/lib/tripGate");
    expect(await isOwner(OWNER)).toBe(false);
    expect(await mayReadTrip(await tripFor("honeymoon-2026"))).toBe(false);
    expect((await draftsVisibleTo(await tripFor("honeymoon-2026"))).visible).toBe(false);
  });

  test("its own journal's token does not reach another journal", async () => {
    const { ownsUser } = await import("@/lib/api/auth");
    const session = {
      id: "s",
      userId: "u",
      owner: ADMIN_JOURNAL,
      kind: "agent" as const,
      scope: "write:content",
      email: ADMIN,
      publicId: null,
    };
    expect(ownsUser(session, OWNER)).toBe(false);
  });
});

describe("with FERNSCOUT_ADMIN_EMAIL set, the address owns every journal", () => {
  beforeEach(() => {
    process.env.FERNSCOUT_ADMIN_EMAIL = ADMIN;
  });

  test("reads a private trip in a journal it does not own, drafts and all", async () => {
    const { isOwner } = await import("@/lib/contacts/session");
    const { mayReadTrip, draftsVisibleTo, isGuestOf } = await import("@/lib/tripGate");
    const trip = await tripFor("honeymoon-2026");
    expect(await isOwner(OWNER)).toBe(true);
    expect(await mayReadTrip(trip)).toBe(true);
    expect(await draftsVisibleTo(trip)).toEqual({ visible: true, canPublish: true });
    expect(await isGuestOf(trip)).toBe(true);
  });

  test("a capitalised address is the same address", async () => {
    process.env.FERNSCOUT_ADMIN_EMAIL = "  Agent@Example.Test ";
    const { isOwner } = await import("@/lib/contacts/session");
    expect(await isOwner(OWNER)).toBe(true);
  });

  test("everybody else is unaffected", async () => {
    jar.cookies = {};
    const { isOwner } = await import("@/lib/contacts/session");
    const { mayReadTrip } = await import("@/lib/tripGate");
    const { journalsFor } = await import("@/lib/home");
    expect(await isOwner(OWNER)).toBe(false);
    expect(await mayReadTrip(await tripFor("honeymoon-2026"))).toBe(false);
    expect(await journalsFor(OWNER_EMAIL)).toEqual([
      expect.objectContaining({ username: OWNER, role: "owner" }),
    ]);
  });

  test("the home view lists both journals, and calls only one of them theirs", async () => {
    const { journalsFor } = await import("@/lib/home");
    const listed = await journalsFor(ADMIN);
    // Their own journal reads `owner`; Ana's reads `admin` — B488. The badge
    // said "yours" about somebody else's journal, and the hint under it told
    // them to publish into it.
    expect(new Map(listed.map((j) => [j.username, j.role]))).toEqual(
      new Map([
        [ADMIN_JOURNAL, "owner"],
        [OWNER, "admin"],
      ]),
    );
    // Their own first: on this instance every other journal is `admin`, and
    // the one they came for should not be at the bottom of that list.
    expect(listed[0].username).toBe(ADMIN_JOURNAL);
  });

  test("is issued a journal-wide code for a journal it does not own", async () => {
    const asked = await requestCode(OWNER, ADMIN);
    expect(asked.status).toBe(202);
  });

  test("writes to another journal's private trip with its own journal's token", async () => {
    const token = await agentToken(ADMIN_JOURNAL, ADMIN);
    const written = await writeDay(token, "honeymoon-2026", "From the operator");
    expect(written.status, JSON.stringify(written.body)).toBe(201);
  });

  test("a trip-scoped token in the same hands is still narrow", async () => {
    const { issueCode, verifyCode, tripWriteScope } = await import("@/lib/auth");
    const { code } = await issueCode(OWNER, ADMIN, "agent", { trip: "alps-2026" });
    const session = await verifyCode(OWNER, ADMIN, code, "agent", tripWriteScope("alps-2026"));
    if (!session.ok) throw new Error("could not mint a trip token");
    expect(session.scope).toBe("write:trip:alps-2026");
    const refused = await writeDay(session.token, "honeymoon-2026", "Not mine");
    expect(refused.status).toBe(404);

    // And the same narrowness in the browser: a token is not a cookie, so
    // `isOwner` must not read one out of an unrelated request either.
    jar.cookies = {};
    const { isOwner } = await import("@/lib/contacts/session");
    const request = new Request("https://example.test/x", {
      headers: { authorization: `Bearer ${session.token}` },
    });
    expect(await isOwner(OWNER, request)).toBe(false);
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

/**
 * What a trip-scoped agent token may reach, and what it may not — B230, B231.
 *
 * Two defects found by the B22 sweep, both about one boundary: *being on one
 * trip is not owning the journal*. `lib/tripPeople.ts` states it — "being on
 * somebody's Vietnam trip is not a reason to be able to rewrite their
 * honeymoon" — and two paths did not enforce it.
 *
 * These tests were written by the sweep asserting the behaviour **as it then
 * was**, so the findings were reproducible rather than argued about, each
 * naming the ticket that would flip it. Both tickets are done and the
 * expectations are flipped: every case below now asserts the refusal, and each
 * one fails against the code as it stood on 2026-09-04.
 *
 * - **B230** — `/api/auth/verify` re-read the trip from the request body and
 *   *widened* the token when it did not recognise it. Somebody on one trip
 *   asked for a code naming that trip, verified with the field left off, and
 *   was handed the owner's unqualified `write:content`. The trip is now bound
 *   to the code at issue time (`login_codes.trip_id`) and read off the row.
 * - **B231** — `/<user>/export.zip` decided "owner" with `ownsUser` alone,
 *   which asks only which journal the token belongs to. A token that may write
 *   one trip downloaded every trip in the journal, private ones included, with
 *   every unpublished draft in them. The route now asks for the owner's
 *   unqualified scope as well.
 */

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
/** On one trip, and only one. */
const ROBIN = "robin@example.test";
/** The code every issue in this file produces — `AUTH_DEV_CODE`. */
const CODE = "123456";

let dir: string;

let calls = 0;
/** One IP per call — `lib/rateLimit.ts` is a module-level map for the file. */
function headers(extra: Record<string, string> = {}): Record<string, string> {
  calls += 1;
  return {
    "content-type": "application/json",
    "x-forwarded-for": `10.7.0.${calls % 250}`,
    ...extra,
  };
}

function writeTrip(id: string, visibility: string, people: string[]) {
  const root = path.join(dir, OWNER, "trips", id);
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
      ...(people.length
        ? ["people:", ...people.flatMap((email) => [`  - name: "R"`, `    email: "${email}"`])]
        : []),
      "---",
      "",
      "Intro.",
      "",
    ].join("\n"),
  );
}

function writeDraft(tripId: string, slug: string) {
  fs.writeFileSync(
    path.join(dir, OWNER, "trips", tripId, "entries", `2026-08-25-${slug}.md`),
    ["---", `title: "${slug}"`, 'date: "2026-08-25"', "status: draft", "---", "", "Unread.", ""].join(
      "\n",
    ),
  );
}

/**
 * Ask for a code the way an agent does — the real `/api/auth/request` route,
 * which is where the trip is checked and, since B230, written down.
 */
async function requestCode(email: string, trip?: string) {
  const { POST } = await import("@/app/api/auth/request/route");
  const response = await POST(
    new Request("https://example.test/api/auth/request", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        user: OWNER,
        email,
        kind: "agent",
        ...(trip ? { trip } : {}),
      }),
    }),
  );
  return { status: response.status, body: (await response.json()) as { error?: string } };
}

/** The real verify route, with whatever body an agent chooses to send. */
async function verify(body: Record<string, unknown>) {
  const { POST } = await import("@/app/api/auth/verify/route");
  const response = await POST(
    new Request("https://example.test/api/auth/verify", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
    }),
  );
  return {
    status: response.status,
    body: (await response.json()) as { token?: string; scope?: string[]; error?: string },
  };
}

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

/**
 * The archive, as text. Zip stores each entry's name uncompressed in its local
 * file header, so it can be searched for a path without unpacking it.
 */
async function exportZip(token?: string) {
  const { GET } = await import("@/app/[user]/export.zip/route");
  const response = await GET(
    new Request(`https://example.test/${OWNER}/export.zip`, {
      headers: headers(token ? { authorization: `Bearer ${token}` } : {}),
    }),
    { params: Promise.resolve({ user: OWNER }) },
  );
  return {
    status: response.status,
    names: Buffer.from(await response.arrayBuffer()).toString("latin1"),
  };
}

/**
 * A token scoped to one trip, minted without going near `/api/auth/verify`.
 *
 * B231's case has to stand on its own — the sweep's finding is that it is
 * reachable *without* B230 — so nothing it asserts may depend on the verify
 * route deciding the scope correctly.
 */
async function scopedToken(email: string, trip: string): Promise<string> {
  const { issueCode, verifyCode, tripWriteScope } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, email, "agent", { trip });
  const session = await verifyCode(OWNER, email, code, "agent", tripWriteScope(trip));
  expect(session.ok).toBe(true);
  if (!session.ok) throw new Error(`could not mint a trip token: ${session.reason}`);
  expect(session.scope).toBe(`write:trip:${trip}`);
  return session.token;
}

/** A token scoped to one trip, minted the way the fixed route mints one. */
async function tripToken(email: string, trip: string): Promise<string> {
  const asked = await requestCode(email, trip);
  expect(asked.status).toBe(202);
  const result = await verify({ user: OWNER, email, code: CODE, kind: "agent" });
  expect(result.body.scope).toEqual([`write:trip:${trip}`]);
  return result.body.token!;
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-escalation-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.SESSION_SECRET = "77".repeat(32);
  // So the reproduction can go through `/api/auth/request` and then read the
  // code out of the person's inbox, which is what makes it the reproduction
  // from the report rather than an approximation of it.
  process.env.AUTH_DEV_CODE = CODE;

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      // `file` transport: the mail lands as an .eml under the content root and
      // needs no account anywhere.
      features: { auth: { enabled: true }, mail: { enabled: true, transport: "file" } },
    }),
  );
  fs.mkdirSync(path.join(dir, OWNER, "trips"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Two Backpacks",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: OWNER_EMAIL },
      startLocation: "X",
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features: { auth: { enabled: true }, mail: { enabled: true } },
    }),
  );

  // The trip Robin was on, and the one they were not.
  writeTrip("alps-2026", "private", [ROBIN]);
  writeTrip("honeymoon-2026", "private", []);
  writeDraft("honeymoon-2026", "the-quiet-week");

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
  for (const key of ["CONTENT_DIR", "DATABASE_URL", "SESSION_SECRET", "AUTH_DEV_CODE"]) {
    delete process.env[key];
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("B230 — a code issued for one trip cannot be verified into a journal-wide token", () => {
  /**
   * The reproduction from `docs/security/2026-09-04-sweep.md`, both halves
   * through the real routes: ask for a code naming the one trip you are on,
   * then verify with the `trip` field left out. It used to answer
   * `{"scope": ["write:content"]}` — the owner's own.
   */
  test("omitting the trip at verify time returns the trip scope, not write:content", async () => {
    const asked = await requestCode(ROBIN, "alps-2026");
    expect(asked.status).toBe(202);

    // No `trip` field. The same address, the same code, one field short.
    const result = await verify({ user: OWNER, email: ROBIN, code: CODE, kind: "agent" });

    expect(result.status).toBe(200);
    expect(result.body.scope).toEqual(["write:trip:alps-2026"]);
  });

  test("repeating the trip at verify time is accepted and changes nothing", async () => {
    await requestCode(ROBIN, "alps-2026");
    const result = await verify({
      user: OWNER,
      email: ROBIN,
      code: CODE,
      kind: "agent",
      trip: "alps-2026",
    });

    expect(result.status).toBe(200);
    expect(result.body.scope).toEqual(["write:trip:alps-2026"]);
  });

  test("naming a trip they are not on is refused, not honoured and not widened", async () => {
    await requestCode(ROBIN, "alps-2026");
    const result = await verify({
      user: OWNER,
      email: ROBIN,
      code: CODE,
      kind: "agent",
      trip: "honeymoon-2026",
    });

    // The endpoint's one uniform failure, and no credential of any width.
    expect(result.status).toBe(401);
    expect(result.body.error).toBe("invalid_code");
    expect(result.body.token).toBeUndefined();
    expect(result.body.scope).toBeUndefined();
  });

  test("the refusal does not spend the code the person is holding", async () => {
    await requestCode(ROBIN, "alps-2026");
    await verify({ user: OWNER, email: ROBIN, code: CODE, kind: "agent", trip: "honeymoon-2026" });

    // Same code, correct body: still live. A caller that sent the wrong field
    // must not cost somebody a code they have to ask for again.
    const second = await verify({ user: OWNER, email: ROBIN, code: CODE, kind: "agent" });
    expect(second.status).toBe(200);
    expect(second.body.scope).toEqual(["write:trip:alps-2026"]);
  });

  test("the token it does hand out cannot write into a private trip its holder was never on", async () => {
    const token = await tripToken(ROBIN, "alps-2026");

    const written = await writeDay(token, "honeymoon-2026", "Not their trip");
    expect(written.status).toBe(404);
    expect(written.body.error).toBe("unknown_trip");

    // And the trip it *is* for still works, which is the whole point of it.
    const own = await writeDay(token, "alps-2026", "Their own trip");
    expect(own.status).toBe(201);
  });

  test("a correctly scoped token is still refused, which is the behaviour to preserve", async () => {
    const { issueCode, verifyCode } = await import("@/lib/auth");
    const { tripWriteScope } = await import("@/lib/tripPeople");
    const { code } = await issueCode(OWNER, ROBIN, "agent");
    const session = await verifyCode(OWNER, ROBIN, code, "agent", tripWriteScope("alps-2026"));
    expect(session.ok).toBe(true);
    if (!session.ok) return;

    const written = await writeDay(session.token, "honeymoon-2026", "Refused");
    expect(written.status).toBe(404);
    expect(written.body.error).toBe("unknown_trip");
  });

  /**
   * The fail-closed half. `undefined` still means "the whole journal" inside
   * `verifyCode`, so what stops it being reached is that an agent code with no
   * trip on it is the *owner's* — checked against `owner.email` rather than
   * assumed. A row written by some other path cannot become a journal-wide
   * token by default.
   */
  test("an agent code with no trip on it is refused for anybody but the owner", async () => {
    const { issueCode } = await import("@/lib/auth");
    await issueCode(OWNER, ROBIN, "agent");

    const result = await verify({ user: OWNER, email: ROBIN, code: CODE, kind: "agent" });
    expect(result.status).toBe(401);
    expect(result.body.token).toBeUndefined();
  });

  test("and `verifyCode` refuses to mint one even when asked to directly", async () => {
    const { issueCode, verifyCode } = await import("@/lib/auth");
    // Bound to the trip, the way `/api/auth/request` writes it.
    const { code } = await issueCode(OWNER, ROBIN, "agent", { trip: "alps-2026" });

    // A caller asking for the journal — the scope the old route produced.
    const wide = await verifyCode(OWNER, ROBIN, code, "agent", "write:content");
    expect(wide.ok).toBe(false);
    if (!wide.ok) expect(wide.reason).toBe("out-of-scope");

    // A caller asking for nothing in particular gets the code's own trip,
    // rather than the default that used to mean the whole journal.
    const narrow = await verifyCode(OWNER, ROBIN, code, "agent");
    expect(narrow.ok).toBe(true);
    if (narrow.ok) expect(narrow.scope).toBe("write:trip:alps-2026");
  });

  describe("what the owner can still do", () => {
    test("an unqualified code still opens the whole journal", async () => {
      const asked = await requestCode(OWNER_EMAIL);
      expect(asked.status).toBe(202);

      const result = await verify({ user: OWNER, email: OWNER_EMAIL, code: CODE, kind: "agent" });
      expect(result.status).toBe(200);
      expect(result.body.scope).toEqual(["write:content"]);
    });

    test("naming a trip still narrows the token, at either call", async () => {
      // At the request, which is where the guide now tells everybody to name it.
      await requestCode(OWNER_EMAIL, "honeymoon-2026");
      const bound = await verify({ user: OWNER, email: OWNER_EMAIL, code: CODE, kind: "agent" });
      expect(bound.body.scope).toEqual(["write:trip:honeymoon-2026"]);

      // And at the verify, for an unqualified code — the behaviour `agentScope`
      // was written for, which a narrowing must never lose.
      await requestCode(OWNER_EMAIL);
      const late = await verify({
        user: OWNER,
        email: OWNER_EMAIL,
        code: CODE,
        kind: "agent",
        trip: "alps-2026",
      });
      expect(late.body.scope).toEqual(["write:trip:alps-2026"]);
    });

    test("naming a trip that does not exist is refused rather than widened", async () => {
      await requestCode(OWNER_EMAIL);
      const result = await verify({
        user: OWNER,
        email: OWNER_EMAIL,
        code: CODE,
        kind: "agent",
        trip: "no-such-trip",
      });

      expect(result.status).toBe(401);
      expect(result.body.scope).toBeUndefined();
    });
  });

  /**
   * A guest session reads the journal it was issued for and has nothing to
   * narrow, so no trip is written down even if one is handed in. Checked
   * against the library rather than the route: the route sets a cookie, and a
   * cookie needs a request scope this test has no reason to build.
   */
  test("a guest code carries no trip binding, whatever it is handed", async () => {
    const { issueCode, pendingCodeTrip, verifyCode } = await import("@/lib/auth");
    const { code } = await issueCode(OWNER, ROBIN, "guest", { trip: "alps-2026" });
    expect(await pendingCodeTrip(OWNER, ROBIN, "guest")).toBeNull();

    const session = await verifyCode(OWNER, ROBIN, code, "guest");
    expect(session.ok).toBe(true);
    if (session.ok) expect(session.scope).toBe("read");
  });
});

describe("B231 — export.zip does not hand a trip-scoped token the whole journal", () => {
  /**
   * The route decided "owner" with `ownsUser`, which asks only which journal
   * the token belongs to and never what it may do inside it. A token minted
   * for one trip — the credential a buddy link produces — therefore selected
   * the `"all"` scope: every trip on disk, drafts included.
   */
  test("a token for one trip gets the public archive, not the journal", async () => {
    const token = await scopedToken(ROBIN, "alps-2026");

    const archive = await exportZip(token);
    expect(archive.status).toBe(200);

    // The private trip they were never on, and the unpublished day inside it.
    expect(archive.names).not.toContain("trips/honeymoon-2026/");
    expect(archive.names).not.toContain("2026-08-25-the-quiet-week.md");
    // And not the private trip they *were* on either: this is the archive an
    // anonymous visitor gets, and a per-trip export is a separate feature.
    expect(archive.names).not.toContain("trips/alps-2026/");
  });

  test("the journal's owner still gets all of it", async () => {
    await requestCode(OWNER_EMAIL);
    const session = await verify({ user: OWNER, email: OWNER_EMAIL, code: CODE, kind: "agent" });
    expect(session.body.scope).toEqual(["write:content"]);

    const archive = await exportZip(session.body.token);
    expect(archive.names).toContain("trips/honeymoon-2026/trip.md");
    expect(archive.names).toContain("trips/alps-2026/trip.md");
    expect(archive.names).toContain("2026-08-25-the-quiet-week.md");
  });

  test("an anonymous request still gets neither", async () => {
    const archive = await exportZip();
    expect(archive.names).not.toContain("trips/honeymoon-2026/");
    expect(archive.names).not.toContain("trips/alps-2026/");
  });

  /**
   * The same mistake in the same idiom, one endpoint over, on a much smaller
   * payload — folded into B231 by the sweep rather than filed separately.
   */
  test("and the journal's features are not readable by a trip-scoped token", async () => {
    const token = await scopedToken(ROBIN, "alps-2026");
    const { GET } = await import("@/app/api/v1/[user]/config/route");
    const response = await GET(
      new Request(`https://example.test/api/v1/${OWNER}/config`, {
        headers: headers({ authorization: `Bearer ${token}` }),
      }),
      { params: Promise.resolve({ user: OWNER }) },
    );
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error?: string }).error).toBe("out_of_scope");
  });
});

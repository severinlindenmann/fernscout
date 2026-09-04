import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

/**
 * What a trip-scoped agent token can reach that it should not — the B22 sweep.
 *
 * Two separate defects, both about the same boundary: *being on one trip is
 * not owning the journal*. `lib/tripPeople.ts` states it — "being on somebody's
 * Vietnam trip is not a reason to be able to rewrite their honeymoon" — and
 * two paths do not enforce it.
 *
 * **These tests assert the behaviour as it is today, which is the wrong
 * behaviour.** They exist so the sweep's findings are reproducible rather than
 * argued about, and they are written to pass so the suite stays green until
 * the fixes land. Each one names the ticket that fixes it; when that ticket is
 * done, the expectation flips and this comment goes.
 *
 * - **B230** — `/api/auth/verify` re-reads the trip from the request body and
 *   *widens* the token when it does not recognise it. Somebody on one trip
 *   asks for a code naming that trip, then verifies with the field left off,
 *   and is handed the owner's unqualified `write:content`.
 * - **B231** — `/<user>/export.zip` decides "owner" with `ownsUser` alone,
 *   which asks only which journal the token belongs to. A token that may write
 *   one trip downloads every trip in the journal, private ones included, with
 *   every unpublished draft in them.
 */

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
/** On one trip, and only one. */
const ROBIN = "robin@example.test";

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

/** A code for an address, as `/api/auth/request` issues one. */
async function agentCode(email: string): Promise<string> {
  const { issueCode } = await import("@/lib/auth");
  return (await issueCode(OWNER, email, "agent")).code;
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
    body: (await response.json()) as { token?: string; scope?: string[] },
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

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-escalation-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.SESSION_SECRET = "77".repeat(32);

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: { auth: { enabled: true } },
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
      features: { auth: { enabled: true } },
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
  for (const key of ["CONTENT_DIR", "DATABASE_URL", "SESSION_SECRET"]) delete process.env[key];
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("B230 — a code issued for one trip is verified into a journal-wide token", () => {
  /**
   * `/api/auth/request` refuses an agent code to anybody who is neither the
   * owner nor on the trip they named, which is the check everything downstream
   * leans on. But the trip is *not* bound to the code: it is sent again at
   * verify time, and `agentScope` returns `undefined` — meaning "the whole
   * journal" — for every value it does not recognise, including none at all.
   */
  test("omitting the trip at verify time returns write:content, not the trip scope", async () => {
    const code = await agentCode(ROBIN);
    // No `trip` field. The same address, the same code, one field short.
    const result = await verify({ user: OWNER, email: ROBIN, code, kind: "agent" });

    expect(result.status).toBe(200);
    // Today. B230 makes this `["write:trip:alps-2026"]` — or a refusal.
    expect(result.body.scope).toEqual(["write:content"]);
  });

  test("naming a trip they are not on widens the token in the same way", async () => {
    const code = await agentCode(ROBIN);
    const result = await verify({
      user: OWNER,
      email: ROBIN,
      code,
      kind: "agent",
      trip: "honeymoon-2026",
    });

    expect(result.status).toBe(200);
    expect(result.body.scope).toEqual(["write:content"]);
  });

  test("and the widened token writes into a private trip its holder was never on", async () => {
    const code = await agentCode(ROBIN);
    const result = await verify({ user: OWNER, email: ROBIN, code, kind: "agent" });
    const token = result.body.token!;

    const written = await writeDay(token, "honeymoon-2026", "Not their trip");
    // 201: the day is on disk, in a private trip belonging to somebody else.
    expect(written.status).toBe(201);
  });

  test("a correctly scoped token is still refused, which is the behaviour to restore", async () => {
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
});

describe("B231 — export.zip hands a trip-scoped token the whole journal", () => {
  /**
   * The route decides "owner" with `ownsUser`, which asks only which journal
   * the token belongs to and never what it may do inside it. A token minted
   * for one trip — the credential a buddy link produces — therefore selects
   * the `"all"` scope: every trip on disk, drafts included.
   */
  test("a token for one trip downloads a private trip it has no access to", async () => {
    const { issueCode, verifyCode } = await import("@/lib/auth");
    const { tripWriteScope } = await import("@/lib/tripPeople");
    const { code } = await issueCode(OWNER, ROBIN, "agent");
    const session = await verifyCode(OWNER, ROBIN, code, "agent", tripWriteScope("alps-2026"));
    expect(session.ok).toBe(true);
    if (!session.ok) return;

    const { GET } = await import("@/app/[user]/export.zip/route");
    const response = await GET(
      new Request(`https://example.test/${OWNER}/export.zip`, {
        headers: headers({ authorization: `Bearer ${session.token}` }),
      }),
      { params: Promise.resolve({ user: OWNER }) },
    );
    expect(response.status).toBe(200);

    // Zip stores each entry's name uncompressed in its local file header, so
    // the archive can be searched for a path without unpacking it.
    const bytes = Buffer.from(await response.arrayBuffer()).toString("latin1");

    // The trip Robin was on — expected.
    expect(bytes).toContain("trips/alps-2026/trip.md");
    // The one they were not, and the unpublished day inside it. Neither should
    // be here. B231.
    expect(bytes).toContain("trips/honeymoon-2026/trip.md");
    expect(bytes).toContain("2026-08-25-the-quiet-week.md");
  });

  test("an anonymous request still gets neither", async () => {
    const { GET } = await import("@/app/[user]/export.zip/route");
    const response = await GET(
      new Request(`https://example.test/${OWNER}/export.zip`, { headers: headers() }),
      { params: Promise.resolve({ user: OWNER }) },
    );
    const bytes = Buffer.from(await response.arrayBuffer()).toString("latin1");
    expect(bytes).not.toContain("trips/honeymoon-2026/");
    expect(bytes).not.toContain("trips/alps-2026/");
  });
});

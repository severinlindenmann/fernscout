import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

/**
 * The twenty-minute credential an owner pastes into an agent — B283.
 *
 * This is the one place in the codebase where a cookie session leads to a
 * bearer credential, which is the half of decision 24 the author decided to
 * amend. So the assertions are mostly *refusals*: the credential must be
 * useless everywhere except the one call that spends it, and useless a second
 * time.
 *
 * The refusal matrix is per route family rather than one test, because the
 * property is "every read and every write says no" and a single test on one
 * route proves that for one route. What makes it hold in general is that
 * `lookUpSession` compares the row's `kind` against what the caller asked for
 * — but a property held by construction is still worth pinning down, since the
 * construction is one line and the consequence of losing it is a write
 * credential handed to a browser.
 */

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
const ROBIN = "robin@example.test";

let dir: string;
let cookie: string | undefined;

// `isOwner` reads the guest cookie through `next/headers`, which throws
// outside a request. The routes under test authenticate with a bearer token
// instead, so this hands back whatever the current test has set.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (cookie ? { value: cookie } : undefined) }),
}));

let calls = 0;
function headers(extra: Record<string, string> = {}): Record<string, string> {
  calls += 1;
  return {
    "content-type": "application/json",
    "x-forwarded-for": `10.9.0.${calls % 250}`,
    ...extra,
  };
}

function writeTrip(id: string, people: string[]) {
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
      'visibility: "public"',
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

async function ownerAgentToken(): Promise<string> {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, OWNER_EMAIL, "agent");
  const result = await verifyCode(OWNER, OWNER_EMAIL, code, "agent");
  if (!result.ok) throw new Error("no owner token");
  return result.token;
}

async function ownerGuestCookie(): Promise<string> {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, OWNER_EMAIL, "guest");
  const result = await verifyCode(OWNER, OWNER_EMAIL, code, "guest");
  if (!result.ok) throw new Error("no owner cookie");
  return result.token;
}

async function tripAgentToken(email: string, trip: string): Promise<string> {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { tripWriteScope } = await import("@/lib/tripPeople");
  const { code } = await issueCode(OWNER, email, "agent", { trip });
  const result = await verifyCode(OWNER, email, code, "agent", tripWriteScope(trip));
  if (!result.ok) throw new Error("no trip token");
  return result.token;
}

type IssueBody = {
  handover?: string;
  expiresAt?: string;
  minutes?: number;
  exchange?: string;
  error?: string;
};

async function issue(auth?: string): Promise<{ status: number; body: IssueBody }> {
  const { POST } = await import("@/app/api/v1/[user]/handover/route");
  const response = await POST(
    new Request(`https://example.test/api/v1/${OWNER}/handover`, {
      method: "POST",
      headers: headers(auth ? { authorization: `Bearer ${auth}` } : {}),
      body: "{}",
    }),
    { params: Promise.resolve({ user: OWNER }) },
  );
  return { status: response.status, body: (await response.json()) as IssueBody };
}

type ExchangeBody = { token?: string; expiresAt?: string; user?: string; error?: string };

async function exchange(auth?: string): Promise<{ status: number; body: ExchangeBody }> {
  const { POST } = await import("@/app/api/auth/handover/route");
  const response = await POST(
    new Request("https://example.test/api/auth/handover", {
      method: "POST",
      headers: headers(auth ? { authorization: `Bearer ${auth}` } : {}),
      body: "{}",
    }),
  );
  return { status: response.status, body: (await response.json()) as ExchangeBody };
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-handover-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.SESSION_SECRET = "99".repeat(32);

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
  writeTrip("asia-2026", [ROBIN]);

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
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("issuing a handover credential", () => {
  test("the owner's bearer token gets one, with its expiry and the call to spend it", async () => {
    const { status, body } = await issue(await ownerAgentToken());
    expect(status).toBe(200);
    expect(body.handover).toBeTruthy();
    expect(body.minutes).toBe(20);
    expect(body.exchange).toBe("POST https://example.test/api/auth/handover");
    expect(body.expiresAt).toBeTruthy();
  });

  test("the owner's cookie gets one too — that is the whole point of it", async () => {
    // The control lives on a page the owner is reading in a browser, so the
    // cookie has to be enough. This is the line decision 24 used to draw, and
    // B283 is where it moved.
    cookie = await ownerGuestCookie();
    try {
      const { status, body } = await issue();
      expect(status).toBe(200);
      expect(body.handover).toBeTruthy();
    } finally {
      cookie = undefined;
    }
  });

  test("expires in twenty minutes, from the constant rather than a number here", async () => {
    const { SESSION_TTL_MS } = await import("@/lib/auth");
    const { body } = await issue(await ownerAgentToken());
    const ttl = new Date(body.expiresAt!).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(SESSION_TTL_MS.handover - 10_000);
    expect(ttl).toBeLessThanOrEqual(SESSION_TTL_MS.handover);
    // And it is nowhere near an agent token's week, which is the mistake this
    // design exists to avoid.
    expect(ttl).toBeLessThan(SESSION_TTL_MS.agent / 100);
  });

  test("nobody without a credential gets one", async () => {
    const { status, body } = await issue();
    expect(status).toBe(403);
    expect(body.error).toBe("forbidden");
  });

  test("somebody on a trip does not get one — their access is scoped and this is not", async () => {
    const { status, body } = await issue(await tripAgentToken(ROBIN, "asia-2026"));
    expect(status).toBe(403);
    expect(body.error).toBe("forbidden");
  });
});

describe("spending it", () => {
  test("becomes a seven-day agent token for that journal", async () => {
    const { SESSION_TTL_MS } = await import("@/lib/auth");
    const issued = await issue(await ownerAgentToken());
    const { status, body } = await exchange(issued.body.handover);
    expect(status).toBe(200);
    expect(body.token).toBeTruthy();
    expect(body.user).toBe(OWNER);
    const ttl = new Date(body.expiresAt!).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(SESSION_TTL_MS.agent - 60_000);
  });

  test("the token it gives back really can write", async () => {
    const issued = await issue(await ownerAgentToken());
    const exchanged = await exchange(issued.body.handover);
    const { POST } = await import("@/app/api/v1/[user]/trips/[trip]/days/route");
    const response = await POST(
      new Request(`https://example.test/api/v1/${OWNER}/trips/asia-2026/days`, {
        method: "POST",
        headers: headers({ authorization: `Bearer ${exchanged.body.token}` }),
        body: JSON.stringify({
          date: "2026-08-25",
          title: "A day from a handover",
          content: "Something happened.",
        }),
      }),
      { params: Promise.resolve({ user: OWNER, trip: "asia-2026" }) },
    );
    expect(response.status).toBeLessThan(300);
  });

  test("is spent by succeeding, and says so rather than answering a bare 401", async () => {
    const issued = await issue(await ownerAgentToken());
    expect((await exchange(issued.body.handover)).status).toBe(200);

    const again = await exchange(issued.body.handover);
    expect(again.status).toBe(401);
    expect(again.body.error).toBe("invalid_handover");
    // The message is the difference between an agent asking for a fresh key
    // and an agent telling the person the site is broken.
    expect(JSON.stringify(again.body)).toContain("already used");
  });

  test("refuses a request with no credential at all", async () => {
    const { status, body } = await exchange();
    expect(status).toBe(401);
    expect(body.error).toBe("missing_token");
  });

  test("refuses an agent token — it is not a handover credential", async () => {
    const { status, body } = await exchange(await ownerAgentToken());
    expect(status).toBe(401);
    expect(body.error).toBe("invalid_handover");
  });

  test("refuses a guest cookie value presented as a bearer token", async () => {
    const { status } = await exchange(await ownerGuestCookie());
    expect(status).toBe(401);
  });
});

/**
 * The property that makes a fourth session kind safe: it is refused everywhere
 * by default, because `lookUpSession` compares `kind` against what the caller
 * asked for. One test per route family, since "everywhere" is the claim.
 */
describe("a handover credential is refused everywhere else", () => {
  async function fresh(): Promise<string> {
    const issued = await issue(await ownerAgentToken());
    return issued.body.handover!;
  }

  test("on status, which is the first thing an agent would try it on", async () => {
    const handover = await fresh();
    const { GET } = await import("@/app/api/v1/[user]/status/route");
    const response = await GET(
      new Request(`https://example.test/api/v1/${OWNER}/status`, {
        headers: headers({ authorization: `Bearer ${handover}` }),
      }),
      { params: Promise.resolve({ user: OWNER }) },
    );
    expect(response.status).toBe(401);
  });

  test("on a write", async () => {
    const handover = await fresh();
    const { POST } = await import("@/app/api/v1/[user]/trips/[trip]/days/route");
    const response = await POST(
      new Request(`https://example.test/api/v1/${OWNER}/trips/asia-2026/days`, {
        method: "POST",
        headers: headers({ authorization: `Bearer ${handover}` }),
        body: JSON.stringify({ date: "2026-08-25", title: "No", content: "No." }),
      }),
      { params: Promise.resolve({ user: OWNER, trip: "asia-2026" }) },
    );
    expect(response.status).toBe(401);
  });

  test("on the drafts queue", async () => {
    const handover = await fresh();
    const { GET } = await import("@/app/api/v1/[user]/drafts/route");
    const response = await GET(
      new Request(`https://example.test/api/v1/${OWNER}/drafts`, {
        headers: headers({ authorization: `Bearer ${handover}` }),
      }),
      { params: Promise.resolve({ user: OWNER }) },
    );
    expect(response.status).toBe(401);
  });

  test("on the trip list", async () => {
    const handover = await fresh();
    const { GET } = await import("@/app/api/v1/[user]/trips/route");
    const response = await GET(
      new Request(`https://example.test/api/v1/${OWNER}/trips`, {
        headers: headers({ authorization: `Bearer ${handover}` }),
      }),
      { params: Promise.resolve({ user: OWNER }) },
    );
    expect(response.status).toBe(401);
  });

  test("and it cannot issue another handover credential of its own", async () => {
    const handover = await fresh();
    const { status } = await issue(handover);
    expect(status).toBe(403);
  });

  test("and it is not a guest session, so it opens no gated page", async () => {
    const handover = await fresh();
    const { resolveSession } = await import("@/lib/auth");
    expect(await resolveSession(handover, "guest")).toBeNull();
    expect(await resolveSession(handover, "agent")).toBeNull();
    expect(await resolveSession(handover, "signup")).toBeNull();
    expect(await resolveSession(handover, "handover")).not.toBeNull();
  });
});

type KeysBody = { keys?: { id: string; kind: string; lastSeenAt: string | null }[]; error?: string };

async function keys(auth?: string): Promise<{ status: number; body: KeysBody }> {
  const { GET } = await import("@/app/api/v1/[user]/keys/route");
  const response = await GET(
    new Request(`https://example.test/api/v1/${OWNER}/keys`, {
      headers: headers(auth ? { authorization: `Bearer ${auth}` } : {}),
    }),
    { params: Promise.resolve({ user: OWNER }) },
  );
  return { status: response.status, body: (await response.json()) as KeysBody };
}

async function revoke(auth: string | undefined, id: string): Promise<number> {
  const { POST } = await import("@/app/api/v1/[user]/keys/route");
  const response = await POST(
    new Request(`https://example.test/api/v1/${OWNER}/keys`, {
      method: "POST",
      headers: headers(auth ? { authorization: `Bearer ${auth}` } : {}),
      body: JSON.stringify({ revoke: id }),
    }),
    { params: Promise.resolve({ user: OWNER }) },
  );
  return response.status;
}

/**
 * Taking a key back — B283's other half.
 *
 * The handover block makes handing out a seven-day write token a two-second
 * act. If revoking one were not also a two-second act, the honest advice would
 * be "only do this if you are sure", which nobody can follow. `listSessions`
 * had existed since W06 with no caller; this is the caller.
 */
describe("the keys that can write, and revoking one", () => {
  test("lists a key an agent is holding, and says when it was last used", async () => {
    const issued = await issue(await ownerAgentToken());
    const exchanged = await exchange(issued.body.handover);

    const listed = await keys(await ownerAgentToken());
    expect(listed.status).toBe(200);
    const mine = listed.body.keys ?? [];
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((k) => k.kind === "agent" || k.kind === "handover")).toBe(true);
    // Never the token itself: only hashes were ever stored, and an id is all
    // revoking needs.
    expect(JSON.stringify(listed.body)).not.toContain(exchanged.body.token!);
  });

  test("a handover credential waiting to be picked up is listed too", async () => {
    const issued = await issue(await ownerAgentToken());
    const listed = await keys(await ownerAgentToken());
    expect((listed.body.keys ?? []).some((k) => k.kind === "handover")).toBe(true);
    // And it leaves the list once it is spent.
    await exchange(issued.body.handover);
    const after = await keys(await ownerAgentToken());
    const stillThere = (after.body.keys ?? []).filter((k) => k.kind === "handover").length;
    const beforeCount = (listed.body.keys ?? []).filter((k) => k.kind === "handover").length;
    expect(stillThere).toBeLessThan(beforeCount);
  });

  test("guest sessions are not in the list — they cannot write, and the button says revoke", async () => {
    await ownerGuestCookie();
    const listed = await keys(await ownerAgentToken());
    expect((listed.body.keys ?? []).some((k) => k.kind === "guest")).toBe(false);
  });

  test("revoking one stops it writing, at once", async () => {
    const issued = await issue(await ownerAgentToken());
    const exchanged = await exchange(issued.body.handover);
    const token = exchanged.body.token!;

    const { resolveSession } = await import("@/lib/auth");
    // Resolve the token to its own row rather than guessing which of several
    // agent keys in the list is this one: the assertion is about *this*
    // credential stopping, and picking a row by position would sometimes
    // revoke a different one and still pass.
    const session = await resolveSession(token, "agent");
    expect(session).not.toBeNull();

    const listed = await keys(await ownerAgentToken());
    expect((listed.body.keys ?? []).some((k) => k.id === session!.id)).toBe(true);

    expect(await revoke(await ownerAgentToken(), session!.id)).toBe(200);

    // Immediate, because every read asks the database — B98 is the task that
    // made that true for writes as well.
    expect(await resolveSession(token, "agent")).toBeNull();

    const { POST } = await import("@/app/api/v1/[user]/trips/[trip]/days/route");
    const response = await POST(
      new Request(`https://example.test/api/v1/${OWNER}/trips/asia-2026/days`, {
        method: "POST",
        headers: headers({ authorization: `Bearer ${token}` }),
        body: JSON.stringify({ date: "2026-08-25", title: "After revoke", content: "No." }),
      }),
      { params: Promise.resolve({ user: OWNER, trip: "asia-2026" }) },
    );
    expect(response.status).toBe(401);

    // And it is out of the list, so the owner is not offered a button that
    // does nothing.
    const after = await keys(await ownerAgentToken());
    expect((after.body.keys ?? []).some((k) => k.id === session!.id)).toBe(false);
  });

  test("nobody but the owner may look, or revoke", async () => {
    const listed = await keys(await ownerAgentToken());
    const id = (listed.body.keys ?? [])[0]?.id ?? "none";

    expect((await keys()).status).toBe(403);
    expect((await keys(await tripAgentToken(ROBIN, "asia-2026"))).status).toBe(403);
    expect(await revoke(undefined, id)).toBe(403);
    expect(await revoke(await tripAgentToken(ROBIN, "asia-2026"), id)).toBe(403);
  });

  test("an id that is not this journal's is refused, not silently accepted", async () => {
    expect(await revoke(await ownerAgentToken(), "00000000-0000-0000-0000-000000000000")).toBe(404);
  });

  test("a request with no id at all is a bad request", async () => {
    const { POST } = await import("@/app/api/v1/[user]/keys/route");
    const response = await POST(
      new Request(`https://example.test/api/v1/${OWNER}/keys`, {
        method: "POST",
        headers: headers({ authorization: `Bearer ${await ownerAgentToken()}` }),
        body: "{}",
      }),
      { params: Promise.resolve({ user: OWNER }) },
    );
    expect(response.status).toBe(400);
  });
});

describe("with sign-in switched off", () => {
  test("neither route exists", async () => {
    const { clearConfigCache } = await import("@/lib/config");
    fs.writeFileSync(
      path.join(dir, "config.json"),
      JSON.stringify({
        site: { name: "R", url: "https://example.test", defaultUser: OWNER },
        users: { reserved: [] },
        features: {},
      }),
    );
    clearConfigCache();
    try {
      expect((await issue(await ownerAgentToken().catch(() => "x"))).status).toBe(404);
      expect((await exchange("anything")).status).toBe(404);
    } finally {
      fs.writeFileSync(
        path.join(dir, "config.json"),
        JSON.stringify({
          site: { name: "R", url: "https://example.test", defaultUser: OWNER },
          users: { reserved: [] },
          features: { auth: { enabled: true } },
        }),
      );
      clearConfigCache();
    }
  });
});

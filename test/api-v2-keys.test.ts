import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

// `isOwner` reads the guest cookie through `next/headers`, which throws
// outside a request. Every call in this file authenticates with a bearer
// token instead, so there is never a live cookie to hand back.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

/**
 * v2's one real shape change on `GET/POST /api/auth/{user}/keys` — B1600.
 *
 * `test/handover.test.ts` already covers the ownership/capability/B323
 * matrix in full, moved onto the new path unchanged. This file is the
 * delta: the translated `scope` shape (`describeScope`'s output, never the
 * raw `write:trip:…` string), and the one new guard on the handover mint —
 * a trip-scoped bearer must not be able to widen itself into a
 * journal-wide credential.
 */

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
const ROBIN = "robin@example.test";

let dir: string;

let calls = 0;
function headers(extra: Record<string, string> = {}): Record<string, string> {
  calls += 1;
  return {
    "content-type": "application/json",
    "x-forwarded-for": `10.9.1.${calls % 250}`,
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

async function tripAgentToken(email: string, trip: string): Promise<string> {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { tripWriteScope } = await import("@/lib/tripPeople");
  const { code } = await issueCode(OWNER, email, "agent", { trip });
  const result = await verifyCode(OWNER, email, code, "agent", tripWriteScope(trip));
  if (!result.ok) throw new Error("no trip token");
  return result.token;
}

type KeyRow = {
  id: string;
  kind: string;
  scope?: string;
  trip?: string;
  email?: string;
};
type KeysBody = { keys?: KeyRow[]; error?: string };

async function keys(auth?: string): Promise<{ status: number; body: KeysBody }> {
  const { GET } = await import("@/app/api/auth/[user]/keys/route");
  const response = await GET(
    new Request(`https://example.test/api/auth/${OWNER}/keys`, {
      headers: headers(auth ? { authorization: `Bearer ${auth}` } : {}),
    }),
    { params: Promise.resolve({ user: OWNER }) },
  );
  return { status: response.status, body: (await response.json()) as KeysBody };
}

async function revoke(auth: string | undefined, id: string): Promise<{ status: number; body: KeysBody }> {
  const { POST } = await import("@/app/api/auth/[user]/keys/route");
  const response = await POST(
    new Request(`https://example.test/api/auth/${OWNER}/keys`, {
      method: "POST",
      headers: headers(auth ? { authorization: `Bearer ${auth}` } : {}),
      body: JSON.stringify({ revoke: id }),
    }),
    { params: Promise.resolve({ user: OWNER }) },
  );
  return { status: response.status, body: (await response.json()) as KeysBody };
}

type IssueBody = { handover?: string; error?: string };

async function issueHandoverCall(auth?: string): Promise<{ status: number; body: IssueBody }> {
  const { POST } = await import("@/app/api/auth/[user]/handover/route");
  const response = await POST(
    new Request(`https://example.test/api/auth/${OWNER}/handover`, {
      method: "POST",
      headers: headers(auth ? { authorization: `Bearer ${auth}` } : {}),
      body: "{}",
    }),
    { params: Promise.resolve({ user: OWNER }) },
  );
  return { status: response.status, body: (await response.json()) as IssueBody };
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-api-v2-keys-"));
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

describe("keys: the owner sees every row, a non-owner only their own", () => {
  test("the owner's list includes their own row and a buddy's", async () => {
    const buddy = await tripAgentToken(ROBIN, "asia-2026");
    const listed = await keys(await ownerAgentToken());
    expect(listed.status).toBe(200);
    const rows = listed.body.keys ?? [];
    expect(rows.some((k) => k.email === OWNER_EMAIL)).toBe(true);
    expect(rows.some((k) => k.email === ROBIN)).toBe(true);
    expect(buddy).toBeTruthy();
  });

  test("a buddy's own list holds only their row, with no email field on any of them", async () => {
    const buddyToken = await tripAgentToken(ROBIN, "asia-2026");
    const listed = await keys(buddyToken);
    expect(listed.status).toBe(200);
    const rows = listed.body.keys ?? [];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((k) => k.email === undefined)).toBe(true);
  });
});

describe("keys: scope is translated, never the raw internal string", () => {
  test("a trip-scoped key comes back as {scope: \"trip\", trip: \"...\"}", async () => {
    const buddyToken = await tripAgentToken(ROBIN, "asia-2026");
    const listed = await keys(buddyToken);
    const rows = listed.body.keys ?? [];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.scope).toBe("trip");
      expect(row.trip).toBe("asia-2026");
      // Never the internal vocabulary leaking onto the wire.
      expect(JSON.stringify(row)).not.toContain("write:trip:");
      expect(JSON.stringify(row)).not.toContain("write:content");
    }
  });

  test("the owner's own key comes back as {scope: \"owner\"}, with no trip field", async () => {
    const listed = await keys(await ownerAgentToken());
    const rows = listed.body.keys ?? [];
    const ownerRow = rows.find((k) => k.email === OWNER_EMAIL);
    expect(ownerRow).toBeTruthy();
    expect(ownerRow!.scope).toBe("owner");
    expect(ownerRow!.trip).toBeUndefined();
  });
});

describe("keys: kind is translated, never the raw internal SessionKind", () => {
  test("a live agent token comes back as {kind: \"write\"}, never \"agent\"", async () => {
    const listed = await keys(await ownerAgentToken());
    const rows = listed.body.keys ?? [];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.kind).toBe("write");
    }
  });
});

describe("keys: revoking somebody else's id", () => {
  test("a buddy revoking the owner's key gets unknown_key, not forbidden", async () => {
    const ownerListed = await keys(await ownerAgentToken());
    const ownerId = (ownerListed.body.keys ?? []).find((k) => k.email === OWNER_EMAIL)?.id;
    expect(ownerId).toBeTruthy();

    const buddyToken = await tripAgentToken(ROBIN, "asia-2026");
    const result = await revoke(buddyToken, ownerId!);
    expect(result.status).toBe(404);
    expect(result.body.error).toBe("unknown_key");
  });

  test("an id that belongs to no session at all is the same unknown_key, 404", async () => {
    const result = await revoke(await ownerAgentToken(), "00000000-0000-0000-0000-000000000000");
    expect(result.status).toBe(404);
    expect(result.body.error).toBe("unknown_key");
  });
});

describe("handover mint: refuses a trip-scoped bearer", () => {
  test("a buddy's trip-scoped token cannot mint a journal-wide handover credential", async () => {
    const buddyToken = await tripAgentToken(ROBIN, "asia-2026");
    const { status, body } = await issueHandoverCall(buddyToken);
    expect(status).toBe(403);
    expect(body.error).toBe("forbidden");
    expect(body.handover).toBeUndefined();
  });

  test("the owner's own unscoped agent token still gets one", async () => {
    const { status, body } = await issueHandoverCall(await ownerAgentToken());
    expect(status).toBe(200);
    expect(body.handover).toBeTruthy();
  });
});

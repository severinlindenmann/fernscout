import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

/**
 * `GET /api/v2/status` and `GET /api/v2/{user}/status` — B1608, phase 2
 * step 3. The instance door needs no journal and no auth; the journal door
 * is scoped by `writableTrips`, the same rule v1's `journalStatus` uses.
 */

const OWNER = "cleo";
const OWNER_EMAIL = "cleo@example.test";
const BUDDY = "buddy@example.test";

let dir: string;
let calls = 0;

function headers(extra: Record<string, string> = {}): Record<string, string> {
  calls += 1;
  return { "content-type": "application/json", "x-forwarded-for": `10.9.3.${calls % 250}`, ...extra };
}

function writeTrip(id: string, people: string[] = []) {
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

function writeDraft(tripId: string, slug: string) {
  fs.writeFileSync(
    path.join(dir, OWNER, "trips", tripId, "entries", `2026-08-25-${slug}.md`),
    ["---", `title: "${slug}"`, 'date: "2026-08-25"', 'status: "draft"', "---", "", "Words.", ""].join("\n"),
  );
}

async function ownerToken(): Promise<string> {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, OWNER_EMAIL, "agent");
  const result = await verifyCode(OWNER, OWNER_EMAIL, code, "agent");
  if (!result.ok) throw new Error("no owner token");
  return result.token;
}

async function tripToken(email: string, trip: string): Promise<string> {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { tripWriteScope } = await import("@/lib/tripPeople");
  const { code } = await issueCode(OWNER, email, "agent", { trip });
  const result = await verifyCode(OWNER, email, code, "agent", tripWriteScope(trip));
  if (!result.ok) throw new Error("no trip token");
  return result.token;
}

type StatusBody = Record<string, unknown> & { error?: string };

async function instanceStatus(): Promise<{ status: number; body: StatusBody }> {
  const { GET } = await import("@/app/api/v2/status/route");
  const response = await GET();
  return { status: response.status, body: (await response.json()) as StatusBody };
}

async function journalStatus(token?: string): Promise<{ status: number; body: StatusBody }> {
  const { GET } = await import("@/app/api/v2/[user]/status/route");
  const response = await GET(
    new Request(`https://example.test/api/v2/${OWNER}/status`, {
      headers: headers(token ? { authorization: `Bearer ${token}` } : {}),
    }),
    { params: Promise.resolve({ user: OWNER }) },
  );
  return { status: response.status, body: (await response.json()) as StatusBody };
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-api-v2-status-"));
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
      title: "Cleo's Journal",
      owner: { name: "Cleo Traveller", nickname: "Cleo", email: OWNER_EMAIL },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features: { auth: { enabled: true } },
    }),
  );
  writeTrip("owner-only-trip");
  writeTrip("shared-trip", [BUDDY]);
  writeDraft("shared-trip", "arrival");

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

describe("GET /api/v2/status", () => {
  test("answers with no journal and no auth", async () => {
    const { status, body } = await instanceStatus();
    expect(status).toBe(200);
    expect(body.capabilities).toBeTruthy();
    expect((body.limits as Record<string, unknown>).imageMaxEdge).toBeGreaterThan(0);
    expect((body.media as Record<string, unknown>).kinds).toEqual(
      expect.arrayContaining(["photo", "bank_export", "gps_history", "document"]),
    );
    expect(body.pricing).toBeTruthy();
  });
});

describe("GET /api/v2/{user}/status", () => {
  test("the owner sees every trip and every draft", async () => {
    const { status, body } = await journalStatus(await ownerToken());
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.journal).toBe(OWNER);
    const trips = (body.trips as { id: string }[]).map((t) => t.id).sort();
    expect(trips).toEqual(["owner-only-trip", "shared-trip"]);
    const drafts = body.drafts as { trip: string; slug: string }[];
    expect(drafts).toEqual([{ trip: "shared-trip", slug: "arrival" }]);
    expect((body.token as { scope: string }).scope).toBe("owner");
  });

  test("a trip-scoped token sees only its own trip and that trip's drafts", async () => {
    const token = await tripToken(BUDDY, "shared-trip");
    const { status, body } = await journalStatus(token);
    expect(status, JSON.stringify(body)).toBe(200);
    const trips = (body.trips as { id: string }[]).map((t) => t.id);
    expect(trips).toEqual(["shared-trip"]);
    const drafts = body.drafts as { trip: string; slug: string }[];
    expect(drafts).toEqual([{ trip: "shared-trip", slug: "arrival" }]);
    expect((body.token as { scope: string; trip?: string }).scope).toBe("trip");
    expect((body.token as { scope: string; trip?: string }).trip).toBe("shared-trip");
  });

  test("refuses a token for a different journal", async () => {
    const { status, body } = await journalStatus("not-a-real-token");
    expect(status).toBe(401);
    expect(body.error).toBe("invalid_token");
  });
});

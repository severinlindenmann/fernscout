import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

/**
 * An anonymous caller must not be able to tell a journal that exists from one
 * that does not — B1615.
 *
 * The v2 routes originally resolved the journal before authenticating, so
 * `GET /api/v2/nosuchname/trips/x` answered `404 no_such_journal` while
 * `GET /api/v2/example/trips/x` answered `401 missing_token`. Two different
 * answers to a caller holding nothing is a username oracle, and v1 never had
 * one: its routes authenticated first.
 *
 * It matters more here than the usual enumeration finding for two reasons.
 * A username is a directory name and a public URL segment, and trip ids are
 * chosen by hand and guessable on purpose — the design accepts that and
 * compensates with the trip gate (B117: a closed trip's sign-in page does not
 * even name the trip), which an enumeration door undercuts. And `guest`
 * journals exist precisely so an instance does not advertise them; a route
 * that answers for one is advertising it.
 *
 * The shape of this test is the whole point: two requests, one real username
 * and one invented, no credential on either, and the answers must be
 * identical. It is deliberately not a test about any one route — a new route
 * under `app/api/v2/**` that gets the order wrong is exactly what this is
 * here to catch, so the list below is meant to grow.
 */

const REAL = "ana";
const INVENTED = "nosuchjournal";
const ANON = { headers: {} };

let dir: string;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-api-v2-enum-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.SESSION_SECRET = "88".repeat(32);
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test" },
      users: { reserved: [] },
      features: { auth: { enabled: true }, mail: { enabled: true, transport: "file" } },
    }),
  );

  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  const { migrateToLatest } = await import("@/lib/db/migrate");
  const { getDatabase } = await import("@/lib/db");
  const { createJournal } = await import("@/lib/journals");
  clearConfigCache();
  clearUserCache();
  await migrateToLatest(await getDatabase());
  const created = createJournal({
    username: REAL,
    title: "Two Backpacks",
    ownerEmail: "ana@example.test",
    ownerName: "Ana Traveller",
    ownerNickname: "Ana",
  });
  if (!created.ok) throw new Error(created.message);
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

async function statusAndBody(handler: () => Promise<Response>) {
  const response = await handler();
  const body = await response.json().catch(() => null);
  return { status: response.status, error: (body as { error?: string } | null)?.error };
}

describe("an unauthenticated caller cannot tell a real journal from an invented one", () => {
  test("GET /api/v2/{user}", async () => {
    const { GET } = await import("@/app/api/v2/[user]/route");
    const real = await statusAndBody(() =>
      GET(new Request("http://t/api/v2/example", ANON), { params: Promise.resolve({ user: REAL }) }),
    );
    const fake = await statusAndBody(() =>
      GET(new Request("http://t/api/v2/nosuchjournal", ANON), {
        params: Promise.resolve({ user: INVENTED }),
      }),
    );
    expect(fake).toEqual(real);
    expect(real.status).toBe(401);
  });

  test("GET /api/v2/{user}/status", async () => {
    const { GET } = await import("@/app/api/v2/[user]/status/route");
    const real = await statusAndBody(() =>
      GET(new Request("http://t/api/v2/example/status", ANON), {
        params: Promise.resolve({ user: REAL }),
      }),
    );
    const fake = await statusAndBody(() =>
      GET(new Request("http://t/api/v2/nosuchjournal/status", ANON), {
        params: Promise.resolve({ user: INVENTED }),
      }),
    );
    expect(fake).toEqual(real);
    expect(real.status).toBe(401);
  });

  test("GET /api/v2/{user}/trips", async () => {
    const { GET } = await import("@/app/api/v2/[user]/trips/route");
    const real = await statusAndBody(() =>
      GET(new Request("http://t/api/v2/example/trips", ANON), {
        params: Promise.resolve({ user: REAL }),
      }),
    );
    const fake = await statusAndBody(() =>
      GET(new Request("http://t/api/v2/nosuchjournal/trips", ANON), {
        params: Promise.resolve({ user: INVENTED }),
      }),
    );
    expect(fake).toEqual(real);
    expect(real.status).toBe(401);
  });

  test("GET /api/v2/{user}/trips/{trip}", async () => {
    const { GET } = await import("@/app/api/v2/[user]/trips/[trip]/route");
    const real = await statusAndBody(() =>
      GET(new Request("http://t/api/v2/example/trips/whatever", ANON), {
        params: Promise.resolve({ user: REAL, trip: "whatever" }),
      }),
    );
    const fake = await statusAndBody(() =>
      GET(new Request("http://t/api/v2/nosuchjournal/trips/whatever", ANON), {
        params: Promise.resolve({ user: INVENTED, trip: "whatever" }),
      }),
    );
    expect(fake).toEqual(real);
    expect(real.status).toBe(401);
  });
});

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { issueCode, verifyCode, tripWriteScope } from "@/lib/auth";
import { GET as getRoute, PUT as putRoute } from "@/app/api/v1/[user]/trips/[trip]/plan/route";

/**
 * B909 — a plan door: an upcoming trip's route could only ever be written by
 * hand, over SSH or through the `add-a-trip` skill on a local checkout.
 * These tests hold the ticket's own decisions:
 *
 *  - GET and PUT both work over REST, and nothing else does (see the route's
 *    own module, which exports only those two);
 *  - a stop missing a real coordinate is refused by name, not silently
 *    dropped;
 *  - a trip-scoped token — somebody on the trip, not its owner — reads and
 *    writes the route, but never sees a draft-derived stop; the owner does.
 */

let dir: string;
const REF = "alex/reise";
const OWNER_EMAIL = "alex@example.test";
const ROBIN_EMAIL = "robin@example.test";

function tripFile(name: string): string {
  return path.join(dir, "alex", "trips", "reise", name);
}

function writeTrip(peopleEmails: string[] = []) {
  fs.mkdirSync(path.join(dir, "alex", "trips", "reise", "entries"), { recursive: true });
  fs.writeFileSync(
    tripFile("trip.md"),
    [
      "---",
      "id: reise",
      'title: "Reise"',
      'start: "2026-09-01"',
      'end: "2026-09-05"',
      "status: upcoming",
      "visibility: public",
      ...(peopleEmails.length > 0
        ? ["people:", ...peopleEmails.map((e) => `  - { name: "Robin", email: "${e}" }`)]
        : []),
      "---",
      "",
      "Body.",
      "",
    ].join("\n"),
  );
}

async function ownerToken(): Promise<string> {
  const { code } = await issueCode("alex", OWNER_EMAIL, "agent");
  const verified = await verifyCode("alex", OWNER_EMAIL, code, "agent");
  if (!verified.ok) throw new Error(`could not mint an owner token: ${verified.reason}`);
  return verified.token;
}

async function tripScopedToken(): Promise<string> {
  const { code } = await issueCode("alex", ROBIN_EMAIL, "agent");
  const verified = await verifyCode("alex", ROBIN_EMAIL, code, "agent", tripWriteScope("reise"));
  if (!verified.ok) throw new Error(`could not mint a trip-scoped token: ${verified.reason}`);
  return verified.token;
}

async function call(
  route: typeof getRoute | typeof putRoute,
  method: string,
  token: string,
  body?: unknown,
) {
  const response = await route(
    new Request("https://t.test/api/v1/alex/trips/reise/plan", {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
    { params: Promise.resolve({ user: "alex", trip: "reise" }) },
  );
  const parsed = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status, body: parsed };
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-plan-api-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "plan-api-test-secret-plan-api-test";
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      features: { auth: { enabled: true } },
    }),
  );
  fs.mkdirSync(path.join(dir, "alex"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "Alex",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: OWNER_EMAIL },
      baseCurrency: "CHF",
    }),
  );
  writeTrip();
  clearConfigCache();
  clearUserCache();
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("GET .../plan", () => {
  test("no plan.md yet reads back as absent, not an error", async () => {
    const token = await ownerToken();
    const { status, body } = await call(getRoute, "GET", token);
    expect(status).toBe(200);
    expect(body).toMatchObject({ exists: false, stops: [], reachedCount: 0, next: null });
  });

  test("reads back a route already on disk", async () => {
    fs.writeFileSync(
      tripFile("plan.md"),
      [
        "---",
        "route:",
        '  - { location: "Fukuoka", country: "Japan", countryCode: "JP", lat: 33.5904, lng: 130.4017 }',
        "---",
        "",
        "South to north.",
        "",
      ].join("\n"),
    );
    const token = await ownerToken();
    const { status, body } = await call(getRoute, "GET", token);
    expect(status).toBe(200);
    expect(body.exists).toBe(true);
    expect((body.stops as unknown[]).length).toBe(1);
    expect(body.body).toBe("South to north.");
  });
});

describe("PUT .../plan", () => {
  test("creates plan.md, and it reads back as written", async () => {
    const token = await ownerToken();
    const { status, body } = await call(putRoute, "PUT", token, {
      route: [
        { location: "Fukuoka", country: "Japan", countryCode: "JP", lat: 33.5904, lng: 130.4017 },
        { location: "Tokyo", country: "Japan", countryCode: "JP", lat: 35.6762, lng: 139.6503, note: "A week" },
      ],
      body: "South to north.",
    });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);

    const read = await call(getRoute, "GET", token);
    expect((read.body.stops as { location: string }[]).map((s) => s.location)).toEqual(["Fukuoka", "Tokyo"]);
    expect(read.body.body).toBe("South to north.");
  });

  test("a stop with no coordinate is refused by name, and nothing is written", async () => {
    const token = await ownerToken();
    const { status, body } = await call(putRoute, "PUT", token, {
      route: [{ location: "Nowhere" }],
    });
    expect(status).toBe(400);
    expect(body.error).toBe("invalid_plan");
    const problems = body.problems as { field: string }[];
    expect(problems.some((p) => p.field === "route[0].lat")).toBe(true);
    expect(problems.some((p) => p.field === "route[0].lng")).toBe(true);
    expect(fs.existsSync(tripFile("plan.md"))).toBe(false);
  });

  test("a field this endpoint does not write is refused whole", async () => {
    const token = await ownerToken();
    const { status, body } = await call(putRoute, "PUT", token, {
      route: [],
      status: "current",
    });
    expect(status).toBe(400);
    expect(body.error).toBe("unsupported_field");
  });

  test("an out-of-range coordinate is refused by name", async () => {
    const token = await ownerToken();
    const { status, body } = await call(putRoute, "PUT", token, {
      route: [{ location: "Somewhere", lat: 200, lng: 10 }],
    });
    expect(status).toBe(400);
    const problems = body.problems as { field: string }[];
    expect(problems.some((p) => p.field === "route[0].lat")).toBe(true);
  });
});

describe("draft-derived stops stay owner-only", () => {
  beforeEach(() => {
    writeTrip([ROBIN_EMAIL]);
    // A future-dated draft with coordinates — the kind of stop `getPlan`
    // folds in for `includeDrafts: true`.
    fs.writeFileSync(
      tripFile("entries/2099-01-01-somewhere-next.md"),
      [
        "---",
        'title: "Somewhere next"',
        'date: "2099-01-01"',
        "status: draft",
        "location: Osaka",
        "country: Japan",
        "lat: 34.6937",
        "lng: 135.5023",
        "---",
        "",
        "Body.",
        "",
      ].join("\n"),
    );
  });

  test("the owner sees the draft-derived stop, and draftsIncluded says so", async () => {
    const token = await ownerToken();
    const { status, body } = await call(getRoute, "GET", token);
    expect(status).toBe(200);
    expect(body.draftsIncluded).toBe(true);
    expect((body.stops as { location: string }[]).some((s) => s.location === "Osaka")).toBe(true);
  });

  test("a trip-scoped token reads and writes the trip's plan, but never the draft stop", async () => {
    const token = await tripScopedToken();
    const { status, body } = await call(getRoute, "GET", token);
    expect(status).toBe(200);
    expect(body.draftsIncluded).toBe(false);
    expect((body.stops as { location: string }[]).some((s) => s.location === "Osaka")).toBe(false);

    const written = await call(putRoute, "PUT", token, {
      route: [{ location: "Kyoto", country: "Japan", lat: 35.0116, lng: 135.7681 }],
    });
    expect(written.status).toBe(200);
  });
});

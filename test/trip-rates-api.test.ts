import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { issueCode, verifyCode } from "@/lib/auth";
import { tripWriteScope } from "@/lib/tripPeople";
import { getCostSummary } from "@/lib/costs";
import { getTrip } from "@/lib/trips";
import { GET as getRoute, PATCH as patchRoute } from "@/app/api/v1/[user]/trips/[trip]/rates/route";

/**
 * B352 — a trip's rates could not be set after it was created, but the
 * costs page told the owner to edit trip.md.
 *
 * `createTrip` (lib/tripWrite.ts) could only ever write `rates:` once, at
 * the moment the folder was made — `PATCH /api/v1/<user>/trips/<trip>`
 * answers `method_not_allowed`, and there is no shell on a hosted instance.
 * This is the door that opened: `PATCH .../trips/<trip>/rates`, merging
 * into whatever is already there rather than replacing the whole table.
 */

let dir: string;
const REF = "alex/reise";
const OWNER_EMAIL = "alex@example.test";

function tripFile(name: string): string {
  return path.join(dir, "alex", "trips", "reise", name);
}

function writeTrip(front: string[] = []) {
  fs.mkdirSync(path.join(dir, "alex", "trips", "reise", "entries"), { recursive: true });
  fs.writeFileSync(
    tripFile("trip.md"),
    [
      "---",
      "id: reise",
      'title: "Reise"',
      'start: "2026-09-01"',
      'end: "2026-09-05"',
      "status: current",
      "visibility: public",
      ...front,
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
  if (!verified.ok) throw new Error(`could not mint a token: ${verified.reason}`);
  return verified.token;
}

/** What somebody listed in a trip's `people:` gets from /api/auth/request. */
async function scopedToken(email: string): Promise<string> {
  const { code } = await issueCode("alex", email, "agent", { trip: "reise" });
  const session = await verifyCode("alex", email, code, "agent", tripWriteScope("reise"));
  if (!session.ok) throw new Error(`could not mint a trip token: ${session.reason}`);
  return session.token;
}

async function call(
  route: typeof getRoute | typeof patchRoute,
  method: string,
  token: string,
  body?: unknown,
) {
  const response = await route(
    new Request("https://t.test/api/v1/alex/trips/reise/rates", {
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-trip-rates-api-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "trip-rates-api-test-secret-trip-rates";
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

describe("GET .../rates", () => {
  test("a trip written without rates: reads back empty, not an error", async () => {
    const token = await ownerToken();
    const { status, body } = await call(getRoute, "GET", token);
    expect(status).toBe(200);
    expect(body).toEqual({ trip: REF, rates: {} });
  });

  test("reads back what is already in trip.md", async () => {
    writeTrip(["rates:", "  EUR: 0.94"]);
    const token = await ownerToken();
    const { body } = await call(getRoute, "GET", token);
    expect(body.rates).toEqual({ EUR: 0.94 });
  });
});

describe("PATCH .../rates", () => {
  test("fills in a missing rate, and the costs page converts with it afterwards", async () => {
    fs.mkdirSync(path.join(dir, "alex", "trips", "reise", "entries"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "alex", "trips", "reise", "entries", "2026-09-02-dinner.md"),
      [
        "---",
        'title: "Dinner"',
        'date: "2026-09-02"',
        'location: "Vienna"',
        "costs:",
        '  - { label: "Dinner", amount: 80, currency: "EUR", category: "food" }',
        "---",
        "",
        "A day.",
        "",
      ].join("\n"),
    );

    expect(getCostSummary(REF).unconverted).toEqual([{ currency: "EUR", amount: 80, count: 1 }]);

    const token = await ownerToken();
    const { status, body } = await call(patchRoute, "PATCH", token, { rates: { EUR: 0.94 } });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.rates).toEqual({ EUR: 0.94 });

    expect(getTrip(REF)!.rates).toEqual({ EUR: 0.94 });
    const summary = getCostSummary(REF);
    expect(summary.unconverted).toEqual([]);
    expect(summary.total).toBeCloseTo(80 * 0.94, 9);
  });

  test("merges rather than replaces — an existing rate survives a call that names another", async () => {
    writeTrip(["rates:", "  EUR: 0.94"]);
    const token = await ownerToken();
    const { status, body } = await call(patchRoute, "PATCH", token, { rates: { THB: 0.0245 } });
    expect(status).toBe(200);
    expect(body.rates).toEqual({ EUR: 0.94, THB: 0.0245 });
    expect(getTrip(REF)!.rates).toEqual({ EUR: 0.94, THB: 0.0245 });
  });

  test("a negative rate is refused with a sentence, and nothing is written", async () => {
    const token = await ownerToken();
    const { status, body } = await call(patchRoute, "PATCH", token, { rates: { EUR: -1 } });
    expect(status).toBe(400);
    expect(body.error).toBe("invalid_rates");
    expect(getTrip(REF)!.rates).toEqual({});
  });

  test("an empty body is refused rather than a no-op success", async () => {
    const token = await ownerToken();
    const { status, body } = await call(patchRoute, "PATCH", token, { rates: {} });
    expect(status).toBe(400);
    expect(body.error).toBe("invalid_rates");
  });

  test("a trip-scoped token — someone on the trip, not its owner — is refused", async () => {
    const token = await scopedToken("guest@example.test");
    const { status, body } = await call(patchRoute, "PATCH", token, { rates: { EUR: 0.94 } });
    expect(status).toBe(403);
    expect(body.error).toBe("out_of_scope");
    expect(getTrip(REF)!.rates).toEqual({});
  });

  test("a trip-scoped token cannot even read the rate table", async () => {
    const token = await scopedToken("guest@example.test");
    const { status } = await call(getRoute, "GET", token);
    expect(status).toBe(403);
  });
});

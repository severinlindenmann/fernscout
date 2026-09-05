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
import { getTrip } from "@/lib/trips";
import { GET as getRoute, PATCH as patchRoute } from "@/app/api/v1/[user]/trips/[trip]/visibility/route";

/**
 * B396 — a trip's visibility could not be changed after it was created, but
 * the contacts page told an owner with no `guest` trip to "set a trip's
 * visibility to guest". `PATCH .../trips/<trip>` answers `method_not_allowed`
 * and there is no shell on a hosted instance. This is the door that opened:
 * `PATCH .../trips/<trip>/visibility`, built the way B352 built `.../rates`.
 */

let dir: string;
const REF = "alex/reise";
const OWNER_EMAIL = "alex@example.test";

function tripFile(name: string): string {
  return path.join(dir, "alex", "trips", "reise", name);
}

function writeTrip(front: string[] = ["visibility: private"]) {
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
    new Request("https://t.test/api/v1/alex/trips/reise/visibility", {
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-trip-visibility-api-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "trip-visibility-api-test-secret-trip-vis";
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

describe("GET .../visibility", () => {
  test("reads back what is in trip.md", async () => {
    const token = await ownerToken();
    const { status, body } = await call(getRoute, "GET", token);
    expect(status).toBe(200);
    expect(body).toEqual({ trip: REF, visibility: "private", listed: false });
  });

  test("a trip-scoped token cannot even read it", async () => {
    const token = await scopedToken("guest@example.test");
    const { status, body } = await call(getRoute, "GET", token);
    expect(status).toBe(403);
    expect(body.error).toBe("out_of_scope");
  });
});

describe("PATCH .../visibility", () => {
  test("the owner can widen a private trip to guest, and is told what that means", async () => {
    const token = await ownerToken();
    const { status, body } = await call(patchRoute, "PATCH", token, { visibility: "guest" });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.visibility).toBe("guest");
    expect(String(body.note)).toMatch(/widens who may read/);
    expect(getTrip(REF)!.visibility).toBe("guest");
  });

  test("the owner can narrow a public trip to private, with no widening warning", async () => {
    writeTrip(["visibility: public"]);
    const token = await ownerToken();
    const { status, body } = await call(patchRoute, "PATCH", token, { visibility: "private" });
    expect(status).toBe(200);
    expect(body.visibility).toBe("private");
    expect(String(body.note)).not.toMatch(/widens who may read/);
    expect(getTrip(REF)!.visibility).toBe("private");
    expect(getTrip(REF)!.listed).toBe(false);
  });

  test("an unrecognised visibility is refused, not written and read back as private", async () => {
    const token = await ownerToken();
    const { status, body } = await call(patchRoute, "PATCH", token, { visibility: "publik" });
    expect(status).toBe(400);
    expect(body.error).toBe("invalid_visibility");
    expect(getTrip(REF)!.visibility).toBe("private");
  });

  test("listed: true is refused on a trip whose new visibility does not advertise it", async () => {
    const token = await ownerToken();
    const { status, body } = await call(patchRoute, "PATCH", token, {
      visibility: "guest",
      listed: true,
    });
    expect(status).toBe(400);
    expect(body.error).toBe("invalid_listed");
    expect(getTrip(REF)!.visibility).toBe("private");
  });

  test("listed: true is accepted alongside visibility: public — B51 is satisfied, not violated", async () => {
    const token = await ownerToken();
    const { status, body } = await call(patchRoute, "PATCH", token, {
      visibility: "public",
      listed: true,
    });
    expect(status).toBe(200);
    expect(body.listed).toBe(true);
    expect(getTrip(REF)!.visibility).toBe("public");
    expect(getTrip(REF)!.listed).toBe(true);
  });

  test("narrowing visibility away from public drops a stale listed: true rather than leaving it inert", async () => {
    writeTrip(["visibility: public", "listed: true"]);
    const token = await ownerToken();
    const { status } = await call(patchRoute, "PATCH", token, { visibility: "guest" });
    expect(status).toBe(200);
    expect(getTrip(REF)!.visibility).toBe("guest");
    expect(getTrip(REF)!.listed).toBe(false);
    // And the file itself no longer carries a listed: line that would read
    // as inert — it should have moved off `true` entirely.
    const text = fs.readFileSync(tripFile("trip.md"), "utf8");
    expect(text).not.toMatch(/^listed: true$/m);
  });

  test("an empty body is refused rather than a no-op success", async () => {
    const token = await ownerToken();
    const { status, body } = await call(patchRoute, "PATCH", token, {});
    expect(status).toBe(400);
    expect(body.error).toBe("invalid_request");
  });

  test("a trip-scoped token — someone on the trip, not its owner — is refused", async () => {
    const token = await scopedToken("guest@example.test");
    const { status, body } = await call(patchRoute, "PATCH", token, { visibility: "public" });
    expect(status).toBe(403);
    expect(body.error).toBe("out_of_scope");
    expect(getTrip(REF)!.visibility).toBe("private");
  });
});

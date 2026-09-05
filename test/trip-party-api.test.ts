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
import {
  GET as getPeople,
  PATCH as patchPeople,
} from "@/app/api/v1/[user]/trips/[trip]/people/route";
import { PATCH as patchTravellers } from "@/app/api/v1/[user]/trips/[trip]/travellers/route";

/**
 * B524 — `people:` and `travellers:` could be written when a trip was created
 * and never again, so "my partner was on this trip too" had no answer but
 * deleting the trip and rewriting every day in it. These are the two doors,
 * built the way B396 built `.../visibility` and B352 built `.../rates`.
 */

let dir: string;
const REF = "alex/reise";
const OWNER_EMAIL = "alex@example.test";

function tripFile(): string {
  return path.join(dir, "alex", "trips", "reise", "trip.md");
}

function writeTrip(front: string[] = []) {
  fs.mkdirSync(path.join(dir, "alex", "trips", "reise", "entries"), { recursive: true });
  fs.writeFileSync(
    tripFile(),
    [
      "---",
      "id: reise",
      'title: "Reise"',
      'start: "2026-09-01"',
      'end: "2026-09-05"',
      "status: current",
      "visibility: private",
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

/** Both routes take the same two params, and TypeScript's `RouteContext` is
 * keyed by the literal path — so one helper needs the shape rather than either
 * route's own type. */
type PartyRoute = (
  request: Request,
  context: { params: Promise<{ user: string; trip: string }> },
) => Promise<Response>;

async function call(
  route: PartyRoute,
  method: string,
  token: string,
  body?: unknown,
) {
  const response = await route(
    new Request("https://t.test/api/v1/alex/trips/reise/people", {
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-trip-party-api-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "trip-party-api-test-secret-party-people";
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

describe("PATCH .../people", () => {
  test("adds somebody to a trip that was created without them, and says what that granted", async () => {
    const token = await ownerToken();
    const { status, body } = await call(patchPeople, "PATCH", token, {
      people: [{ name: "Ana Meyer", email: "ana@example.test" }],
    });
    expect(status).toBe(200);
    expect(body.added).toEqual(["ana@example.test"]);
    expect(String(body.note)).toMatch(/may now write/);
    expect(getTrip(REF)!.people.map((p) => p.email)).toEqual(["ana@example.test"]);
  });

  test("replaces rather than merges, and names who lost access", async () => {
    writeTrip(["people:", '  - name: "Ana Meyer"', '    email: "ana@example.test"']);
    const token = await ownerToken();
    const { status, body } = await call(patchPeople, "PATCH", token, {
      people: [{ name: "Bo Lind", email: "bo@example.test" }],
    });
    expect(status).toBe(200);
    expect(body.removed).toEqual(["ana@example.test"]);
    expect(getTrip(REF)!.people.map((p) => p.email)).toEqual(["bo@example.test"]);
    // Removing somebody does not silently revoke a token they hold, and the
    // response has to say so rather than let it be assumed.
    expect(String(body.note)).toMatch(/keeps working until it expires/);
  });

  test("an empty list clears the block instead of leaving a bare key", async () => {
    writeTrip(["people:", '  - name: "Ana Meyer"', '    email: "ana@example.test"']);
    const token = await ownerToken();
    const { status } = await call(patchPeople, "PATCH", token, { people: [] });
    expect(status).toBe(200);
    expect(getTrip(REF)!.people).toEqual([]);
    expect(fs.readFileSync(tripFile(), "utf8")).not.toMatch(/^people:/m);
  });

  test("a malformed entry is refused and trip.md is left byte-identical", async () => {
    const before = fs.readFileSync(tripFile(), "utf8");
    const token = await ownerToken();
    const { status, body } = await call(patchPeople, "PATCH", token, {
      people: [{ name: "Ana Meyer", email: "not-an-address" }],
    });
    expect(status).toBe(400);
    expect(body.error).toBe("invalid_people");
    expect(fs.readFileSync(tripFile(), "utf8")).toBe(before);
  });

  test("a trip-scoped token cannot change who else may write", async () => {
    const token = await scopedToken("bo@example.test");
    const { status, body } = await call(patchPeople, "PATCH", token, {
      people: [{ name: "Bo Lind", email: "bo@example.test" }],
    });
    expect(status).toBe(403);
    expect(body.error).toBe("out_of_scope");
    expect(getTrip(REF)!.people).toEqual([]);
  });

  test("GET reads back the file's own list", async () => {
    writeTrip(["people:", '  - name: "Ana Meyer"', '    email: "ana@example.test"']);
    const token = await ownerToken();
    const { status, body } = await call(getPeople, "GET", token);
    expect(status).toBe(200);
    expect(body.trip).toBe(REF);
    expect((body.people as { email: string }[]).map((p) => p.email)).toEqual([
      "ana@example.test",
    ]);
  });
});

describe("PATCH .../travellers", () => {
  test("draws a party onto a trip created without one", async () => {
    const token = await ownerToken();
    const { status, body } = await call(patchTravellers, "PATCH", token, {
      travellers: [{ skin: "medium", hair: "black", hairStyle: "coils" }],
    });
    expect(status).toBe(200);
    expect(getTrip(REF)!.travellers).toHaveLength(1);
    expect(getTrip(REF)!.travellers[0].hairStyle).toBe("coils");
    // Cosmetic, and the response says so — nothing about access changed.
    expect(String(body.note)).toMatch(/Nothing about who may read or write/);
  });

  test("an invented attribute is refused rather than drawn as a default", async () => {
    const before = fs.readFileSync(tripFile(), "utf8");
    const token = await ownerToken();
    const { status, body } = await call(patchTravellers, "PATCH", token, {
      travellers: [{ hair: "aubergine" }],
    });
    expect(status).toBe(400);
    expect(body.error).toBe("invalid_travellers");
    expect(fs.readFileSync(tripFile(), "utf8")).toBe(before);
  });

  test("changing the party leaves the prose and every other field alone", async () => {
    const token = await ownerToken();
    await call(patchTravellers, "PATCH", token, { travellers: [{ skin: "deep" }] });
    const text = fs.readFileSync(tripFile(), "utf8");
    expect(text).toMatch(/^title: "Reise"$/m);
    expect(text).toMatch(/^visibility: private$/m);
    expect(text.trimEnd().endsWith("Body.")).toBe(true);
  });

  test("a body that names neither field is refused with the shape to send", async () => {
    const token = await ownerToken();
    const { status, body } = await call(patchTravellers, "PATCH", token, { figures: [] });
    expect(status).toBe(400);
    expect(String(body.message)).toMatch(/travellers/);
  });
});

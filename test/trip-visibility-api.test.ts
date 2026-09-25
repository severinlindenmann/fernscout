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

/**
 * B396 (visibility) / B587 (teaser) / B51 (listed) — a trip's visibility
 * could not be changed after it was created.
 *
 * B1612 repoint: v1's `.../visibility` route is deleted; `visibility`,
 * `listed` and `teaser` are now plain fields of the one v2 trip document
 * (`PATCH /api/v2/{user}/trips/{trip}`) — no section of their own, no bespoke
 * error codes. Every refusal below comes back as `invalid_request` (v2's one
 * validation-failure code) rather than v1's `invalid_visibility`/
 * `invalid_listed`/`invalid_teaser`, since these are ordinary Zod issues on
 * the whole document rather than a route with its own hand-rolled checks. GET
 * is not owner-only in v2 (unlike v1's `.../visibility`, which refused a
 * trip-scoped token even a read); only PATCH is.
 */

let dir: string;
const OWNER_EMAIL = "alex@example.test";
const TRIP = "reise-v2";

async function ownerToken(): Promise<string> {
  const { code } = await issueCode("alex", OWNER_EMAIL, "agent");
  const verified = await verifyCode("alex", OWNER_EMAIL, code, "agent");
  if (!verified.ok) throw new Error(`could not mint a token: ${verified.reason}`);
  return verified.token;
}

async function scopedToken(email: string): Promise<string> {
  const { code } = await issueCode("alex", email, "agent", { trip: TRIP });
  const session = await verifyCode("alex", email, code, "agent", tripWriteScope(TRIP));
  if (!session.ok) throw new Error(`could not mint a trip token: ${session.reason}`);
  return session.token;
}

function fullTrip(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: TRIP,
    title: "Reise",
    dates: { from: "2026-09-01", to: "2026-09-05" },
    visibility: "private",
    people: [{ name: "Alex", email: OWNER_EMAIL }],
    teaser: true,
    declined: {
      rates: "no foreign currency tracked on this trip at all",
      costs: "no budget tracked for this trip currently",
      plan: "no planned route recorded for this trip",
      days: "no days written for this trip at create time",
      translations: "single-language journal, nothing to translate",
      accent: "default accent left as the renderer's choice",
      figures: "no walking figures drawn for this trip",
      tagline: "no one-line subtitle written for this trip",
      intro: "no opening prose written for this trip yet",
    },
    ...overrides,
  };
}

async function putTrip(body: unknown, token: string) {
  const { PUT } = await import("@/app/api/v2/[user]/trips/[trip]/route");
  const response = await PUT(
    new Request(`https://t.test/api/v2/alex/trips/${TRIP}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user: "alex", trip: TRIP }) },
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function patchTrip(body: unknown, token: string) {
  const { PATCH } = await import("@/app/api/v2/[user]/trips/[trip]/route");
  const response = await PATCH(
    new Request(`https://t.test/api/v2/alex/trips/${TRIP}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user: "alex", trip: TRIP }) },
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function getTrip(token: string) {
  const { GET } = await import("@/app/api/v2/[user]/trips/[trip]/route");
  const response = await GET(
    new Request(`https://t.test/api/v2/alex/trips/${TRIP}`, {
      headers: { authorization: `Bearer ${token}` },
    }),
    { params: Promise.resolve({ user: "alex", trip: TRIP }) },
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
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

describe("GET the visibility fields, through the trip document", () => {
  test("reads back what was created", async () => {
    const token = await ownerToken();
    await putTrip(fullTrip(), token);
    const { status, body } = await getTrip(token);
    expect(status).toBe(200);
    expect(body.visibility).toBe("private");
    expect(body.teaser).toBe(true);
    expect(body.listed).toBeUndefined();
  });

  test("a trip-scoped token may still read it — GET is not owner-only in v2", async () => {
    const owner = await ownerToken();
    await putTrip(fullTrip(), owner);
    const scoped = await scopedToken("guest@example.test");
    const { status } = await getTrip(scoped);
    expect(status).toBe(200);
  });
});

describe("PATCH the visibility fields, through the trip document", () => {
  test("the owner widens a private trip to guest", async () => {
    const token = await ownerToken();
    await putTrip(fullTrip(), token);
    const { status, body } = await patchTrip({ visibility: "guest" }, token);
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.visibility).toBe("guest");

    const { body: onDisk } = await getTrip(token);
    expect(onDisk.visibility).toBe("guest");
  });

  /**
   * B1616 — v1's `.../visibility` route special-cased this: narrowing away
   * from `public` dropped a stale `listed` (and `teaser`) rather than
   * leaving it to conflict with the new value. Folding that route into the
   * trip document (B1612) had dropped the special-casing along with it: a
   * public trip's stored `listed` (every public trip has one,
   * required-or-declined at create) survived a `PATCH {visibility:
   * "private"}` merge and collided with `tripCreate`'s own "a closed trip is
   * never advertised, remove listed" refusal, permanently — merge-patch has
   * no way to un-send a key by omitting it. `reconcileVisibility`
   * (`lib/api/v2/write.ts`) is the route now dropping the question that
   * stopped applying, the same job the old dedicated route did.
   */
  test("the owner narrows a public trip to private", async () => {
    const token = await ownerToken();
    await putTrip(fullTrip({ visibility: "public", teaser: undefined, listed: false }), token);
    const { status, body } = await patchTrip({ visibility: "private", teaser: false }, token);
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.visibility).toBe("private");
    expect(body.teaser).toBe(false);
    expect(body.listed).toBeUndefined();

    const { body: onDisk } = await getTrip(token);
    expect(onDisk.visibility).toBe("private");
    expect(onDisk.listed).toBeUndefined();
  });

  test("the owner widens a closed trip back to public — the mirror of narrowing", async () => {
    const token = await ownerToken();
    await putTrip(fullTrip(), token); // private, teaser: true, no listed
    const { status, body } = await patchTrip({ visibility: "public", listed: true }, token);
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.visibility).toBe("public");
    expect(body.listed).toBe(true);
    expect(body.teaser).toBeUndefined();

    const { body: onDisk } = await getTrip(token);
    expect(onDisk.visibility).toBe("public");
    expect(onDisk.teaser).toBeUndefined();
  });

  test("an unrecognised visibility is refused, not written", async () => {
    const token = await ownerToken();
    await putTrip(fullTrip(), token);
    const { status, body } = await patchTrip({ visibility: "publik" }, token);
    expect(status).toBe(400);
    expect(body.error).toBe("invalid_request");

    const { body: onDisk } = await getTrip(token);
    expect(onDisk.visibility).toBe("private");
  });

  test("listed: true is refused on a trip whose visibility does not advertise it", async () => {
    const token = await ownerToken();
    await putTrip(fullTrip(), token);
    const { status, body } = await patchTrip({ listed: true }, token);
    expect(status).toBe(400);
    expect(body.error).toBe("invalid_request");

    const { body: onDisk } = await getTrip(token);
    expect(onDisk.listed).toBeUndefined();
  });

  test("listed: true is accepted alongside visibility: public — B51 is satisfied, not violated", async () => {
    const token = await ownerToken();
    await putTrip(fullTrip({ visibility: "public", teaser: undefined, listed: false }), token);
    const { status, body } = await patchTrip({ listed: true }, token);
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.listed).toBe(true);

    const { body: onDisk } = await getTrip(token);
    expect(onDisk.listed).toBe(true);
  });

  test("teaser: true is refused on a public trip, where there is nothing to tease", async () => {
    const token = await ownerToken();
    await putTrip(fullTrip({ visibility: "public", teaser: undefined, listed: false }), token);
    const { status, body } = await patchTrip({ teaser: true }, token);
    expect(status).toBe(400);
    expect(body.error).toBe("invalid_request");
  });

  test("a trip-scoped token — someone on the trip, not its owner — cannot patch visibility at all", async () => {
    const owner = await ownerToken();
    await putTrip(fullTrip(), owner);
    const scoped = await scopedToken("guest@example.test");
    const { status, body } = await patchTrip({ visibility: "public" }, scoped);
    expect(status).toBe(403);
    expect(body.error).toBe("forbidden");

    const { body: onDisk } = await getTrip(owner);
    expect(onDisk.visibility).toBe("private");
  });
});

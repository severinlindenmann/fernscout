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
import { PATCH as patchTravellers } from "@/app/api/v1/[user]/trips/[trip]/travellers/route";

/**
 * B524 — `people:` and `travellers:` could be written when a trip was created
 * and never again, so "my partner was on this trip too" had no answer but
 * deleting the trip and rewriting every day in it. These are the two doors,
 * built the way B396 built `.../visibility` and B352 built `.../rates`.
 *
 * B1612 repoint: `people` is no longer a route of its own — it is a section
 * of the one v2 trip document (`PATCH /api/v2/{user}/trips/{trip}`), folded
 * in the way `.../visibility` and `.../rates` were. `travellers` was NOT
 * touched by that migration (v1's route is still standing, still working
 * against `trip.md`), so that half of this file is unchanged.
 *
 * What v2's fold changes, beyond the address:
 *  - the trip is a v2-native `trip.json` document (`lib/api/v2/store.ts`),
 *    not a `trip.md` — `getTrip()` (lib/trips.ts) cannot see it, so the
 *    document the route itself echoes is what verifies an effect here;
 *  - PATCHing the trip document is owner-only (`mayActAsOwner`) full stop —
 *    a trip-scoped token cannot reach it at all, not even to read, so the
 *    refusal is `forbidden` (403) rather than v1's `out_of_scope`;
 *  - v1's `added`/`removed`/`note` fields (English sentences about what a
 *    change granted) have no v2 equivalent — the response is the echoed
 *    document plus `notifications` (who was mailed), nothing narrated. Those
 *    specific wording assertions are dropped rather than faked;
 *  - `people` requires at least one entry (`z.array(person).min(1)`), so
 *    v1's "empty list clears the block" has no v2 equivalent either — an
 *    empty list is refused, which is the opposite property, asserted below;
 *  - growing a trip from solo to several people while it holds a `buddies`
 *    decline used to have NO way back through PATCH: nothing in `tripBase`
 *    ever supplies a real `buddies` field for `retractDeclines` to key on
 *    (trip.ts, `checkRequiredOrDeclined`'s bespoke buddies check), so a solo
 *    trip's declined buddies question could never be un-declined once
 *    people grew past one (B1616). `retractAnsweredDeclines`
 *    (`lib/api/v2/write.ts`) now clears it — see the describe block below.
 *    The trips the rest of this file builds start non-solo, so those tests
 *    do not depend on it either way.
 */

let dir: string;
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

async function scopedToken(email: string, tripId: string): Promise<string> {
  const { code } = await issueCode("alex", email, "agent", { trip: tripId });
  const session = await verifyCode("alex", email, code, "agent", tripWriteScope(tripId));
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

async function call(route: PartyRoute, method: string, token: string, body?: unknown) {
  const response = await route(
    new Request("https://t.test/api/v1/alex/trips/reise/travellers", {
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

/** A v2 trip document with every declinable answered, two people already on
 * it (so the buddies question is answered without ever being declined —
 * see the file banner on why that matters for these tests). */
function fullTrip(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    title: `Trip ${id}`,
    dates: { from: "2026-09-01", to: "2026-09-05" },
    visibility: "private",
    people: [
      { name: "Alex", email: OWNER_EMAIL },
      { name: "Bo Lind", email: "bo@example.test" },
    ],
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

async function putV2Trip(id: string, body: unknown, token: string) {
  const { PUT } = await import("@/app/api/v2/[user]/trips/[trip]/route");
  const response = await PUT(
    new Request(`https://t.test/api/v2/alex/trips/${id}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user: "alex", trip: id }) },
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function patchV2Trip(id: string, body: unknown, token: string) {
  const { PATCH } = await import("@/app/api/v2/[user]/trips/[trip]/route");
  const response = await PATCH(
    new Request(`https://t.test/api/v2/alex/trips/${id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user: "alex", trip: id }) },
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function getV2Trip(id: string, token: string) {
  const { GET } = await import("@/app/api/v2/[user]/trips/[trip]/route");
  const response = await GET(
    new Request(`https://t.test/api/v2/alex/trips/${id}`, {
      headers: { authorization: `Bearer ${token}` },
    }),
    { params: Promise.resolve({ user: "alex", trip: id }) },
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
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
      features: { auth: { enabled: true }, mail: { enabled: true, transport: "file" } },
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

describe("PATCH /api/v2/{user}/trips/{trip} — the people section", () => {
  test("adds somebody, and the person is mailed", async () => {
    const token = await ownerToken();
    await putV2Trip("reise-v2", fullTrip("reise-v2"), token);

    const { status, body } = await patchV2Trip(
      "reise-v2",
      { people: [{ name: "Alex", email: OWNER_EMAIL }, { name: "Bo Lind", email: "bo@example.test" }, { name: "Cami", email: "cami@example.test" }] },
      token,
    );
    expect(status, JSON.stringify(body)).toBe(200);
    expect((body.people as { email: string }[]).map((p) => p.email)).toEqual([
      OWNER_EMAIL,
      "bo@example.test",
      "cami@example.test",
    ]);
    const notified = ((body.notifications as { email: string }[]) ?? []).map((n) => n.email);
    expect(notified).toContain("cami@example.test");
  });

  test("replaces rather than merges — dropping somebody drops them from the document", async () => {
    const token = await ownerToken();
    await putV2Trip("reise-v2", fullTrip("reise-v2"), token);

    const { status, body } = await patchV2Trip(
      "reise-v2",
      { people: [{ name: "Alex", email: OWNER_EMAIL }, { name: "Dev", email: "dev@example.test" }] },
      token,
    );
    expect(status, JSON.stringify(body)).toBe(200);
    expect((body.people as { email: string }[]).map((p) => p.email)).toEqual([
      OWNER_EMAIL,
      "dev@example.test",
    ]);

    const { body: onDisk } = await getV2Trip("reise-v2", token);
    expect((onDisk.people as { email: string }[]).map((p) => p.email)).toEqual([
      OWNER_EMAIL,
      "dev@example.test",
    ]);
  });

  test("an empty list is refused — a trip document always names at least one person", async () => {
    const token = await ownerToken();
    await putV2Trip("reise-v2", fullTrip("reise-v2"), token);

    const { status, body } = await patchV2Trip("reise-v2", { people: [] }, token);
    expect(status, JSON.stringify(body)).toBe(400);
  });

  test("a malformed entry is refused, and nothing on disk changes", async () => {
    const token = await ownerToken();
    await putV2Trip("reise-v2", fullTrip("reise-v2"), token);

    const { status, body } = await patchV2Trip(
      "reise-v2",
      { people: [{ name: "Alex", email: "not-an-address" }] },
      token,
    );
    expect(status).toBe(400);
    expect(body.error).toBe("invalid_request");

    const { body: unchanged } = await getV2Trip("reise-v2", token);
    expect((unchanged.people as { email: string }[]).map((p) => p.email)).toEqual([
      OWNER_EMAIL,
      "bo@example.test",
    ]);
  });

  test("a trip-scoped token cannot change who else may write — PATCHing the trip document is the owner's alone", async () => {
    const token = await ownerToken();
    await putV2Trip("reise-v2", fullTrip("reise-v2"), token);
    const scoped = await scopedToken("bo@example.test", "reise-v2");

    const { status, body } = await patchV2Trip(
      "reise-v2",
      { people: [{ name: "Alex", email: OWNER_EMAIL }, { name: "Bo Lind", email: "bo@example.test" }, { name: "Eve", email: "eve@example.test" }] },
      scoped,
    );
    expect(status).toBe(403);
    expect(body.error).toBe("forbidden");

    const { body: unchanged } = await getV2Trip("reise-v2", token);
    expect((unchanged.people as { email: string }[]).map((p) => p.email)).toEqual([
      OWNER_EMAIL,
      "bo@example.test",
    ]);
  });

  test("GET reads back the document's own list", async () => {
    const token = await ownerToken();
    await putV2Trip("reise-v2", fullTrip("reise-v2"), token);
    const { status, body } = await getV2Trip("reise-v2", token);
    expect(status).toBe(200);
    expect((body.people as { email: string }[]).map((p) => p.email)).toEqual([
      OWNER_EMAIL,
      "bo@example.test",
    ]);
  });

  /**
   * B1616 — a solo trip that declined buddies at create used to be stuck
   * that way forever: T6's plain name-match retraction never fires for
   * `buddies` because there is no `buddies` field to resupply, so the
   * stored decline outlived any later `people` growth and `tripCreate`'s
   * own superRefine then refused the merged document as claiming buddies
   * both ways. `retractAnsweredDeclines` (`lib/api/v2/write.ts`) is the
   * fix — it reads `people.length` instead of looking for a field named
   * `buddies`.
   */
  test("a solo trip's declined buddies is retracted once a second person is added", async () => {
    const token = await ownerToken();
    await putV2Trip(
      "reise-solo",
      fullTrip("reise-solo", {
        people: [{ name: "Alex", email: OWNER_EMAIL }],
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
          buddies: "travelling solo, nobody else was on this trip",
        },
      }),
      token,
    );

    const { status, body } = await patchV2Trip(
      "reise-solo",
      { people: [{ name: "Alex", email: OWNER_EMAIL }, { name: "Bo Lind", email: "bo@example.test" }] },
      token,
    );
    expect(status, JSON.stringify(body)).toBe(200);
    expect((body.declined as Record<string, string> | undefined)?.buddies).toBeUndefined();

    const { body: onDisk } = await getV2Trip("reise-solo", token);
    expect((onDisk.declined as Record<string, string> | undefined)?.buddies).toBeUndefined();
    expect((onDisk.people as { email: string }[]).map((p) => p.email)).toEqual([
      OWNER_EMAIL,
      "bo@example.test",
    ]);
  });

  test("a multi-person trip patched to also declare declined.buddies is still refused", async () => {
    const token = await ownerToken();
    await putV2Trip("reise-v2", fullTrip("reise-v2"), token); // already two people, no decline

    const { status, body } = await patchV2Trip(
      "reise-v2",
      { declined: { buddies: "travelling solo, nobody else was on this trip" } },
      token,
    );
    expect(status).toBe(400);
    expect(body.error).toBe("invalid_request");

    const { body: onDisk } = await getV2Trip("reise-v2", token);
    expect((onDisk.declined as Record<string, string> | undefined)?.buddies).toBeUndefined();
  });
});

describe("PATCH .../travellers", () => {
  const REF = "alex/reise";

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

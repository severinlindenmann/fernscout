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
import { writeTripFixture } from "./fixtures/content";

/**
 * B524 — `people:` and `travellers:` could be written when a trip was created
 * and never again, so "my partner was on this trip too" had no answer but
 * deleting the trip and rewriting every day in it. These are the two doors,
 * built the way B396 built `.../visibility` and B352 built `.../rates`.
 *
 * B1612 repoint: `people` is no longer a route of its own — it is a section
 * of the one v2 trip document (`PATCH /api/v2/{user}/trips/{trip}`), folded
 * in the way `.../visibility` and `.../rates` were.
 *
 * B1632 retired `travellers`'s own v1 route too (`.../trips/{trip}/
 * travellers`) — not folded onto the trip document the way `people` was,
 * but replaced outright by the figure library: a trip now says WHICH
 * figures walk (`figures: {mode: "custom", figures: [ids]}`, a section of
 * the same trip document), and each figure's actual appearance — the
 * `hairStyle`, `skin`, an invented attribute refused — lives on
 * `PUT /api/v2/{user}/figures/{id}` instead. That is a different shape, not
 * a renamed door, so the four "PATCH .../travellers" tests this file used
 * to carry are not repointed here; the same properties (draw a party,
 * refuse an invented attribute, leave the rest of the document alone) are
 * `test/api-v2-figures.test.ts`'s own coverage of the figure and its trip
 * reference.
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
 *    document, nothing narrated. Those specific wording assertions are
 *    dropped rather than faked;
 *  - `people` requires at least one entry (`z.array(person).min(1)`), so
 *    v1's "empty list clears the block" has no v2 equivalent either — an
 *    empty list is refused, which is the opposite property, asserted below;
 *  - B2297 (one door for readers, B2291/B2295) retired the whole `buddies`
 *    required-or-declined question this file used to carry a describe block
 *    about, and the mail `notifyNewPeople` used to send when `people` grew:
 *    `people:` is the byline only now, grants nothing, and mails nobody.
 *    Write access to a trip comes only from a buddy granted at
 *    `/<user>/studio/readers` (`trip_people`, not this document at all).
 */

let dir: string;
const OWNER_EMAIL = "alex@example.test";

function writeTrip() {
  writeTripFixture("alex", {
    id: "reise",
    title: "Reise",
    start: "2026-09-01",
    end: "2026-09-05",
    status: "current",
    visibility: "private",
    intro: "Body.",
  });
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

/** A v2 trip document with every declinable answered, two people on it. */
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
  test("adds somebody to the byline, and mails nobody", async () => {
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
    // B2297 — people: is the byline only; nothing about writing it mails
    // anybody, and the echo carries no `notifications` field any more.
    expect(body.notifications).toBeUndefined();
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
   * B2297 removed the `buddies` required-or-declined question this used to
   * exercise: a solo trip no longer needs to decline anything about who
   * else was there, because `people:` is a byline and grants nothing either
   * way. A trip of one creates cleanly, with no `declined.buddies` to send
   * or retract.
   */
  test("a solo trip creates cleanly, with no buddies question to answer", async () => {
    const token = await ownerToken();
    const { status, body } = await putV2Trip(
      "reise-solo",
      fullTrip("reise-solo", { people: [{ name: "Alex", email: OWNER_EMAIL }] }),
      token,
    );
    expect(status, JSON.stringify(body)).toBe(201);
    expect((body.declined as Record<string, string> | undefined)?.buddies).toBeUndefined();

    const { body: onDisk } = await getV2Trip("reise-solo", token);
    expect((onDisk.people as { email: string }[]).map((p) => p.email)).toEqual([OWNER_EMAIL]);
  });

  test("declined.buddies is refused outright — it is not a field any more", async () => {
    const token = await ownerToken();
    await putV2Trip("reise-v2", fullTrip("reise-v2"), token);

    const { status, body } = await patchV2Trip(
      "reise-v2",
      { declined: { buddies: "travelling solo, nobody else was on this trip" } },
      token,
    );
    expect(status).toBe(400);
    expect(body.error).toBe("invalid_request");
  });
});

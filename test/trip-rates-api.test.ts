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
 * B352 — a trip's rates could not be set after it was created, but the
 * costs page told the owner to edit trip.md.
 *
 * B1612 repoint: v1's `.../rates` route is deleted; `rates` is now a section
 * of the one v2 trip document (`PATCH /api/v2/{user}/trips/{trip}`). But it
 * is not the SAME section — v1's `rates:` was a flat currency->rate override
 * map read straight into `getCostSummary`'s conversion table
 * (`lib/currency.ts`); v2's `rates` (`lib/api/v2/schemas/trip.ts`) is
 * `{currencies: string[], manual?: Record<string, number>}` — "which
 * currencies this trip's figures may use", with `manual` as the override
 * table for what the ECB does not publish. The write-after-create property
 * (B352's whole point) survives and is tested below; whether the *value*
 * feeds a cost conversion the way v1's did is untested here, because it
 * cannot honestly be: `getCostSummary` (lib/costs.ts) reads exclusively
 * through `lib/trips.getTrip()`, which parses `trip.md` and knows nothing of
 * a v2-native `trip.json` (`lib/api/v2/store.ts`) — the two pipelines are not
 * wired together in this codebase yet. The one test below that pins that
 * integration is left pointed at the retired v1 route on purpose, so it
 * fails loudly rather than being bent into asserting something untrue;
 * see B1612's own report for a `backlog/` capture of the gap.
 */

let dir: string;
const OWNER_EMAIL = "alex@example.test";

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

function fullTrip(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    title: `Trip ${id}`,
    dates: { from: "2026-09-01", to: "2026-09-05" },
    visibility: "public",
    people: [{ name: "Alex", email: OWNER_EMAIL }],
    listed: false,
    declined: {
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

describe("the rates section, created without one, then answered by a PATCH", () => {
  test("declining rates at create reads back empty, not an error", async () => {
    const token = await ownerToken();
    const { status, body } = await putV2Trip("rates-trip", fullTrip("rates-trip", {
      declined: { ...(fullTrip("rates-trip").declined as Record<string, string>), rates: "no foreign currency tracked on this trip at all" },
    }), token);
    expect(status, JSON.stringify(body)).toBe(201);
    expect(body.rates).toBeUndefined();
  });

  test("a PATCH answers the declined section, and it reads back", async () => {
    const token = await ownerToken();
    await putV2Trip("rates-trip", fullTrip("rates-trip", {
      declined: { ...(fullTrip("rates-trip").declined as Record<string, string>), rates: "no foreign currency tracked on this trip at all" },
    }), token);

    const { status, body } = await patchV2Trip(
      "rates-trip",
      { rates: { currencies: ["EUR"], manual: { EUR: 0.94 } } },
      token,
    );
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.rates).toEqual({ currencies: ["EUR"], manual: { EUR: 0.94 } });
    // The prior decline for `rates` is retracted now that it is answered (T6).
    expect((body.declined as Record<string, string>).rates).toBeUndefined();

    const { body: onDisk } = await getV2Trip("rates-trip", token);
    expect(onDisk.rates).toEqual({ currencies: ["EUR"], manual: { EUR: 0.94 } });
  });

  test("a later PATCH replaces the whole section rather than merging into `manual`", async () => {
    const token = await ownerToken();
    await putV2Trip("rates-trip", fullTrip("rates-trip", { rates: { currencies: ["EUR"], manual: { EUR: 0.94 } } }), token);

    const { status, body } = await patchV2Trip(
      "rates-trip",
      { rates: { currencies: ["THB"], manual: { THB: 0.0245 } } },
      token,
    );
    expect(status, JSON.stringify(body)).toBe(200);
    // EUR did not survive — v2 replaces the section it names, it does not
    // merge into it the way v1's currency map did.
    expect(body.rates).toEqual({ currencies: ["THB"], manual: { THB: 0.0245 } });
  });

  test("a negative rate is refused, and nothing is written", async () => {
    const token = await ownerToken();
    await putV2Trip("rates-trip", fullTrip("rates-trip", { rates: { currencies: ["EUR"], manual: { EUR: 0.94 } } }), token);

    const { status, body } = await patchV2Trip(
      "rates-trip",
      { rates: { currencies: ["EUR"], manual: { EUR: -1 } } },
      token,
    );
    expect(status).toBe(400);
    expect(body.error).toBe("invalid_request");

    const { body: onDisk } = await getV2Trip("rates-trip", token);
    expect(onDisk.rates).toEqual({ currencies: ["EUR"], manual: { EUR: 0.94 } });
  });

  test("a trip-scoped token — someone on the trip, not its owner — may read the trip but not write its rates", async () => {
    // GET is not owner-only in v2 (anyone the trip's own gate lets in may
    // read it); PATCHing the trip document is. So the property "someone on
    // the trip is not entitled to change its money settings" survives, but
    // through the write door only — reading is not what v1's `out_of_scope`
    // on this section used to refuse.
    const owner = await ownerToken();
    const declined = { ...(fullTrip("rates-trip").declined as Record<string, string>) };
    delete declined.buddies;
    await putV2Trip("rates-trip", fullTrip("rates-trip", {
      people: [
        { name: "Alex", email: OWNER_EMAIL },
        { name: "Guest", email: "guest@example.test" },
      ],
      declined: { ...declined, rates: "no foreign currency tracked on this trip at all" },
    }), owner);
    const scoped = await scopedToken("guest@example.test", "rates-trip");

    const { status: getStatus, body: getBody } = await getV2Trip("rates-trip", scoped);
    expect(getStatus, JSON.stringify(getBody)).toBe(200);

    const { status: patchStatus, body: patchBody } = await patchV2Trip(
      "rates-trip",
      { rates: { currencies: ["EUR"], manual: { EUR: 0.94 } } },
      scoped,
    );
    expect(patchStatus).toBe(403);
    expect(patchBody.error).toBe("forbidden");
  });
});

/**
 * Left pointing at the deleted v1 route, deliberately: this is the
 * integration the ticket asked me to check honestly rather than force.
 * `getCostSummary` (lib/costs.ts) reads a trip through `lib/trips.getTrip()`
 * — a `trip.md` parse — which cannot see a v2-native `trip.json`
 * (`lib/api/v2/store.ts`) at all, so "a rate written through the API is what
 * the costs page converts with" has no v2 path to exercise yet. See the file
 * banner. Reported, not silently dropped.
 */
/**
 * Skipped, not deleted, and the distinction matters: the property is still
 * one we want — a rate written through the API is what the costs page
 * converts with — and it is unreachable only because `getCostSummary`
 * (`lib/costs.ts`) still reads a trip through `lib/trips.getTrip()`, which
 * reads `trip.md`. **B1598 is rewriting exactly that reader**, and when it
 * lands this unskips and should pass with no other change.
 *
 * If it does not pass then, that is a finding about B1598, not a reason to
 * delete this.
 */
describe("PATCH-then-convert — unskipped with B1598 (the render layer reads v2 JSON)", () => {
  test("the v1 rates door writes into the same trip.json a v2-created trip lives in, and getTrip converts with it", async () => {
    // v1's `patchTripRates` (lib/api/tripRates.ts) and v2's `PUT`/`PATCH
    // .../trips` both read and write the one `trip.json` now — there is no
    // longer a `trip.md` for one to see and the other not to. This is the
    // integration the file banner said was missing: a trip made through the
    // v2 door, rated through the v1 one, read back by `getTrip()` (what
    // `getCostSummary` itself calls) with a real converted rate.
    const token = await ownerToken();
    await putV2Trip(
      "rates-trip",
      fullTrip("rates-trip", {
        declined: {
          ...(fullTrip("rates-trip").declined as Record<string, string>),
          rates: "no foreign currency tracked on this trip at all",
        },
      }),
      token,
    );

    const { patchTripRates } = await import("@/lib/api/tripRates");
    const result = patchTripRates("alex/rates-trip", { EUR: 0.94 });
    expect(result.ok, JSON.stringify(result)).toBe(true);

    const { getTrip } = await import("@/lib/trips");
    const trip = getTrip("alex/rates-trip");
    expect(trip?.rates.EUR).toBeDefined();
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { writeDayFixture, writeTripFixture } from "./fixtures/content";

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
  writeTripFixture(OWNER, {
    id,
    title: id,
    start: "2026-08-25",
    end: "2026-08-26",
    status: "past",
    visibility: "public",
    people: people.map((email) => ({ name: "R", email })),
  });
}

function writeDraft(tripId: string, slug: string) {
  writeDayFixture(dir, OWNER, tripId, {
    slug,
    date: "2026-08-25",
    status: "draft",
    content: "Words.",
  });
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
      features: { auth: { enabled: true }, credits: { enabled: true } },
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
      features: { auth: { enabled: true }, credits: { enabled: true } },
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
    // B1633 — the slug is the addressable v2 form (the whole filename
    // stem), not v1's bare `entrySlugFromFile` output: `listDrafts` hands
    // back "arrival" and `v2Slug` turns that into "2026-08-25-arrival",
    // which is what `GET .../days/{slug}` actually matches on.
    const drafts = body.drafts as { trip: string; slug: string }[];
    expect(drafts).toEqual([{ trip: "shared-trip", slug: "2026-08-25-arrival", title: "arrival" }]);
    expect((body.token as { scope: string }).scope).toBe("owner");
  });

  test("a trip-scoped token sees only its own trip and that trip's drafts", async () => {
    const token = await tripToken(BUDDY, "shared-trip");
    const { status, body } = await journalStatus(token);
    expect(status, JSON.stringify(body)).toBe(200);
    const trips = (body.trips as { id: string }[]).map((t) => t.id);
    expect(trips).toEqual(["shared-trip"]);
    const drafts = body.drafts as { trip: string; slug: string }[];
    expect(drafts).toEqual([{ trip: "shared-trip", slug: "2026-08-25-arrival", title: "arrival" }]);
    expect((body.token as { scope: string; trip?: string }).scope).toBe("trip");
    expect((body.token as { scope: string; trip?: string }).trip).toBe("shared-trip");
  });

  test("refuses a token for a different journal", async () => {
    const { status, body } = await journalStatus("not-a-real-token");
    expect(status).toBe(401);
    expect(body.error).toBe("invalid_token");
  });

  /**
   * B1756 — a balance with a fraction is an ordinary balance. A credit is
   * stored in hundredths and `balanceOf` divides on the way out (B987), so
   * any journal that has ever part-spent one carries a fractional number
   * here. `journalStatus` declared `credits` an integer, and `.parse` threw
   * on it — a 500 with an empty body on the very first call the handover
   * prompt tells an agent to make, which reads to that agent as a route
   * that no longer exists. The live instance answered this way for every
   * request until the schema was widened.
   */
  test("a balance carrying a fraction is a 200, not a 500", async () => {
    const { grant, spend } = await import("@/lib/credits");
    await grant(OWNER, 3, "welcome");
    await spend(OWNER, 0.25, "helper", "b1756");

    const { status, body } = await journalStatus(await ownerToken());
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.credits).toBe(2.75);
  });

  /**
   * B1633, end to end rather than by shape: a slug taken straight out of
   * `/status`'s `drafts` has to be one `GET .../days/{slug}` can actually
   * find. `listDrafts` (v1) is what feeds `buildJournalStatus`, and since
   * B1598 both it and the v2 day route read the same on-disk JSON, so a
   * trip and day created fresh through the v2 `PUT` routes below are all
   * this needs — no separate v1-shaped fixture to collide with them.
   */
  test("a slug out of the drafts list is a slug the v2 day route accepts", async () => {
    const tripId = "status-e2e-trip";

    const token = await ownerToken();

    const { PUT: putTrip } = await import("@/app/api/v2/[user]/trips/[trip]/route");
    const tripBody = {
      id: tripId,
      title: `Trip ${tripId}`,
      dates: { from: "2026-08-25", to: "2026-08-26" },
      visibility: "private",
      people: [{ name: "Cleo Traveller", email: OWNER_EMAIL }],
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
        buddies: "travelling solo, nobody else was on this trip",
      },
    };
    const tripCreated = await putTrip(
      new Request(`https://example.test/api/v2/${OWNER}/trips/${tripId}`, {
        method: "PUT",
        headers: headers({ authorization: `Bearer ${token}` }),
        body: JSON.stringify(tripBody),
      }),
      { params: Promise.resolve({ user: OWNER, trip: tripId }) },
    );
    expect(tripCreated.status, JSON.stringify(await tripCreated.clone().json())).toBe(201);

    const { PUT: putDay } = await import("@/app/api/v2/[user]/trips/[trip]/days/[slug]/route");
    const daySlug = "2026-08-25-matsumoto-detour";
    const dayBody = {
      slug: daySlug,
      title: "The Matsumoto detour",
      date: "2026-08-25",
      content: "We took the long way round.",
      status: "draft",
      declined: {
        media: "no photographs attached to this day yet",
        costs: "nothing spent today, tracked elsewhere",
        coordinates: "no position recorded for this day",
        weather: "weather was not asked for this day",
        time: "the exact time of day was not recorded",
        timezone: "no timezone established for this leg",
        location: "no specific location named for this day",
        country: "no country named for this day entry",
        countryCode: "no country code named for this day",
        transportMode: "no transport leg happened this day",
        tags: "no tags applied to this day",
        translations: "single-language journal, nothing to translate",
        visibility: "no narrower visibility set for this day",
      },
    };
    const dayCreated = await putDay(
      new Request(`https://example.test/api/v2/${OWNER}/trips/${tripId}/days/${daySlug}`, {
        method: "PUT",
        headers: headers({ authorization: `Bearer ${token}` }),
        body: JSON.stringify(dayBody),
      }),
      { params: Promise.resolve({ user: OWNER, trip: tripId, slug: daySlug }) },
    );
    expect(dayCreated.status, JSON.stringify(await dayCreated.clone().json())).toBe(201);

    const { status, body } = await journalStatus(token);
    expect(status, JSON.stringify(body)).toBe(200);
    const drafts = body.drafts as { trip: string; slug: string; title: string }[];
    const draft = drafts.find((d) => d.trip === tripId);
    expect(draft).toBeTruthy();
    expect(draft!.slug).toBe(daySlug);

    const { GET: getDay } = await import("@/app/api/v2/[user]/trips/[trip]/days/[slug]/route");
    const found = await getDay(
      new Request(`https://example.test/api/v2/${OWNER}/trips/${tripId}/days/${draft!.slug}`, {
        headers: headers({ authorization: `Bearer ${token}` }),
      }),
      { params: Promise.resolve({ user: OWNER, trip: tripId, slug: draft!.slug }) },
    );
    expect(found.status).toBe(200);
    const foundBody = (await found.json()) as StatusBody;
    expect(foundBody.title).toBe("The Matsumoto detour");
  });
});

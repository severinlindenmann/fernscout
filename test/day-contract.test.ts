import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { issueCode, verifyCode } from "@/lib/auth";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

/**
 * B531 — the completeness contract, repointed onto v2 for B1612.
 *
 * An agent moved fourteen days onto a hosted instance and left the money on
 * its own laptop. Every call answered 200. The claim under test is that this
 * is no longer possible **and** that the way out is never "invent a value":
 * every refusal offers the decline, and the decline is written into the day
 * so that "nothing was spent" stays different from "nobody asked".
 *
 * v1 answered this with a per-trip `tracks:` toggle (turn a question off for
 * the whole trip) layered under a per-day decline. v2 retired `tracks:`
 * entirely (`lib/api/v2/schemas/trip.ts`'s own comment: "'what this trip
 * keeps track of' is now the same declined map as everything else, one
 * mechanism instead of two") — every day answers or declines every
 * declinable itself, always, with no trip-level opt-out. The tests below
 * that exercised turning tracking off (`PATCH .../tracks`, "a trip that
 * keeps neither asks for neither", the mid-trip retroactive-tracking gate
 * re-check) have no v2 counterpart to repoint onto and are not carried
 * forward — the property they protected (a trip's own choice about what it
 * keeps changes what a day is asked) is retired by design, not broken.
 * `idempotency_key` is the same story: v2's day schema has no such field —
 * `dayWrite` is a `strictObject` and would refuse it outright — because
 * PUT's own create-once semantics (a retried create answers 409
 * `stale_document` with the stored document; V11's `If-Match` is the only
 * way to turn it into a replace) already give a retried write the safety an
 * opaque key existed to buy in v1.
 *
 * What survives, repointed: the 422 `incomplete` body and its two ways out,
 * nothing written on a refusal, `dryRun` running the identical checks, and
 * the publish gate re-running the day's own completeness (`media`, in v2).
 */

const OWNER = "alex";
const OWNER_EMAIL = "alex@example.test";
const TRIP_ID = "reise";

let dir: string;
let calls = 0;

function headers(extra: Record<string, string> = {}): Record<string, string> {
  calls += 1;
  return { "content-type": "application/json", "x-forwarded-for": `10.9.8.${calls % 250}`, ...extra };
}

async function token(): Promise<string> {
  const { code } = await issueCode(OWNER, OWNER_EMAIL, "agent");
  const verified = await verifyCode(OWNER, OWNER_EMAIL, code, "agent");
  if (!verified.ok) throw new Error("no token");
  return verified.token;
}

type Body = Record<string, unknown> & { error?: string; message?: string };

function fullTrip(): Record<string, unknown> {
  return {
    id: TRIP_ID,
    title: "Reise",
    dates: { from: "2026-09-01", to: "2026-09-05" },
    visibility: "private",
    people: [{ name: "Alex B", email: OWNER_EMAIL }],
    teaser: true,
    declined: {
      rates: "no foreign currency tracked",
      costs: "no budget tracked",
      plan: "no planned route recorded",
      days: "days are written one at a time",
      translations: "single-language journal",
      accent: "default accent",
      figures: "no walking figures drawn",
      tagline: "no subtitle written",
      intro: "no opening prose written",
    },
  };
}

/** Every declinable, all declined — a caller overrides the ones a given test
 * is actually about (by omitting or providing the real field instead). */
function allDeclined(): Record<string, string> {
  return {
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
  };
}

const DAY = { title: "Ein Tag", date: "2026-09-02", content: "Etwas ist passiert.", status: "draft" as const };

async function putTrip() {
  const { PUT } = await import("@/app/api/v2/[user]/trips/[trip]/route");
  const response = await PUT(
    new Request(`https://t.test/api/v2/${OWNER}/trips/${TRIP_ID}`, {
      method: "PUT",
      headers: headers({ authorization: `Bearer ${await token()}` }),
      body: JSON.stringify(fullTrip()),
    }),
    { params: Promise.resolve({ user: OWNER, trip: TRIP_ID }) },
  );
  return { status: response.status, body: (await response.json()) as Body };
}

async function putDay(body: Record<string, unknown>, opts: { dryRun?: boolean; ifMatch?: string } = {}) {
  const { PUT } = await import("@/app/api/v2/[user]/trips/[trip]/days/[slug]/route");
  const slug = String(body.slug ?? "2026-09-02-ein-tag");
  const url = new URL(`https://t.test/api/v2/${OWNER}/trips/${TRIP_ID}/days/${slug}`);
  if (opts.dryRun !== undefined) url.searchParams.set("dryRun", String(opts.dryRun));
  const response = await PUT(
    new Request(url, {
      method: "PUT",
      headers: headers({
        authorization: `Bearer ${await token()}`,
        ...(opts.ifMatch ? { "if-match": opts.ifMatch } : {}),
      }),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user: OWNER, trip: TRIP_ID, slug }) },
  );
  return { status: response.status, etag: response.headers.get("etag"), body: (await response.json()) as Body };
}

async function getDay(slug: string) {
  const { GET } = await import("@/app/api/v2/[user]/trips/[trip]/days/[slug]/route");
  const response = await GET(
    new Request(`https://t.test/api/v2/${OWNER}/trips/${TRIP_ID}/days/${slug}`, {
      headers: headers({ authorization: `Bearer ${await token()}` }),
    }),
    { params: Promise.resolve({ user: OWNER, trip: TRIP_ID, slug }) },
  );
  return { status: response.status, etag: response.headers.get("etag"), body: (await response.json()) as Body };
}

async function publish(slug: string) {
  const { POST } = await import("@/app/api/v2/[user]/trips/[trip]/days/[slug]/publish/route");
  const response = await POST(
    new Request(`https://t.test/api/v2/${OWNER}/trips/${TRIP_ID}/days/${slug}/publish`, {
      method: "POST",
      headers: headers({ authorization: `Bearer ${await token()}` }),
      body: JSON.stringify({}),
    }),
    { params: Promise.resolve({ user: OWNER, trip: TRIP_ID, slug }) },
  );
  return { status: response.status, body: (await response.json()) as Body };
}

function entriesDir(): string {
  return path.join(dir, OWNER, "trips", TRIP_ID, "entries");
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-day-contract-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "day-contract-test-secret-what-a-day-owes";
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "T", url: "https://t.test" }, features: { auth: { enabled: true } } }),
  );
  clearConfigCache();
  clearUserCache();
  await migrateToLatest(await getDatabase());

  const { createJournal } = await import("@/lib/journals");
  const created = createJournal({
    username: OWNER,
    title: "Alex",
    ownerEmail: OWNER_EMAIL,
    ownerName: "Alex B",
    ownerNickname: "Alex",
  });
  if (!created.ok) throw new Error(created.message);

  await putTrip();
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

describe("a day answers every declinable, or declines it", () => {
  test("a day that says nothing about money or place is refused, and told both ways out", async () => {
    const { status, body } = await putDay({ ...DAY, slug: "2026-09-02-ein-tag" });
    expect(status).toBe(422);
    expect(body.error).toBe("incomplete");

    const missing = (body.details as { missing?: { field: string; to_decline: string }[] })?.missing ?? [];
    const fields = missing.map((m) => m.field).sort();
    // NOT `translations` — this journal has one locale, so that question is
    // exempt (B1667).
    expect(fields).toEqual(
      [
        "media",
        "costs",
        "coordinates",
        "weather",
        "time",
        "timezone",
        "location",
        "country",
        "countryCode",
        "transportMode",
        "tags",
        "visibility",
      ].sort(),
    );
    // The half that matters: every row's own field is what it tells the
    // caller to decline — not a neighbouring one (B1601, moderate finding 3).
    for (const row of missing) {
      expect(row.to_decline).toBe(`declined.${row.field}: <reason>`);
    }
  });

  test("nothing is written when it is refused", async () => {
    await putDay({ ...DAY, slug: "2026-09-02-ein-tag" });
    expect(fs.existsSync(path.join(entriesDir(), "2026-09-02-ein-tag.json"))).toBe(false);
  });

  test("sending the things it asks for writes the day", async () => {
    const { status } = await putDay({
      ...DAY,
      slug: "2026-09-02-ein-tag",
      coordinates: { lat: 47.55, lng: 7.59 },
      costs: [{ label: "Kaffee", amount: 4.5, currency: "CHF" }],
      declined: {
        media: allDeclined().media,
        weather: allDeclined().weather,
        time: allDeclined().time,
        timezone: allDeclined().timezone,
        location: allDeclined().location,
        country: allDeclined().country,
        countryCode: allDeclined().countryCode,
        transportMode: allDeclined().transportMode,
        tags: allDeclined().tags,
        translations: allDeclined().translations,
        visibility: allDeclined().visibility,
      },
    });
    expect(status).toBe(201);
    const { body } = await getDay("2026-09-02-ein-tag");
    expect(body.costs).toHaveLength(1);
  });

  test("declining writes the day, and writes the decline into it", async () => {
    const { status } = await putDay({ ...DAY, slug: "2026-09-02-ein-tag", declined: allDeclined() });
    expect(status).toBe(201);

    const { body } = await getDay("2026-09-02-ein-tag");
    const declined = body.declined as Record<string, string>;
    expect(declined.costs).toBe(allDeclined().costs);
    expect(declined.coordinates).toBe(allDeclined().coordinates);
    // In the file, because the distinction it makes — "nothing was spent"
    // against "nobody asked" — is for whoever reads the day in a year.
    const raw = fs.readFileSync(path.join(entriesDir(), "2026-09-02-ein-tag.json"), "utf8");
    expect(raw).toContain(allDeclined().costs);
    expect(raw).toContain(allDeclined().coordinates);
  });

  test("an empty decline reason is refused rather than recorded", async () => {
    const { status, body } = await putDay({
      ...DAY,
      slug: "2026-09-02-ein-tag",
      declined: { ...allDeclined(), coordinates: "" },
    });
    expect(status).toBe(400);
    expect(JSON.stringify(body)).toMatch(/coordinates/);
  });
});

describe("dryRun — check a day without writing it", () => {
  test("a clean dry run writes no file and reports what would be stored", async () => {
    const { status, body } = await putDay(
      {
        ...DAY,
        slug: "2026-09-02-ein-tag",
        coordinates: { lat: 47.55, lng: 7.59 },
        declined: { ...allDeclined(), coordinates: undefined },
      },
      { dryRun: true },
    );
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.status).toBe("draft");
    expect(fs.existsSync(path.join(entriesDir(), "2026-09-02-ein-tag.json"))).toBe(false);
  });

  test("an invalid body answers the same refusal a real PUT would, and writes nothing", async () => {
    const dry = await putDay(
      { ...DAY, slug: "2026-09-02-ein-tag", declined: { ...allDeclined(), coordinates: "" } },
      { dryRun: true },
    );
    const real = await putDay({ ...DAY, slug: "2026-09-02-ein-tag", declined: { ...allDeclined(), coordinates: "" } });
    expect(dry.status).toBe(real.status);
    expect(dry.body.details).toEqual(real.body.details);
    expect(fs.existsSync(path.join(entriesDir(), "2026-09-02-ein-tag.json"))).toBe(false);
  });

  test("a day missing a declinable is refused the same way with dryRun", async () => {
    const { status, body } = await putDay({ ...DAY, slug: "2026-09-02-ein-tag" }, { dryRun: true });
    expect(status).toBe(422);
    expect(body.error).toBe("incomplete");
    expect(fs.existsSync(path.join(entriesDir(), "2026-09-02-ein-tag.json"))).toBe(false);
  });
});

/**
 * v1 checked photographs only at publish — a day could exist, unpublished,
 * with no answer about its pictures at all, and the first describe block
 * above's own 422 said nothing about `photos`. v2 does not have a lazy
 * gate to test: `media` is one of `DAY_DECLINABLES`, so `dayWrite` — the
 * same check both PUT and PATCH run in full on every write — already
 * refuses an incomplete day before it can exist (proved above, where
 * `media` is one of the fields the bare-`DAY` 422 lists). Publish's own
 * `dayWrite.safeParse` re-check is consequently unreachable through the
 * ordinary write API: there is no way to leave a stored day incomplete for
 * it to catch, since every path that could produce one already refused it
 * first. What is left to test honestly is that declining `media` at create
 * is sufficient — publish succeeds and the decline survives onto the
 * published day, which is what a reader a year from now still needs to see.
 */
describe("photographs, declined at create, publish cleanly", () => {
  test("declining photographs is enough to both create and publish, and the day records why", async () => {
    await putDay({
      ...DAY,
      slug: "2026-09-02-ein-tag",
      declined: { ...allDeclined(), media: "no photographs attached to this day" },
    });
    const { status, body } = await publish("2026-09-02-ein-tag");
    expect(status, JSON.stringify(body)).toBe(200);

    const { body: read } = await getDay("2026-09-02-ein-tag");
    expect(read.status).toBe("published");
    expect((read.declined as Record<string, string>)?.media).toBe("no photographs attached to this day");
  });
});

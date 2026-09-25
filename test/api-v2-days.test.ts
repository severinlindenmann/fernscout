import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

/**
 * `GET/PUT/PATCH/DELETE /api/v2/{user}/trips/{trip}/days[/{slug}]` and the
 * publish/unpublish/send lifecycle — B1612 (phase 2 step 3, parcel B).
 *
 * Same shape as `test/api-v2-trips.test.ts` and `test/api-v2-journal.test.ts`:
 * a real temp content dir, a real sqlite db, real sessions minted through
 * `lib/auth`, real route handlers called directly.
 */

const OWNER = "remy";
const OWNER_EMAIL = "remy@example.test";
const TRIP_ID = "days-trip";

let dir: string;
let calls = 0;

function headers(extra: Record<string, string> = {}): Record<string, string> {
  calls += 1;
  return { "content-type": "application/json", "x-forwarded-for": `10.9.4.${calls % 250}`, ...extra };
}

async function ownerToken(): Promise<string> {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, OWNER_EMAIL, "agent");
  const result = await verifyCode(OWNER, OWNER_EMAIL, code, "agent");
  if (!result.ok) throw new Error("no owner token");
  return result.token;
}

async function tripScopedToken(tripId: string): Promise<string> {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { tripWriteScope } = await import("@/lib/tripPeople");
  const { code } = await issueCode(OWNER, OWNER_EMAIL, "agent", { trip: tripId });
  const result = await verifyCode(OWNER, OWNER_EMAIL, code, "agent", tripWriteScope(tripId));
  if (!result.ok) throw new Error("no scoped token");
  return result.token;
}

type Body = Record<string, unknown> & { error?: string; message?: string };

function fullTrip(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    title: `Trip ${id}`,
    dates: { from: "2026-06-01", to: "2026-06-20" },
    visibility: "private",
    people: [{ name: "Remy Traveller", email: OWNER_EMAIL }],
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
    ...overrides,
  };
}

function fullDayBody(slug: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    slug,
    title: "Arrival",
    date: slug.slice(0, 10),
    content: "We arrived and found the hostel without trouble.",
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
    ...overrides,
  };
}

async function putDay(
  tripId: string,
  slug: string,
  body: unknown,
  token: string | undefined,
  opts: { ifMatch?: string; dryRun?: boolean } = {},
) {
  const { PUT } = await import("@/app/api/v2/[user]/trips/[trip]/days/[slug]/route");
  const url = new URL(`https://example.test/api/v2/${OWNER}/trips/${tripId}/days/${slug}`);
  if (opts.dryRun !== undefined) url.searchParams.set("dryRun", String(opts.dryRun));
  const response = await PUT(
    new Request(url, {
      method: "PUT",
      headers: headers({
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(opts.ifMatch ? { "if-match": opts.ifMatch } : {}),
      }),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user: OWNER, trip: tripId, slug }) },
  );
  return { status: response.status, etag: response.headers.get("etag"), body: (await response.json()) as Body };
}

async function patchDay(
  tripId: string,
  slug: string,
  body: unknown,
  token: string | undefined,
  opts: { ifMatch?: string } = {},
) {
  const { PATCH } = await import("@/app/api/v2/[user]/trips/[trip]/days/[slug]/route");
  const response = await PATCH(
    new Request(`https://example.test/api/v2/${OWNER}/trips/${tripId}/days/${slug}`, {
      method: "PATCH",
      headers: headers({
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(opts.ifMatch ? { "if-match": opts.ifMatch } : {}),
      }),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user: OWNER, trip: tripId, slug }) },
  );
  return { status: response.status, etag: response.headers.get("etag"), body: (await response.json()) as Body };
}

async function getDay(tripId: string, slug: string, token?: string) {
  const { GET } = await import("@/app/api/v2/[user]/trips/[trip]/days/[slug]/route");
  const response = await GET(
    new Request(`https://example.test/api/v2/${OWNER}/trips/${tripId}/days/${slug}`, {
      headers: headers(token ? { authorization: `Bearer ${token}` } : {}),
    }),
    { params: Promise.resolve({ user: OWNER, trip: tripId, slug }) },
  );
  return { status: response.status, etag: response.headers.get("etag"), body: (await response.json()) as Body };
}

async function deleteDay(tripId: string, slug: string, token?: string) {
  const { DELETE } = await import("@/app/api/v2/[user]/trips/[trip]/days/[slug]/route");
  const response = await DELETE(
    new Request(`https://example.test/api/v2/${OWNER}/trips/${tripId}/days/${slug}`, {
      method: "DELETE",
      headers: headers(token ? { authorization: `Bearer ${token}` } : {}),
    }),
    { params: Promise.resolve({ user: OWNER, trip: tripId, slug }) },
  );
  return { status: response.status, body: (await response.json()) as Body };
}

async function publishDay(tripId: string, slug: string, token: string | undefined, body: unknown = {}) {
  const { POST } = await import("@/app/api/v2/[user]/trips/[trip]/days/[slug]/publish/route");
  const response = await POST(
    new Request(`https://example.test/api/v2/${OWNER}/trips/${tripId}/days/${slug}/publish`, {
      method: "POST",
      headers: headers(token ? { authorization: `Bearer ${token}` } : {}),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user: OWNER, trip: tripId, slug }) },
  );
  return { status: response.status, body: (await response.json()) as Body };
}

async function unpublishDay(tripId: string, slug: string, token?: string) {
  const { POST } = await import("@/app/api/v2/[user]/trips/[trip]/days/[slug]/unpublish/route");
  const response = await POST(
    new Request(`https://example.test/api/v2/${OWNER}/trips/${tripId}/days/${slug}/unpublish`, {
      method: "POST",
      headers: headers(token ? { authorization: `Bearer ${token}` } : {}),
    }),
    { params: Promise.resolve({ user: OWNER, trip: tripId, slug }) },
  );
  return { status: response.status, body: (await response.json()) as Body };
}

async function sendDay(tripId: string, slug: string, token: string | undefined, channels: string[]) {
  const { POST } = await import("@/app/api/v2/[user]/trips/[trip]/days/[slug]/send/route");
  const response = await POST(
    new Request(`https://example.test/api/v2/${OWNER}/trips/${tripId}/days/${slug}/send`, {
      method: "POST",
      headers: headers(token ? { authorization: `Bearer ${token}` } : {}),
      body: JSON.stringify({ channels }),
    }),
    { params: Promise.resolve({ user: OWNER, trip: tripId, slug }) },
  );
  return { status: response.status, body: (await response.json()) as Body };
}

/** Every `.eml` file this run has written, anywhere under `DATA_DIR/mail`. */
function mailFileCount(): number {
  const mailDir = path.join(dir, "mail");
  if (!fs.existsSync(mailDir)) return 0;
  let count = 0;
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith(".eml")) count += 1;
    }
  };
  walk(mailDir);
  return count;
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-api-v2-days-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.SESSION_SECRET = "66".repeat(32);

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test" },
      users: { reserved: [] },
      features: { auth: { enabled: true }, mail: { enabled: true, transport: "file" } },
    }),
  );

  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  const { migrateToLatest } = await import("@/lib/db/migrate");
  const { getDatabase } = await import("@/lib/db");
  const { createJournal } = await import("@/lib/journals");

  clearConfigCache();
  clearUserCache();
  await migrateToLatest(await getDatabase());

  const created = createJournal({
    username: OWNER,
    title: "Remy's Journal",
    ownerEmail: OWNER_EMAIL,
    ownerName: "Remy Traveller",
    ownerNickname: "Remy",
  });
  if (!created.ok) throw new Error(created.message);

  const { writeTripFile } = await import("@/lib/api/v2/store");
  const { tripCreate } = await import("@/lib/api/v2/schemas");
  const parsedTrip = tripCreate.parse(fullTrip(TRIP_ID));
  const { days: _ignored, ...tripFields } = parsedTrip;
  writeTripFile(OWNER, TRIP_ID, tripFields);
});

afterAll(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATA_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("PUT /api/v2/{user}/trips/{trip}/days/{slug} — create-only (decision 7)", () => {
  test("a client-chosen slug creates the day", async () => {
    const token = await ownerToken();
    const { status, body } = await putDay(TRIP_ID, "2026-06-01-arrival", fullDayBody("2026-06-01-arrival"), token);
    expect(status, JSON.stringify(body)).toBe(201);
    expect(body.status).toBe("draft");
    expect(body.title).toBe("Arrival");
  });

  test("a retried PUT to an existing slug answers 409 with the stored document", async () => {
    const token = await ownerToken();
    const retried = await putDay(
      TRIP_ID,
      "2026-06-01-arrival",
      fullDayBody("2026-06-01-arrival", { title: "A different title" }),
      token,
    );
    expect(retried.status).toBe(409);
    expect(retried.body.error).toBe("stale_document");
    const { body: onDisk } = await getDay(TRIP_ID, "2026-06-01-arrival", token);
    expect(onDisk.title).toBe("Arrival");
  });

  test("a matching If-Match turns it into a deliberate replace", async () => {
    const token = await ownerToken();
    const { etag } = await getDay(TRIP_ID, "2026-06-01-arrival", token);
    const replaced = await putDay(
      TRIP_ID,
      "2026-06-01-arrival",
      fullDayBody("2026-06-01-arrival", { title: "Arrival, Renamed" }),
      token,
      { ifMatch: etag ?? undefined },
    );
    expect(replaced.status, JSON.stringify(replaced.body)).toBe(200);
    expect(replaced.body.title).toBe("Arrival, Renamed");
  });
});

describe("PATCH /api/v2/{user}/trips/{trip}/days/{slug} — merges", () => {
  test("a patch changes one field and leaves the rest", async () => {
    const token = await ownerToken();
    const patched = await patchDay(TRIP_ID, "2026-06-01-arrival", { content: "We arrived late, after dark." }, token);
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    expect(patched.body.content).toBe("We arrived late, after dark.");
    expect(patched.body.title).toBe("Arrival, Renamed");
  });

  test("B2243 — more cost lines than COST_LINES_MAX, or a label over COST_LABEL_MAX_CHARS, is refused", async () => {
    const token = await ownerToken();
    const { COST_LINES_MAX, COST_LABEL_MAX_CHARS } = await import("@/lib/api/v2/schemas/day");
    await putDay(TRIP_ID, "2026-06-06-costs", fullDayBody("2026-06-06-costs"), token);

    const tooMany = Array.from({ length: COST_LINES_MAX + 1 }, (_, i) => ({ label: `line ${i}`, amount: 1 }));
    const many = await patchDay(TRIP_ID, "2026-06-06-costs", { costs: tooMany }, token);
    expect(many.status).toBe(400);
    expect(JSON.stringify(many.body.details)).toContain("costs");

    const long = await patchDay(TRIP_ID, "2026-06-06-costs", { costs: [{ label: "x".repeat(COST_LABEL_MAX_CHARS + 1), amount: 1 }] }, token);
    expect(long.status).toBe(400);
    expect(JSON.stringify(long.body.details)).toContain("costs.0.label");

    const atTheLimit = await patchDay(TRIP_ID, "2026-06-06-costs", { costs: [{ label: "x".repeat(COST_LABEL_MAX_CHARS), amount: 1 }] }, token);
    expect(atTheLimit.status, JSON.stringify(atTheLimit.body)).toBe(200);
  });

  test("B2243 — a stored day over those bounds (another door wrote it) still reads", async () => {
    const token = await ownerToken();
    const { COST_LINES_MAX } = await import("@/lib/api/v2/schemas/day");
    await putDay(TRIP_ID, "2026-06-07-stored", fullDayBody("2026-06-07-stored"), token);
    const { readDayFile, writeDayFile } = await import("@/lib/api/v2/store");
    const stored = readDayFile(OWNER, TRIP_ID, "2026-06-07-stored")!;
    const lines = Array.from({ length: COST_LINES_MAX + 1 }, () => ({ label: "y".repeat(300), amount: 1 }));
    const { costs: _declined, ...declined } = (stored.declined ?? {}) as Record<string, string>;
    writeDayFile(OWNER, TRIP_ID, "2026-06-07-stored", { ...stored, costs: lines, declined } as typeof stored);
    const read = await getDay(TRIP_ID, "2026-06-07-stored", token);
    expect(read.status).toBe(200);
    expect(read.body.costs).toHaveLength(COST_LINES_MAX + 1);

    // Review F1: the bounds judge what a caller sends, never what is stored —
    // a correction to another field and the publish both still go through.
    const renamed = await patchDay(TRIP_ID, "2026-06-07-stored", { title: "Renamed" }, token);
    expect(renamed.status, JSON.stringify(renamed.body)).toBe(200);
    const published = await publishDay(TRIP_ID, "2026-06-07-stored", token);
    expect(published.status, JSON.stringify(published.body)).toBe(200);
  });

  test("T6: declining costs, then supplying it, clears the stored decline", async () => {
    const token = await ownerToken();
    await putDay(TRIP_ID, "2026-06-05-market", fullDayBody("2026-06-05-market"), token);

    const { body: doc } = await getDay(TRIP_ID, "2026-06-05-market", token);
    expect((doc.declined as Record<string, string>).costs).toBeTruthy();

    const supplied = await patchDay(
      TRIP_ID,
      "2026-06-05-market",
      { costs: [{ label: "market snacks", amount: 8 }] },
      token,
    );
    expect(supplied.status, JSON.stringify(supplied.body)).toBe(200);
    expect(supplied.body.costs).toEqual([{ label: "market snacks", amount: 8 }]);
    const declined = supplied.body.declined as Record<string, string>;
    expect(declined.costs).toBeUndefined();
    expect(declined.media).toBeTruthy();
  });
});

describe("PUT /api/v2/{user}/trips/{trip}/days/{slug} — echo-tolerance (V2)", () => {
  test("GET the document, change one field, PUT the whole thing back — it works", async () => {
    const token = await ownerToken();
    await putDay(TRIP_ID, "2026-06-08-echo", fullDayBody("2026-06-08-echo"), token);
    const { body: doc, etag } = await getDay(TRIP_ID, "2026-06-08-echo", token);

    const round = { ...doc, content: "Updated content on the echo round trip." };
    delete round.error;
    delete round.message;

    const { status, body } = await putDay(TRIP_ID, "2026-06-08-echo", round, token, { ifMatch: etag ?? undefined });
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.content).toBe("Updated content on the echo round trip.");
    expect(body.slug).toBe("2026-06-08-echo");
  });
});

describe("PUT/PATCH /api/v2/{user}/trips/{trip}/days/{slug} — dryRun (T1)", () => {
  test("dryRun writes nothing", async () => {
    const token = await ownerToken();
    const dry = await putDay(TRIP_ID, "2026-06-09-dry", fullDayBody("2026-06-09-dry"), token, { dryRun: true });
    expect(dry.status, JSON.stringify(dry.body)).toBe(200);
    const { status } = await getDay(TRIP_ID, "2026-06-09-dry", token);
    expect(status).toBe(404);
  });
});

describe("PATCH .../days/{slug} — ETag / If-Match (V11)", () => {
  test("a stale If-Match answers 409 with the current document", async () => {
    const token = await ownerToken();
    const { status, body } = await patchDay(TRIP_ID, "2026-06-01-arrival", { content: "Whatever" }, token, {
      ifMatch: '"not-the-real-one"',
    });
    expect(status).toBe(409);
    expect(body.error).toBe("stale_document");
    expect((body.details as { slug?: string })?.slug).toBe("2026-06-01-arrival");
  });
});

describe("DELETE /api/v2/{user}/trips/{trip}/days/{slug} — published_day_not_deletable", () => {
  test("a published day is not deleted; unpublish first", async () => {
    const token = await ownerToken();
    await putDay(TRIP_ID, "2026-06-10-published", fullDayBody("2026-06-10-published"), token);
    const published = await publishDay(TRIP_ID, "2026-06-10-published", token);
    expect(published.status, JSON.stringify(published.body)).toBe(200);

    const refused = await deleteDay(TRIP_ID, "2026-06-10-published", token);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe("published_day_not_deletable");

    const unpublished = await unpublishDay(TRIP_ID, "2026-06-10-published", token);
    expect(unpublished.status, JSON.stringify(unpublished.body)).toBe(200);
    expect(unpublished.body.status).toBe("draft");

    const deleted = await deleteDay(TRIP_ID, "2026-06-10-published", token);
    expect(deleted.status, JSON.stringify(deleted.body)).toBe(200);
    expect(deleted.body.deleted).toBe(true);
  });
});

describe("POST .../publish — rule 9, untouchable", () => {
  test("refuses a trip-scoped token with out_of_scope — being on the bus is not deciding what the journal says", async () => {
    const token = await ownerToken();
    await putDay(TRIP_ID, "2026-06-11-scoped", fullDayBody("2026-06-11-scoped"), token);
    const scoped = await tripScopedToken(TRIP_ID);

    const { status, body } = await publishDay(TRIP_ID, "2026-06-11-scoped", scoped);
    expect(status).toBe(403);
    expect(body.error).toBe("out_of_scope");
  });

  test("publishing with neither send flag sends nothing — no mail is written", async () => {
    const token = await ownerToken();
    await putDay(TRIP_ID, "2026-06-12-quiet", fullDayBody("2026-06-12-quiet"), token);

    const before = mailFileCount();
    const { status, body } = await publishDay(TRIP_ID, "2026-06-12-quiet", token, {});
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.mail).toBeUndefined();
    expect(body.whatsapp).toBeUndefined();
    // Publishing this one day must never itself have mailed anybody.
    expect(mailFileCount()).toBe(before);
  });
});

// B1907 — a day that names a country the server can place reads back with the
// ISO code too, which is what a photobook prints its chapter titles from. It
// is derived at the door, before the required-or-declined check, so naming a
// country does not oblige a caller to decline the code as well.
describe("PUT/PATCH .../days/{slug} — countryCode is derived from country", () => {
  function namingCountry(slug: string, country: string): Record<string, unknown> {
    const body = fullDayBody(slug, { country });
    const declined = body.declined as Record<string, unknown>;
    delete declined.country;
    delete declined.countryCode;
    return body;
  }

  test("a PUT that names Hungary and no code comes back carrying HU", async () => {
    const token = await ownerToken();
    const put = await putDay(TRIP_ID, "2026-06-20-budapest", namingCountry("2026-06-20-budapest", "Hungary"), token);
    expect(put.status, JSON.stringify(put.body)).toBe(201);
    expect((put.body as unknown as Record<string, unknown>).countryCode).toBe("HU");

    const read = await getDay(TRIP_ID, "2026-06-20-budapest", token);
    expect((read.body as unknown as Record<string, unknown>).countryCode).toBe("HU");
  });

  test("a name the server cannot place is still asked for, never guessed at", async () => {
    const token = await ownerToken();
    const put = await putDay(
      TRIP_ID,
      "2026-06-21-at-sea",
      namingCountry("2026-06-21-at-sea", "Somewhere over the Andaman Sea"),
      token,
    );
    expect(put.status).toBe(422);
    expect(put.body.error).toBe("incomplete");
  });

  test("a PATCH that names the country answers the old decline with the code", async () => {
    const token = await ownerToken();
    await putDay(TRIP_ID, "2026-06-22-somewhere", fullDayBody("2026-06-22-somewhere"), token);

    const patched = await patchDay(TRIP_ID, "2026-06-22-somewhere", { country: "Hungary" }, token);
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    const body = patched.body as unknown as Record<string, unknown>;
    expect(body.countryCode).toBe("HU");
    expect((body.declined as Record<string, unknown>)?.countryCode).toBeUndefined();
  });
});

describe("POST .../send — S1, the one send door", () => {
  test("refuses test_content — content nobody lived cannot be sent to real people", async () => {
    const token = await ownerToken();
    await putDay(TRIP_ID, "2026-06-13-test", fullDayBody("2026-06-13-test", { test: true }), token);
    await publishDay(TRIP_ID, "2026-06-13-test", token, {});

    const { status, body } = await sendDay(TRIP_ID, "2026-06-13-test", token, ["mail"]);
    expect(status).toBe(409);
    expect(body.error).toBe("test_content");
  });

  test("refuses not_published — a draft cannot be sent", async () => {
    const token = await ownerToken();
    await putDay(TRIP_ID, "2026-06-14-draft", fullDayBody("2026-06-14-draft"), token);

    const { status, body } = await sendDay(TRIP_ID, "2026-06-14-draft", token, ["mail"]);
    expect(status).toBe(409);
    expect(body.error).toBe("not_published");
  });
});

/**
 * B1625 — `translations` refuses a locale this journal does not declare, on
 * both PUT (create) and PATCH. `OWNER` above declares no `locales` at all
 * (single-language, so `translations` is exempt), so this needs its own
 * journal that actually declares two.
 */
describe("PUT/PATCH .../days/{slug} — translations refuses an undeclared locale (B1625)", () => {
  const LOCALE_OWNER = "nadia";
  const LOCALE_EMAIL = "nadia@example.test";
  const LOCALE_TRIP = "locale-days-trip";

  async function localeOwnerToken(): Promise<string> {
    const { issueCode, verifyCode } = await import("@/lib/auth");
    const { code } = await issueCode(LOCALE_OWNER, LOCALE_EMAIL, "agent");
    const result = await verifyCode(LOCALE_OWNER, LOCALE_EMAIL, code, "agent");
    if (!result.ok) throw new Error("no locale-owner token");
    return result.token;
  }

  async function putLocaleDay(
    slug: string,
    body: unknown,
    token: string | undefined,
    opts: { ifMatch?: string } = {},
  ) {
    const { PUT } = await import("@/app/api/v2/[user]/trips/[trip]/days/[slug]/route");
    const response = await PUT(
      new Request(`https://example.test/api/v2/${LOCALE_OWNER}/trips/${LOCALE_TRIP}/days/${slug}`, {
        method: "PUT",
        headers: headers({
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(opts.ifMatch ? { "if-match": opts.ifMatch } : {}),
        }),
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ user: LOCALE_OWNER, trip: LOCALE_TRIP, slug }) },
    );
    return { status: response.status, etag: response.headers.get("etag"), body: (await response.json()) as Body };
  }

  async function patchLocaleDay(slug: string, body: unknown, token: string | undefined) {
    const { PATCH } = await import("@/app/api/v2/[user]/trips/[trip]/days/[slug]/route");
    const response = await PATCH(
      new Request(`https://example.test/api/v2/${LOCALE_OWNER}/trips/${LOCALE_TRIP}/days/${slug}`, {
        method: "PATCH",
        headers: headers(token ? { authorization: `Bearer ${token}` } : {}),
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ user: LOCALE_OWNER, trip: LOCALE_TRIP, slug }) },
    );
    return { status: response.status, etag: response.headers.get("etag"), body: (await response.json()) as Body };
  }

  async function getLocaleDay(slug: string, token?: string) {
    const { GET } = await import("@/app/api/v2/[user]/trips/[trip]/days/[slug]/route");
    const response = await GET(
      new Request(`https://example.test/api/v2/${LOCALE_OWNER}/trips/${LOCALE_TRIP}/days/${slug}`, {
        headers: headers(token ? { authorization: `Bearer ${token}` } : {}),
      }),
      { params: Promise.resolve({ user: LOCALE_OWNER, trip: LOCALE_TRIP, slug }) },
    );
    return { status: response.status, body: (await response.json()) as Body };
  }

  beforeAll(async () => {
    const { createJournal } = await import("@/lib/journals");
    const created = createJournal({
      username: LOCALE_OWNER,
      title: "Nadia's Journal",
      ownerEmail: LOCALE_EMAIL,
      ownerName: "Nadia Traveller",
      ownerNickname: "Nadia",
      defaultLocale: "en",
      locales: ["en", "de"],
    });
    if (!created.ok) throw new Error(created.message);

    const { writeTripFile } = await import("@/lib/api/v2/store");
    const { tripCreate } = await import("@/lib/api/v2/schemas");
    const parsedTrip = tripCreate.parse(fullTrip(LOCALE_TRIP, { people: [{ name: "Nadia Traveller", email: LOCALE_EMAIL }] }));
    const { days: _ignored, ...tripFields } = parsedTrip;
    writeTripFile(LOCALE_OWNER, LOCALE_TRIP, tripFields);
  });

  test("a create naming a locale the journal does not declare is refused, naming every offending locale", async () => {
    const token = await localeOwnerToken();
    const declined = { ...(fullDayBody("2026-06-01-undeclared").declined as Record<string, string>) };
    delete declined.translations;
    const body = fullDayBody("2026-06-01-undeclared", {
      declined,
      translations: { fr: { title: "Arrivée", content: "Réveillé tôt." }, it: { title: "Arrivo", content: "Sveglia presto." } },
    });

    const { status, body: resBody } = await putLocaleDay("2026-06-01-undeclared", body, token);
    expect(status, JSON.stringify(resBody)).toBe(400);
    expect(resBody.error).toBe("invalid_translations");
    const problems = (resBody.details as { field: string }[]) ?? [];
    expect(problems.map((p) => p.field).sort()).toEqual(["translations.fr", "translations.it"]);

    const { status: notFound } = await getLocaleDay("2026-06-01-undeclared", token);
    expect(notFound).toBe(404);
  });

  test("a patch naming an undeclared locale is refused and nothing is written", async () => {
    const token = await localeOwnerToken();
    await putLocaleDay("2026-06-02-patch", fullDayBody("2026-06-02-patch"), token);

    const { status, body } = await patchLocaleDay(
      "2026-06-02-patch",
      { translations: { fr: { title: "Arrivée", content: "Réveillé tôt." }, it: { title: "Arrivo", content: "Sveglia presto." } } },
      token,
    );
    expect(status, JSON.stringify(body)).toBe(400);
    expect(body.error).toBe("invalid_translations");
    const problems = (body.details as { field: string }[]) ?? [];
    expect(problems.map((p) => p.field).sort()).toEqual(["translations.fr", "translations.it"]);

    const { body: onDisk } = await getLocaleDay("2026-06-02-patch", token);
    expect(onDisk.translations).toBeUndefined();
  });

  test("a locale the journal does declare is accepted", async () => {
    const token = await localeOwnerToken();
    await putLocaleDay("2026-06-03-declared", fullDayBody("2026-06-03-declared"), token);

    const { status, body } = await patchLocaleDay(
      "2026-06-03-declared",
      { translations: { de: { title: "Ankunft", content: "Wir sind angekommen." } } },
      token,
    );
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.translations).toEqual({ de: { title: "Ankunft", content: "Wir sind angekommen." } });
  });
});

describe("POST .../publish — declineTracked only declines what is blank (B2225)", () => {
  test("a decline naming a filled or already-answered field is refused, and nothing is written", async () => {
    const token = await ownerToken();
    const slug = "2026-06-14-filled";
    const { location: _l, ...declined } = fullDayBody(slug).declined as Record<string, string>;
    const put = await putDay(TRIP_ID, slug, fullDayBody(slug, { location: "The old harbour", declined }), token);
    expect(put.status, JSON.stringify(put.body)).toBe(201);
    // Costs left open — a draft may be; only a create insists on everything.
    const { readDayFile, writeDayFile } = await import("@/lib/api/v2/store");
    const stored = readDayFile(OWNER, TRIP_ID, slug)!;
    const { costs: _c, ...keptDeclines } = stored.declined ?? {};
    writeDayFile(OWNER, TRIP_ID, slug, { ...stored, declined: keptDeclines });
    const before = JSON.stringify(readDayFile(OWNER, TRIP_ID, slug));

    const refused = await publishDay(TRIP_ID, slug, token, { declineTracked: ["costs", "location", "weather"] });
    expect(refused.status, JSON.stringify(refused.body)).toBe(400);
    expect(refused.body.error).toBe("invalid_request");
    expect((refused.body.details as { refused?: string[] })?.refused).toEqual(["location", "weather"]);
    expect(JSON.stringify(readDayFile(OWNER, TRIP_ID, slug))).toBe(before);

    const published = await publishDay(TRIP_ID, slug, token, { declineTracked: ["costs"] });
    expect(published.status, JSON.stringify(published.body)).toBe(200);
    const day = readDayFile(OWNER, TRIP_ID, slug);
    expect(day?.location).toBe("The old harbour");
    expect(day?.declined?.location).toBeUndefined();
    expect(day?.declined?.weather).toBe("weather was not asked for this day");
  });
});

/** A request whose body is only handed over after `during` has run — the
 *  window between a route's first read of the day file and its write. */
function racingRequest(url: string, method: string, token: string, body: unknown, during: () => void): Request {
  const stream = new ReadableStream({
    pull(controller) {
      during();
      controller.enqueue(new TextEncoder().encode(JSON.stringify(body)));
      controller.close();
    },
  }, { highWaterMark: 0 }); // pulled only when the route reads the body, never at construction
  return new Request(url, {
    method,
    headers: headers({ authorization: `Bearer ${token}` }),
    body: stream,
    duplex: "half",
  } as RequestInit);
}

describe("a day changed under a PATCH or a publish is not written back over (B2245)", () => {
  test("a publish landing between a PATCH's read and write: 409 stale_document, the day stays published", async () => {
    const token = await ownerToken();
    const slug = "2026-06-15-race";
    expect((await putDay(TRIP_ID, slug, fullDayBody(slug), token)).status).toBe(201);
    const { readDayFile, writeDayFile } = await import("@/lib/api/v2/store");
    const { PATCH } = await import("@/app/api/v2/[user]/trips/[trip]/days/[slug]/route");

    const response = await PATCH(
      racingRequest(
        `https://example.test/api/v2/${OWNER}/trips/${TRIP_ID}/days/${slug}`,
        "PATCH",
        token,
        { content: "A correction written before the publish." },
        () => writeDayFile(OWNER, TRIP_ID, slug, { ...readDayFile(OWNER, TRIP_ID, slug)!, status: "published" }),
      ),
      { params: Promise.resolve({ user: OWNER, trip: TRIP_ID, slug }) },
    );
    const body = (await response.json()) as Body;
    expect(response.status, JSON.stringify(body)).toBe(409);
    expect(body.error).toBe("stale_document");
    const day = readDayFile(OWNER, TRIP_ID, slug);
    expect(day?.status).toBe("published");
    expect(day?.content).toBe("We arrived and found the hostel without trouble.");
  });

  test("a correction landing between a publish's read and write: 409, the correction kept, the day still a draft", async () => {
    const token = await ownerToken();
    const slug = "2026-06-16-race";
    expect((await putDay(TRIP_ID, slug, fullDayBody(slug), token)).status).toBe(201);
    const { readDayFile, writeDayFile } = await import("@/lib/api/v2/store");
    const { POST } = await import("@/app/api/v2/[user]/trips/[trip]/days/[slug]/publish/route");

    const response = await POST(
      racingRequest(
        `https://example.test/api/v2/${OWNER}/trips/${TRIP_ID}/days/${slug}/publish`,
        "POST",
        token,
        {},
        () => writeDayFile(OWNER, TRIP_ID, slug, { ...readDayFile(OWNER, TRIP_ID, slug)!, content: "Corrected meanwhile." }),
      ),
      { params: Promise.resolve({ user: OWNER, trip: TRIP_ID, slug }) },
    );
    const body = (await response.json()) as Body;
    expect(response.status, JSON.stringify(body)).toBe(409);
    expect(body.error).toBe("stale_document");
    const day = readDayFile(OWNER, TRIP_ID, slug);
    expect(day?.status).toBe("draft");
    expect(day?.content).toBe("Corrected meanwhile.");
  });
});

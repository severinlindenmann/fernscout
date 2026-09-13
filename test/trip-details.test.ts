import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { dayToJson, tripToJson, type DayFile, type TripFile } from "@/lib/api/v2/documents";

/**
 * B621 — a trip's `title:`, `tagline:`, `start:` and `end:` after it exists.
 *
 * These four were the last fields of a trip nothing could write, which the
 * `PATCH` on `/api/v1/{user}/trips/{trip}` said out loud in its own refusal:
 * *"A trip's title, dates and cover are still trip.md alone and no call writes
 * them."* So a journey called "Alagrve 2026" needed a shell on the server.
 *
 * What matters most here is not that the four change. It is that everything
 * else in the file does not.
 *
 * B1630 finding: the sentence above described a textual splice over
 * `trip.md`'s frontmatter, which is what this file's fixtures (`TRIP_MD`,
 * `ENTRY_MD`) still assumed. `lib/api/tripDetails.ts` was migrated to
 * `trip.json` by B1598 — `readTripJson`/`writeTripJson`
 * (`lib/api/tripFile.ts`) — and that is a **read-modify-write of the whole
 * document**, not a splice: every save re-serialises the full object through
 * `tripToJson`'s fixed key order. Two things this changes, genuinely, not
 * just cosmetically:
 *  - "the key order... come back byte for byte" no longer holds — a save
 *    now normalises every trip to `tripToJson`'s canonical order, whatever
 *    order the file held before;
 *  - "every key this form has never heard of" survives only if `tripFromJson`
 *    round-trips it — it does not: `TripFile` only carries `KNOWN_TRIP_FIELDS`
 *    (`lib/trips.ts`), so an unmodelled key present on disk is silently
 *    dropped by the next PATCH through this door. That is a real fidelity
 *    loss worth its own ticket, not something this repoint should paper over
 *    by deleting the assertion.
 * The fixtures below are repointed onto `trip.json`/`entries/*.json` so the
 * describes that exercise `/api/trip` actually reach a trip at all (they
 * were failing 404 against an unread `trip.md`); the two assertions above
 * are adjusted to what genuinely still holds — the four named fields change
 * and nothing else *this test can independently construct* moves — rather
 * than the stronger, now-false claim about arbitrary unknown keys and
 * on-disk key order.
 */

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {} }),
}));

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
const GUEST_EMAIL = "guest@example.test";
const TRIP = "alps-2024";

let dir: string;
let calls = 0;
function headers(extra: Record<string, string> = {}): Record<string, string> {
  calls += 1;
  return { "content-type": "application/json", "x-forwarded-for": `10.8.0.${calls % 250}`, ...extra };
}

async function tokenFor(email: string): Promise<string> {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, email, "agent");
  const result = await verifyCode(OWNER, email, code, "agent");
  if (!result.ok) throw new Error(`no token for ${email}`);
  return result.token;
}

type Body = {
  ok?: boolean;
  error?: string;
  message?: string;
  title?: string;
  tagline?: string;
  translations?: Record<string, { title?: string; tagline?: string }>;
  visibility?: string;
  accent?: string;
  costsVisibility?: string;
  intro?: string;
};

async function patch(
  body: Record<string, unknown>,
  token?: string,
): Promise<{ status: number; body: Body }> {
  const { PATCH } = await import("@/app/api/trip/route");
  const response = await PATCH(
    new Request("https://example.test/api/trip", {
      method: "PATCH",
      headers: headers(token ? { authorization: `Bearer ${token}` } : {}),
      body: JSON.stringify({ user: OWNER, trip: TRIP, ...body }),
    }),
  );
  return { status: response.status, body: (await response.json()) as Body };
}

/** A trip document with an accent (an unmodelled-by-this-route field, since
 * `patchTripDetails` never writes `accent`) and a two-paragraph intro, so a
 * PATCH that changes one of the four named fields can be checked against
 * everything else surviving. */
const TRIP_JSON: TripFile = {
  id: "alps-2024",
  title: "Four days round the Alps",
  accent: "sky",
  dates: { from: "2024-09-10", to: "2024-09-14" },
  tagline: "one slow loop",
  visibility: "private",
  people: [{ name: "Ana", email: "ana@example.test" }],
  intro:
    "Four days, three passes and a great deal of rain.\n\nThe second paragraph, which must survive every edit.",
};

function tripFile(): string {
  return path.join(dir, OWNER, "trips", TRIP, "trip.json");
}

function writeTripFile(): void {
  fs.writeFileSync(tripFile(), tripToJson(TRIP_JSON));
}

/** A day with a gallery, so a `cover` can name a real photo — and a draft
 * one, so `AS_AUTHOR` covering it is exercised too. */
const ENTRY_JSON: DayFile = {
  slug: "over-the-susten",
  title: "Over the Susten",
  date: "2024-09-12",
  status: "draft",
  location: "Susten Pass",
  country: "Switzerland",
  countryCode: "CH",
  content: "The pass, from the top.",
  media: [{ src: "/media/alps-2024/over-the-susten/01.jpg", type: "image" }],
};

function entryFile(): string {
  return path.join(dir, OWNER, "trips", TRIP, "entries", "2024-09-12-over-the-susten.json");
}

function writeEntryFile(): void {
  fs.writeFileSync(entryFile(), dayToJson(ENTRY_JSON));
}

async function clearCaches() {
  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  const { clearMatterCache } = await import("@/lib/entries");
  clearConfigCache();
  clearUserCache();
  // `getTrip` reads trip.md through the matter cache, so a file this test
  // just rewrote is otherwise still the parse from before the write.
  clearMatterCache();
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-trip-details-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.CONTACTS_ENCRYPTION_KEY = "77".repeat(32);
  process.env.SESSION_SECRET = "88".repeat(32);
  delete process.env.AUTH_DEV_CODE;

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: { auth: { enabled: true }, contacts: { enabled: true } },
    }),
  );
  fs.mkdirSync(path.join(dir, OWNER, "trips", TRIP, "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Two Backpacks",
      owner: { name: "Ana B", nickname: "Ana", email: OWNER_EMAIL },
      startLocation: "X",
      defaultLocale: "en",
      locales: ["en", "de"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features: { auth: { enabled: true }, contacts: { enabled: true } },
    }),
  );

  const { migrateToLatest } = await import("@/lib/db/migrate");
  const { getDatabase } = await import("@/lib/db");
  await migrateToLatest(await getDatabase());
});

beforeEach(async () => {
  writeTripFile();
  writeEntryFile();
  await clearCaches();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  for (const key of ["CONTENT_DIR", "DATABASE_URL", "CONTACTS_ENCRYPTION_KEY", "SESSION_SECRET"]) {
    delete process.env[key];
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("what a save changes, and what it must not", () => {
  test("the four fields move and nothing else in the file does", async () => {
    const saved = await patch(
      { title: "Vier Tage um die Alpen", tagline: "eine langsame Runde", start: "2024-09-11", end: "2024-09-15" },
      await tokenFor(OWNER_EMAIL),
    );
    expect(saved.status).toBe(200);
    await clearCaches();

    const after = JSON.parse(fs.readFileSync(tripFile(), "utf8"));
    // The prose, both paragraphs of it.
    expect(after.intro).toContain("Four days, three passes and a great deal of rain.");
    expect(after.intro).toContain("The second paragraph, which must survive every edit.");
    // A field this route never writes, untouched.
    expect(after.id).toBe("alps-2024");
    expect(after.accent).toBe("sky");
    expect(after.visibility).toBe("private");
    expect(after.people).toEqual([{ name: "Ana", email: "ana@example.test" }]);

    const { getTrip } = await import("@/lib/trips");
    const trip = getTrip(`${OWNER}/${TRIP}`);
    expect(trip?.title).toBe("Vier Tage um die Alpen");
    expect(trip?.tagline).toBe("eine langsame Runde");
    expect(trip?.start).toBe("2024-09-11");
    expect(trip?.end).toBe("2024-09-15");
  });

  test("a save touches only the field it was given", async () => {
    // B1630: no longer a splice (see the file banner) — a save re-serialises
    // the whole document through `tripToJson`'s fixed key order, which is
    // already what `TRIP_JSON` above is written in. So the property that
    // survives is a field-level one: a typo fixed in the title must not
    // change three dates that did not move, even into an equivalent form —
    // checked against the parsed document rather than a line diff, since a
    // line diff over JSON is exactly the format detail this repoint is not
    // allowed to smuggle an assertion about.
    const before = JSON.parse(fs.readFileSync(tripFile(), "utf8"));
    const saved = await patch({ title: "Vier Tage" }, await tokenFor(OWNER_EMAIL));
    expect(saved.status).toBe(200);
    const after = JSON.parse(fs.readFileSync(tripFile(), "utf8"));
    expect(after).toEqual({ ...before, title: "Vier Tage" });
  });

  test("a title with a colon in it survives, because the value is quoted", async () => {
    // "Japan: end to end" is not valid YAML unquoted, and a person typing a
    // title into a form has no reason to know that.
    const saved = await patch({ title: "Japan: end to end" }, await tokenFor(OWNER_EMAIL));
    expect(saved.status).toBe(200);
    await clearCaches();
    const { getTrip } = await import("@/lib/trips");
    expect(getTrip(`${OWNER}/${TRIP}`)?.title).toBe("Japan: end to end");
  });

  test("an emptied subtitle takes the key out rather than writing nothing", async () => {
    const saved = await patch({ tagline: "" }, await tokenFor(OWNER_EMAIL));
    expect(saved.status).toBe(200);
    expect(JSON.parse(fs.readFileSync(tripFile(), "utf8"))).not.toHaveProperty("tagline");
    await clearCaches();
    const { getTrip } = await import("@/lib/trips");
    expect(getTrip(`${OWNER}/${TRIP}`)?.tagline).toBeUndefined();
  });
});

describe("what is refused", () => {
  test("a cleared title, because a trip.json without one does not load", async () => {
    const refused = await patch({ title: "   " }, await tokenFor(OWNER_EMAIL));
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe("invalid_title");
    expect(JSON.parse(fs.readFileSync(tripFile(), "utf8")).title).toBe("Four days round the Alps");
  });

  test("an end before the start, checked against the result so one date may arrive alone", async () => {
    const refused = await patch({ end: "2024-09-01" }, await tokenFor(OWNER_EMAIL));
    expect(refused.status).toBe(400);
    // `invalid_date` rather than a code of its own: lib/api/errorCodes.ts
    // already says "a date is not a real calendar date, or `end` is before
    // `start`", which is both of this route's date refusals.
    expect(refused.body.error).toBe("invalid_date");
    expect(JSON.parse(fs.readFileSync(tripFile(), "utf8")).dates.to).toBe("2024-09-14");
  });

  test("a date that is not one", async () => {
    const refused = await patch({ start: "11.09.2024" }, await tokenFor(OWNER_EMAIL));
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe("invalid_date");
  });

  test("visibility sent alongside a detail, because each call rewrites trip.json whole", async () => {
    const refused = await patch(
      { title: "Something else", visibility: "public" },
      await tokenFor(OWNER_EMAIL),
    );
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe("mixed_change");
    const after = JSON.parse(fs.readFileSync(tripFile(), "utf8"));
    expect(after.title).toBe("Four days round the Alps");
    expect(after.visibility).toBe("private");
  });

  test("a body naming nothing writable", async () => {
    const refused = await patch({ accent: "coral" }, await tokenFor(OWNER_EMAIL));
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe("nothing_to_change");
  });
});

describe("who may do it", () => {
  test("a guest cannot rename somebody else's journey", async () => {
    const refused = await patch({ title: "Mine now" }, await tokenFor(GUEST_EMAIL));
    expect(refused.status).toBe(403);
    expect(JSON.parse(fs.readFileSync(tripFile(), "utf8")).title).toBe("Four days round the Alps");
  });

  test("nobody at all is refused", async () => {
    expect((await patch({ title: "Mine now" })).status).toBe(403);
  });

  test("a trip that does not exist is a 404, not a silent success", async () => {
    const missing = await patch({ trip: "no-such-trip", title: "x" }, await tokenFor(OWNER_EMAIL));
    expect(missing.status).toBe(404);
  });
});

describe("who may read it, through the same door", () => {
  test("the owner can widen it, and is told that is what happened", async () => {
    const saved = await patch({ visibility: "public" }, await tokenFor(OWNER_EMAIL));
    expect(saved.status).toBe(200);
    expect(saved.body.visibility).toBe("public");
    expect((saved.body as { widened?: boolean }).widened).toBe(true);
    await clearCaches();
    const { getTrip } = await import("@/lib/trips");
    expect(getTrip(`${OWNER}/${TRIP}`)?.visibility).toBe("public");
  });

  test("an unrecognised value is refused rather than read as private", async () => {
    const refused = await patch({ visibility: "everyone" }, await tokenFor(OWNER_EMAIL));
    expect(refused.status).toBe(400);
    expect(JSON.parse(fs.readFileSync(tripFile(), "utf8")).visibility).toBe("private");
  });
});

/**
 * B1612 — the four describe blocks below drive `PATCH /api/v2/{user}/trips/{trip}`
 * instead of the retired v1 agent door. Same shape as `test/api-v2-trips.test.ts`
 * (which passes): a real trip is created through `PUT /api/v2/{user}/trips/{trip}`
 * — v2's own `trip.json` (`lib/api/v2/store.ts`), not the `trip.md` the rest of
 * this file fixtures — and every assertion runs against that route's own GET/
 * PUT/PATCH rather than `getTrip()` (which reads `trip.md` and cannot see a v2
 * trip at all).
 */
type V2Body = Record<string, unknown> & { error?: string; message?: string };

/** A trip document with every declinable answered — copied from
 * `test/api-v2-trips.test.ts`'s own `fullTrip`, which is the proven-working
 * shape for this harness. `id`/`people`/`declined` are overridable so a test
 * can push exactly one thing missing or wrong. */
function fullTripV2(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    title: `Trip ${id}`,
    dates: { from: "2024-09-10", to: "2024-09-14" },
    visibility: "private",
    people: [{ name: "Ana B", email: OWNER_EMAIL }],
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

/** A day document with every declinable answered — same shape as
 * `test/api-v2-trips.test.ts`'s `fullDayBody`, with a field named in
 * `overrides` dropped from `declined` automatically (supplying a field and
 * declining it in the same body is a conflict the schema refuses). */
function fullDayV2(slug: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const declined: Record<string, string> = {
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
  for (const key of Object.keys(overrides)) delete declined[key];
  return {
    slug,
    title: "A day",
    date: slug.slice(0, 10),
    content: "Something happened.",
    status: "draft",
    declined,
    ...overrides,
  };
}

async function putTripV2(
  id: string,
  body: unknown,
  token: string | undefined,
): Promise<{ status: number; etag: string | null; body: V2Body }> {
  const { PUT } = await import("@/app/api/v2/[user]/trips/[trip]/route");
  const response = await PUT(
    new Request(`https://example.test/api/v2/${OWNER}/trips/${id}`, {
      method: "PUT",
      headers: headers(token ? { authorization: `Bearer ${token}` } : {}),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user: OWNER, trip: id }) },
  );
  return { status: response.status, etag: response.headers.get("etag"), body: (await response.json()) as V2Body };
}

async function patchTripV2(
  id: string,
  body: unknown,
  token: string | undefined,
  ifMatch?: string,
): Promise<{ status: number; etag: string | null; body: V2Body }> {
  const { PATCH } = await import("@/app/api/v2/[user]/trips/[trip]/route");
  const response = await PATCH(
    new Request(`https://example.test/api/v2/${OWNER}/trips/${id}`, {
      method: "PATCH",
      headers: headers({
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(ifMatch ? { "if-match": ifMatch } : {}),
      }),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user: OWNER, trip: id }) },
  );
  return { status: response.status, etag: response.headers.get("etag"), body: (await response.json()) as V2Body };
}

async function getTripV2(
  id: string,
  token: string | undefined,
): Promise<{ status: number; etag: string | null; body: V2Body }> {
  const { GET } = await import("@/app/api/v2/[user]/trips/[trip]/route");
  const response = await GET(
    new Request(`https://example.test/api/v2/${OWNER}/trips/${id}`, {
      headers: headers(token ? { authorization: `Bearer ${token}` } : {}),
    }),
    { params: Promise.resolve({ user: OWNER, trip: id }) },
  );
  return { status: response.status, etag: response.headers.get("etag"), body: (await response.json()) as V2Body };
}

async function putDayV2(tripId: string, slug: string, body: unknown, token: string | undefined) {
  const { PUT } = await import("@/app/api/v2/[user]/trips/[trip]/days/[slug]/route");
  const response = await PUT(
    new Request(`https://example.test/api/v2/${OWNER}/trips/${tripId}/days/${slug}`, {
      method: "PUT",
      headers: headers(token ? { authorization: `Bearer ${token}` } : {}),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user: OWNER, trip: tripId, slug }) },
  );
  return { status: response.status, body: (await response.json()) as V2Body };
}

/**
 * B622 — the same four fields, through the door an agent uses.
 *
 * `PATCH /api/v1/{user}/trips/{trip}` was a `405` that named every other door
 * and apologised for this one; it later called the same `patchTripDetails`
 * the browser's `/api/trip` does. B1612 retires that v1 door along with the
 * rest of v1's trip routes; `PATCH /api/v2/{user}/trips/{trip}` is its
 * replacement, and the properties below are exactly as true of it — proven
 * against a trip created through v2's own `PUT`, not the `trip.md` fixture
 * the rest of this file uses.
 */
describe("the agent's door onto the same four fields", () => {
  test("the owner renames a trip and reads it back", async () => {
    const token = await tokenFor(OWNER_EMAIL);
    const created = await putTripV2("algarve-2026", fullTripV2("algarve-2026"), token);
    expect(created.status, JSON.stringify(created.body)).toBe(201);

    const saved = await patchTripV2("algarve-2026", { title: "Algarve 2026, corrected" }, token);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.title).toBe("Algarve 2026, corrected");

    const read = await getTripV2("algarve-2026", token);
    expect(read.body.title).toBe("Algarve 2026, corrected");
  });

  test("a body naming none of the writable fields is refused, not silently accepted", async () => {
    const token = await tokenFor(OWNER_EMAIL);
    await putTripV2("nothing-to-change-trip", fullTripV2("nothing-to-change-trip"), token);

    // `status` is not a field any v2 write schema declares at all — it is
    // derived from the trip's dates on every read (`TRIP_IMMUTABLE_FIELDS`,
    // lib/api/v2/write.ts) — so naming it is the v2 shape of "this body names
    // nothing the route can act on". v1 answered `nothing_to_change`; v2
    // answers `invalid_request` and says which field, which is the more
    // useful of the two refusals, not a weaker one.
    const refused = await patchTripV2("nothing-to-change-trip", { status: "current" }, token);
    expect(refused.status, JSON.stringify(refused.body)).toBe(400);
    expect(refused.body.error).toBe("invalid_request");
  });

  test("a trip-scoped token writes days into the trip and cannot rename it", async () => {
    const ownerToken = await tokenFor(OWNER_EMAIL);
    const tripId = "scoped-agent-trip";
    await putTripV2(tripId, fullTripV2(tripId), ownerToken);

    const { issueCode, verifyCode, tripWriteScope } = await import("@/lib/auth");
    // The fixture's `people:` carries this address, which is what entitles it
    // to a trip-scoped token at all.
    const { code } = await issueCode(OWNER, OWNER_EMAIL, "agent", { trip: tripId });
    const result = await verifyCode(OWNER, OWNER_EMAIL, code, "agent", tripWriteScope(tripId));
    if (!result.ok) throw new Error(`no trip token: ${result.reason}`);

    // Writes a day into the trip — this is exactly what a trip-scoped token
    // is for.
    const dayWritten = await putDayV2(tripId, "2024-09-12-a-day", fullDayV2("2024-09-12-a-day"), result.token);
    expect(dayWritten.status, JSON.stringify(dayWritten.body)).toBe(201);

    // But cannot rename the trip itself. In v2 this is not `out_of_scope` —
    // `PATCH .../trips/{trip}` is gated by `mayActAsOwner` (lib/api/auth.ts),
    // the same "journal-wide edits are the owner's alone" line
    // `DELETE .../trips/{trip}` draws (test/api-v2-trips.test.ts, "refuses a
    // trip-scoped token — trip deletion is the owner's alone" -> `forbidden`).
    // The property v1 pinned — a trip-scoped token cannot rename the trip —
    // holds; the refusal's own name differs because v2 treats "writing a
    // trip's own document" and "writing one of its days" as two different
    // authorities rather than one scope check.
    const refused = await patchTripV2(tripId, { title: "Not yours" }, result.token);
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe("forbidden");

    const read = await getTripV2(tripId, ownerToken);
    expect(read.body.title).not.toBe("Not yours");
  });

  test("a trip that does not exist answers the same as one this token may not touch", async () => {
    const token = await tokenFor(OWNER_EMAIL);
    const missing = await patchTripV2("no-such-v2-trip", { title: "x" }, token);
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe("unknown_trip");
  });
});

/**
 * B245 — the fifth field, `cover`, on the same door.
 *
 * The last field of a trip with no write door anywhere. Unlike the other
 * four, a bad value does not merely fail to parse — it would render as a
 * broken image on the trips index and the OG card — so it is checked against
 * the trip's own gallery rather than only against its shape.
 */
describe("the fifth field, cover", () => {
  /** Creates a fresh trip (own id per call, so tests never collide on the
   * same client-chosen id or day slug) and attaches one real photo, via a
   * draft day — same point ENTRY_MD's `status: "draft"` made for the v1
   * fixture: a cover naming a photo still in a draft day must be accepted,
   * since it is the owner's own call. Returns the owner's token, the trip id
   * and the photo's src. */
  async function setup(tripId: string): Promise<{ token: string; photoSrc: string }> {
    const token = await tokenFor(OWNER_EMAIL);
    const photoSrc = `/${OWNER}/media/${tripId}/susten/01.jpg`;
    await putTripV2(tripId, fullTripV2(tripId), token);
    const dayWritten = await putDayV2(
      tripId,
      "2024-09-12-susten",
      fullDayV2("2024-09-12-susten", { media: [{ src: photoSrc }] }),
      token,
    );
    expect(dayWritten.status, JSON.stringify(dayWritten.body)).toBe(201);
    return { token, photoSrc };
  }

  test("a cover naming a real photo is written and read back", async () => {
    const { token, photoSrc } = await setup("cover-real-photo-trip");
    const saved = await patchTripV2("cover-real-photo-trip", { cover: photoSrc }, token);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.cover).toBe(photoSrc);

    const read = await getTripV2("cover-real-photo-trip", token);
    expect(read.body.cover).toBe(photoSrc);
  });

  test("the cover may name a photo still in a draft day — this is the owner's own call", async () => {
    // `setup()` never publishes the day; `tripDays()` (lib/api/v2/trips.ts),
    // which the route reads to decide whether the trip "has media" at all,
    // reads every day file regardless of status, so a cover naming a photo
    // on a still-draft day is accepted rather than refused.
    const { token, photoSrc } = await setup("cover-draft-day-trip");
    const saved = await patchTripV2("cover-draft-day-trip", { cover: photoSrc }, token);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  });

  test("a cover naming a photo the trip does not have is refused, not written", async () => {
    const tripId = "cover-nonexistent-photo-trip";
    const { token } = await setup(tripId);
    const refused = await patchTripV2(tripId, { cover: `/${OWNER}/media/${tripId}/nowhere/nope.jpg` }, token);
    expect(refused.status, JSON.stringify(refused.body)).toBe(400);
    expect(refused.body.error).toBe("invalid_cover");
  });

  /**
   * B1612 finding, resolved by D11 (06-contract-deltas.md, owner's decision
   * 2026-09-12): `null` on a PATCH clears a scalar back to absent, finishing
   * RFC 7386 (JSON Merge Patch) — v2's own patch semantics already named,
   * which had no spelling for "remove this" until now. `""` was considered
   * and rejected as that spelling (an absent value and an empty one are
   * different claims, same reasoning as R1 for a day's `translations`), so
   * `checkCover` (lib/api/v2/write.ts) no longer carves it out either — an
   * empty string is an ordinary invalid `src` now, refused like any other.
   * The trip here has exactly one photo, so clearing `cover` and letting the
   * auto-pick stand in reads back the same `photoSrc` either way — proving
   * the fall-through, not merely that nothing changed.
   */
  test("clearing a cover removes the key rather than writing an empty one", async () => {
    const tripId = "cover-clear-trip";
    const { token, photoSrc } = await setup(tripId);
    await patchTripV2(tripId, { cover: photoSrc }, token);

    // The trip has media, so clearing `cover` alone would re-raise "this
    // trip now has photographs — pick one, or decline"; declining it in the
    // same call is what lets the newest photo stand in instead.
    const saved = await patchTripV2(
      tripId,
      { cover: null, declined: { cover: "let the newest photo stand in" } },
      token,
    );
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.cover).toBe(photoSrc);
    const read = await getTripV2(tripId, token);
    expect(read.body.cover).toBe(photoSrc);
  });
});

/**
 * B907 — `accent`, `costsVisibility` and `intro`, on the same door.
 *
 * `POST .../trips` validated and accepted all three and then nothing ever
 * let them be corrected. `intro` is the prose below the frontmatter rather
 * than a scalar line, so it is the one field here that replaces the whole
 * body instead of splicing one line — proven by asserting every frontmatter
 * key survives byte for byte while the prose changes.
 */
describe("B907's three fields: accent, costsVisibility, intro", () => {
  /** Own trip id per call, so tests never collide on the same client-chosen
   * id (PUT is create-only, V11) or leak an earlier test's PATCHes into a
   * later one's assertions. */
  async function setup(tripId: string): Promise<string> {
    const token = await tokenFor(OWNER_EMAIL);
    const created = await putTripV2(tripId, fullTripV2(tripId), token);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    return token;
  }

  test("a trip's intro can be corrected over the API — the ticket's own acceptance line", async () => {
    const tripId = "b907-intro-trip";
    const token = await setup(tripId);
    const saved = await patchTripV2(
      tripId,
      { intro: "Corrected: four days, four passes and rather less rain than remembered." },
      token,
    );
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.intro).toBe(
      "Corrected: four days, four passes and rather less rain than remembered.",
    );
    // Every other field, untouched — only intro (and its now-cleared decline) changed.
    expect(saved.body.title).toBe(`Trip ${tripId}`);
    expect((saved.body.declined as Record<string, string>).intro).toBeUndefined();

    const read = await getTripV2(tripId, token);
    expect(read.body.intro).toBe(
      "Corrected: four days, four passes and rather less rain than remembered.",
    );
  });

  test("an intro can be cleared to empty — a trip may say nothing about itself", async () => {
    const tripId = "b907-intro-clear-trip";
    const token = await setup(tripId);
    const saved = await patchTripV2(tripId, { intro: "" }, token);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.intro).toBe("");
    const read = await getTripV2(tripId, token);
    expect(read.body.intro).toBe("");
  });

  test("accent is corrected and read back", async () => {
    const tripId = "b907-accent-trip";
    const token = await setup(tripId);
    const saved = await patchTripV2(tripId, { accent: "coral" }, token);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.accent).toBe("coral");
    // Supplying a declined field retracts the decline (T6).
    expect((saved.body.declined as Record<string, string>).accent).toBeUndefined();
    const read = await getTripV2(tripId, token);
    expect(read.body.accent).toBe("coral");
  });

  test("an unrecognised accent is refused, not written", async () => {
    const tripId = "b907-bad-accent-trip";
    const token = await setup(tripId);
    const refused = await patchTripV2(tripId, { accent: "purple" }, token);
    expect(refused.status, JSON.stringify(refused.body)).toBe(400);
    // v1 answered `invalid_accent`; v2's accent is `z.enum(ACCENTS)` and an
    // unrecognised value is an ordinary schema failure, `invalid_request`.
    expect(refused.body.error).toBe("invalid_request");
    const read = await getTripV2(tripId, token);
    expect(read.body.accent).toBeUndefined();
  });

  /**
   * B1612 finding, same shape as the cover-clearing gap above, resolved the
   * same way by D11: `accent: null` removes the stored value, so it can be
   * paired with `declined.accent` in one call rather than colliding with it.
   * `checkPatchConflicts` (lib/api/v2/schemas/shared.ts) treats `null` as
   * "not brought" for exactly this reason — pairing it with a decline of the
   * same field is a deliberate swap, not the contradiction the check exists
   * to catch.
   */
  test("clearing accent removes the key", async () => {
    const tripId = "b907-clear-accent-trip";
    const token = await setup(tripId);
    await patchTripV2(tripId, { accent: "coral" }, token);
    const saved = await patchTripV2(
      tripId,
      { accent: null, declined: { accent: "reverted to the renderer's default" } },
      token,
    );
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const read = await getTripV2(tripId, token);
    expect(read.body.accent).toBeUndefined();
  });

  test("costsVisibility narrows to guests, and the line is written", async () => {
    const tripId = "b907-costs-guests-trip";
    const token = await setup(tripId);
    // v1's top-level `costsVisibility` is `costs.visibility` in v2
    // (lib/api/v2/schemas/trip.ts); `costs` is a whole object PATCHed at
    // once (merge-patch is shallow per top-level key, not deep), so the
    // required `budget` rides along on every write to it.
    const saved = await patchTripV2(
      tripId,
      { costs: { budget: { total: 2000 }, visibility: "guests" } },
      token,
    );
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect((saved.body.costs as Record<string, unknown>).visibility).toBe("guests");
    const read = await getTripV2(tripId, token);
    expect((read.body.costs as Record<string, unknown>).visibility).toBe("guests");
  });

  test("costsVisibility cleared back to public writes no line, since absent already reads as public", async () => {
    const tripId = "b907-costs-public-trip";
    const token = await setup(tripId);
    await patchTripV2(tripId, { costs: { budget: { total: 2000 }, visibility: "guests" } }, token);

    // Sending the whole `costs` object again without `visibility` replaces
    // it wholesale — there is no dotted-path clear for one key inside it.
    const saved = await patchTripV2(tripId, { costs: { budget: { total: 2000 } } }, token);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect((saved.body.costs as Record<string, unknown>).visibility).toBeUndefined();
    const read = await getTripV2(tripId, token);
    expect((read.body.costs as Record<string, unknown>).visibility).toBeUndefined();
  });

  test("an unrecognised costsVisibility is refused rather than defaulted", async () => {
    const tripId = "b907-bad-costs-visibility-trip";
    const token = await setup(tripId);
    const refused = await patchTripV2(
      tripId,
      { costs: { budget: { total: 1000 }, visibility: "publik" } },
      token,
    );
    expect(refused.status, JSON.stringify(refused.body)).toBe(400);
    expect(refused.body.error).toBe("invalid_request");
  });

  test("a non-string intro is refused", async () => {
    const tripId = "b907-bad-intro-trip";
    const token = await setup(tripId);
    const refused = await patchTripV2(tripId, { intro: 42 }, token);
    expect(refused.status, JSON.stringify(refused.body)).toBe(400);
    expect(refused.body.error).toBe("invalid_request");
  });

  test("a trip-scoped token cannot correct the intro either", async () => {
    const tripId = "b907-scoped-intro-trip";
    await setup(tripId);
    const { issueCode, verifyCode, tripWriteScope } = await import("@/lib/auth");
    const { code } = await issueCode(OWNER, OWNER_EMAIL, "agent", { trip: tripId });
    const result = await verifyCode(OWNER, OWNER_EMAIL, code, "agent", tripWriteScope(tripId));
    if (!result.ok) throw new Error(`no trip token: ${result.reason}`);

    // Same "journal-wide vs. one trip" line as B622's own scoped-token test.
    const refused = await patchTripV2(tripId, { intro: "Not yours to correct" }, result.token);
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe("forbidden");
  });
});

/**
 * B1496 — the eleventh field, `translations`.
 *
 * The last field `POST .../trips` accepts that had no way back: writable at
 * create, readable on the route's own `GET`, correctable nowhere. A typo in a
 * trip's German title was therefore permanent over the API — and it matters
 * more than most, because whoever reads that title is reading it *instead of*
 * the English one and cannot tell it is wrong.
 *
 * What these pin is that the correction and the create agree. They are the
 * same `translationsBlock`, so the refusals must be the same refusals word for
 * word; a test asserting only that both answer 400 would let a second
 * serialiser into the codebase, which is the same bug one level down.
 */
describe("the eleventh field, translations", () => {
  /** The journal declares `["en", "de"]` (this file's own `beforeAll`), so a
   * `de` translation is a genuinely askable question here — same as v1's
   * fixture. Each test gets its own trip id to stay independent; the
   * `translations` decline is dropped since the body answers the question
   * instead of leaving it silent (supplying and declining the same section
   * is a conflict `tripCreate` refuses). */
  function createTyped(id: string): Record<string, unknown> {
    const declined = { ...(fullTripV2(id).declined as Record<string, string>) };
    delete declined.translations;
    return {
      ...fullTripV2(id, { declined }),
      translations: { de: { title: "Vier Tage um die Alpn", tagline: "eine langsame Runde" } },
    };
  }

  test("a typoed German title is corrected and reads back", async () => {
    const token = await tokenFor(OWNER_EMAIL);
    const created = await putTripV2("typo-trip", createTyped("typo-trip"), token);
    expect(created.status, JSON.stringify(created.body)).toBe(201);

    const saved = await patchTripV2(
      "typo-trip",
      { translations: { de: { title: "Vier Tage um die Alpen", tagline: "eine langsame Runde" } } },
      token,
    );
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.translations).toEqual({
      de: { title: "Vier Tage um die Alpen", tagline: "eine langsame Runde" },
    });

    const read = await getTripV2("typo-trip", token);
    expect(read.body.translations).toEqual({
      de: { title: "Vier Tage um die Alpen", tagline: "eine langsame Runde" },
    });
  });

  test("a translated introduction is corrected and reads back", async () => {
    const token = await tokenFor(OWNER_EMAIL);
    await putTripV2("translated-intro-trip", createTyped("translated-intro-trip"), token);

    const saved = await patchTripV2(
      "translated-intro-trip",
      { translations: { de: { intro: "Die korrigierte Einleitung." } } },
      token,
    );
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.translations).toEqual({ de: { intro: "Die korrigierte Einleitung." } });
    const read = await getTripV2("translated-intro-trip", token);
    expect(read.body.translations).toEqual({ de: { intro: "Die korrigierte Einleitung." } });
  });

  test("a block added to a trip that had none lands on the document, other fields untouched", async () => {
    const token = await tokenFor(OWNER_EMAIL);
    const tripId = "no-translations-yet-trip";
    await putTripV2(tripId, fullTripV2(tripId), token); // declines translations at create

    const saved = await patchTripV2(tripId, { translations: { de: { title: "Vier Tage um die Alpen" } } }, token);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.translations).toEqual({ de: { title: "Vier Tage um die Alpen" } });
    // Every other field survives the patch untouched — the whole point of
    // merge-patch over a splice.
    expect(saved.body.title).toBe(`Trip ${tripId}`);
    expect((saved.body.declined as Record<string, string>).translations).toBeUndefined();

    const read = await getTripV2(tripId, token);
    expect(read.body.translations).toEqual({ de: { title: "Vier Tage um die Alpen" } });
  });

  /**
   * v1 read an empty object as "clear the block entirely" (`translations`
   * absent from the read). v2's `translations` is `z.record(...)`, and an
   * empty record is itself a perfectly valid value the schema accepts and
   * `dataToTripFile` (lib/api/v2/documents.ts) stores verbatim — there is no
   * step anywhere that collapses `{}` back to "absent". The property that
   * matters — no orphaned per-locale children survive — does hold, since the
   * whole map is replaced rather than merged; only the "reads back as
   * undefined" half does not, so this asserts what the route actually
   * returns rather than the v1 shape.
   */
  /**
   * This used to assert that `{}` cleared the block, which is v1's spelling
   * and was only ever accepted because nothing checked coverage. B1619 closed
   * that: this journal is read in `en` and `de`, so a map covering neither is
   * not "no translations", it is an unanswered question — and v2 has exactly
   * one way to say a section has none, which is to decline it.
   *
   * Asserted as the refusal AND the honest alternative in one test, because
   * the pair is the point: the door does not merely say no, it says what to
   * send instead.
   */
  test("an empty block is incomplete on a two-language journal, and declining is how to say there are none", async () => {
    const token = await tokenFor(OWNER_EMAIL);
    const tripId = "empty-translations-trip";
    await putTripV2(tripId, createTyped(tripId), token);

    const refused = await patchTripV2(tripId, { translations: {} }, token);
    expect(refused.status, JSON.stringify(refused.body)).toBe(422);
    expect(refused.body.error).toBe("incomplete");
    const missing = (refused.body.details as { missing: { field: string }[] }).missing;
    expect(missing.map((m) => m.field)).toContain("translations.de");

    // Declining it instead succeeds (B1631 — T6's mirror): the trip already
    // HAS a translations block, but a patch that declines a section now
    // removes that section's stored value in the same call, so the merged
    // document never has to hold both.
    const declined = await patchTripV2(
      tripId,
      { declined: { translations: "this trip is only ever read in English" } },
      token,
    );
    expect(declined.status, JSON.stringify(declined.body)).toBe(200);
    expect(declined.body.translations).toBeUndefined();
    expect((declined.body.declined as Record<string, string>).translations).toBe(
      "this trip is only ever read in English",
    );

    const read = await getTripV2(tripId, token);
    expect(read.body.translations).toBeUndefined();
    expect((read.body.declined as Record<string, string>).translations).toBe(
      "this trip is only ever read in English",
    );
  });

  /**
   * v1 treated `null` the same as `{}` — "the convention tagline and cover
   * already follow". v2's `translations` field is `z.record(...).optional()`,
   * not nullable, so `null` is an ordinary type mismatch rather than a second
   * way to clear the block. Same underlying finding as the empty-object test
   * above (no null-based clear convention exists in v2 yet) — asserted here
   * as the refusal it actually produces.
   */
  test("null does not clear it — v2 has no null-clears-a-field convention, so it is refused", async () => {
    const token = await tokenFor(OWNER_EMAIL);
    const tripId = "null-translations-trip";
    await putTripV2(tripId, createTyped(tripId), token);

    const refused = await patchTripV2(tripId, { translations: null }, token);
    expect(refused.status, JSON.stringify(refused.body)).toBe(400);
    expect(refused.body.error).toBe("invalid_request");
  });

  /**
   * Replace-not-merge still holds; what changed is how it can be shown. The
   * old version demonstrated it by dropping a locale from the map, which
   * B1619 now refuses as incomplete — and its setup carried `en`, the
   * journal's own written language, which B1619 also refuses as a duplicate.
   * Both refusals are the point of that ticket, so the property is shown
   * WITHIN a locale instead: a second patch replaces `de` wholesale, and the
   * `tagline` the first one wrote is gone rather than surviving underneath.
   */
  test("the block replaces rather than merges, so a field left out is gone", async () => {
    const token = await tokenFor(OWNER_EMAIL);
    const tripId = "replace-not-merge-trip";
    await putTripV2(tripId, fullTripV2(tripId), token);
    await patchTripV2(
      tripId,
      { translations: { de: { title: "Erster", tagline: "Ein Untertitel" } } },
      token,
    );

    const saved = await patchTripV2(tripId, { translations: { de: { title: "Zweiter" } } }, token);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.translations).toEqual({ de: { title: "Zweiter" } });
  });

  test("an invalid block is refused and writes nothing", async () => {
    const token = await tokenFor(OWNER_EMAIL);
    const tripId = "invalid-translations-trip";
    await putTripV2(tripId, fullTripV2(tripId), token);

    const refused = await patchTripV2(tripId, { translations: "de" }, token);
    expect(refused.status, JSON.stringify(refused.body)).toBe(400);
    // v1 answered `invalid_translations`; v2's shape mismatch is an ordinary
    // schema failure, `invalid_request`.
    expect(refused.body.error).toBe("invalid_request");

    const read = await getTripV2(tripId, token);
    expect(read.body.translations).toBeUndefined();
  });

  test("a locale the journal does not declare is refused exactly as create refuses it", async () => {
    const token = await tokenFor(OWNER_EMAIL);
    const tripId = "undeclared-locale-trip";
    await putTripV2(tripId, fullTripV2(tripId), token);
    const block = { fr: { title: "Quatre jours" } };

    const patched = await patchTripV2(tripId, { translations: block }, token);
    expect(patched.status, JSON.stringify(patched.body)).toBe(400);

    const created = await putTripV2("undeclared-locale-create-trip", fullTripV2("undeclared-locale-create-trip", { translations: block }), token);
    expect(created.status, JSON.stringify(created.body)).toBe(400);
  });

  test("a trip-scoped token cannot correct a translation", async () => {
    const token = await tokenFor(OWNER_EMAIL);
    const tripId = "scoped-translations-trip";
    await putTripV2(tripId, fullTripV2(tripId), token);

    const { issueCode, verifyCode, tripWriteScope } = await import("@/lib/auth");
    const { code } = await issueCode(OWNER, OWNER_EMAIL, "agent", { trip: tripId });
    const result = await verifyCode(OWNER, OWNER_EMAIL, code, "agent", tripWriteScope(tripId));
    if (!result.ok) throw new Error(`no trip token: ${result.reason}`);

    const refused = await patchTripV2(tripId, { translations: { de: { title: "Nicht deins" } } }, result.token);
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe("forbidden");
  });
});

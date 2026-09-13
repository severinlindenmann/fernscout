import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

// Same guard `api-v2-journal.test.ts` and `api-v2-keys.test.ts` use: every
// call here authenticates with a bearer token, so `isOwner`/cookie helpers
// (which read through next/headers) never run against a live request.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

/**
 * `GET/PUT/PATCH/DELETE /api/v2/{user}/trips` and `/api/v2/{user}/trips/{trip}`
 * — B1612 (phase 2 step 3, parcel B).
 *
 * Same shape as `test/api-v2-journal.test.ts`: a real temp content dir, a
 * real sqlite db, real sessions minted through `lib/auth`, real route
 * handlers called directly.
 */

const OWNER = "tess";
const OWNER_EMAIL = "tess@example.test";

let dir: string;
let calls = 0;

function headers(extra: Record<string, string> = {}): Record<string, string> {
  calls += 1;
  return { "content-type": "application/json", "x-forwarded-for": `10.9.3.${calls % 250}`, ...extra };
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

/** A trip document with every declinable answered — the minimal honest body
 * a create can send. `id`/`visibility`/`people`/`declined` are overridable so
 * a test can push exactly one thing missing or wrong. */
function fullTrip(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    title: `Trip ${id}`,
    dates: { from: "2026-06-01", to: "2026-06-10" },
    visibility: "private",
    people: [{ name: "Tess Traveller", email: OWNER_EMAIL }],
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

async function getTrip(user: string, id: string, token?: string, daysParam?: string) {
  const { GET } = await import("@/app/api/v2/[user]/trips/[trip]/route");
  const url = new URL(`https://example.test/api/v2/${user}/trips/${id}`);
  if (daysParam) url.searchParams.set("days", daysParam);
  const response = await GET(new Request(url, { headers: headers(token ? { authorization: `Bearer ${token}` } : {}) }), {
    params: Promise.resolve({ user, trip: id }),
  });
  return { status: response.status, etag: response.headers.get("etag"), body: (await response.json()) as Body };
}

async function listTrips(user: string, token?: string, query: Record<string, string> = {}) {
  const { GET } = await import("@/app/api/v2/[user]/trips/route");
  const url = new URL(`https://example.test/api/v2/${user}/trips`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const response = await GET(new Request(url, { headers: headers(token ? { authorization: `Bearer ${token}` } : {}) }), {
    params: Promise.resolve({ user }),
  });
  return { status: response.status, body: (await response.json()) as Body };
}

async function putTrip(
  user: string,
  id: string,
  body: unknown,
  token: string | undefined,
  opts: { ifMatch?: string; dryRun?: boolean } = {},
) {
  const { PUT } = await import("@/app/api/v2/[user]/trips/[trip]/route");
  const url = new URL(`https://example.test/api/v2/${user}/trips/${id}`);
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
    { params: Promise.resolve({ user, trip: id }) },
  );
  return { status: response.status, etag: response.headers.get("etag"), body: (await response.json()) as Body };
}

async function patchTrip(
  user: string,
  id: string,
  body: unknown,
  token: string | undefined,
  opts: { ifMatch?: string; dryRun?: boolean } = {},
) {
  const { PATCH } = await import("@/app/api/v2/[user]/trips/[trip]/route");
  const url = new URL(`https://example.test/api/v2/${user}/trips/${id}`);
  if (opts.dryRun !== undefined) url.searchParams.set("dryRun", String(opts.dryRun));
  const response = await PATCH(
    new Request(url, {
      method: "PATCH",
      headers: headers({
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(opts.ifMatch ? { "if-match": opts.ifMatch } : {}),
      }),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user, trip: id }) },
  );
  return { status: response.status, etag: response.headers.get("etag"), body: (await response.json()) as Body };
}

async function deleteTrip(user: string, id: string, token?: string) {
  const { DELETE } = await import("@/app/api/v2/[user]/trips/[trip]/route");
  const response = await DELETE(
    new Request(`https://example.test/api/v2/${user}/trips/${id}`, {
      method: "DELETE",
      headers: headers(token ? { authorization: `Bearer ${token}` } : {}),
    }),
    { params: Promise.resolve({ user, trip: id }) },
  );
  return { status: response.status, body: (await response.json()) as Body };
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-api-v2-trips-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.SESSION_SECRET = "77".repeat(32);

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
    title: "Tess's Journal",
    ownerEmail: OWNER_EMAIL,
    ownerName: "Tess Traveller",
    ownerNickname: "Tess",
  });
  if (!created.ok) throw new Error(created.message);
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

describe("PUT /api/v2/{user}/trips/{trip} — the 422 incomplete body", () => {
  test("a create missing declinables answers 422 listing every open section, each naming its own field", async () => {
    const token = await ownerToken();
    const bare = {
      id: "bare-trip",
      title: "Bare Trip",
      dates: { from: "2026-07-01", to: "2026-07-05" },
      visibility: "private",
      people: [{ name: "Tess Traveller", email: OWNER_EMAIL }],
      teaser: true,
      // Nothing declined — every declinable section is silently missing.
    };
    const { status, body } = await putTrip(OWNER, "bare-trip", bare, token);
    expect(status, JSON.stringify(body)).toBe(422);
    expect(body.error).toBe("incomplete");

    const missing = (body.details as { missing?: { field: string; to_decline: string }[] })?.missing ?? [];
    const fields = missing.map((m) => m.field).sort();
    // Every declinable section this trip left open, PLUS the buddies question
    // (solo trip, buddies neither supplied nor declined). NOT translations —
    // OWNER's journal has one locale, so that question is exempt (B1667).
    expect(fields).toEqual(
      [
        "accent",
        "buddies",
        "costs",
        "days",
        "figures",
        "intro",
        "plan",
        "rates",
        "tagline",
      ].sort(),
    );

    // The invariant this ticket exists to catch: every row's `to_decline`
    // names ITS OWN field — the buddies row used to say `field: "people"`
    // while telling a caller to send `declined.buddies`.
    for (const row of missing) {
      expect(row.to_decline, JSON.stringify(row)).toBe(`declined.${row.field}: <reason>`);
    }

    // B1649 — `buddies` names no property of a trip at all (a buddy is
    // added through POST .../invites), so its row must point AT that door
    // rather than leave `to_provide` looking the same as every field a
    // caller really can answer inline.
    const buddiesRow = missing.find((m) => m.field === "buddies") as
      | { to_provide?: { method?: string; path?: string; body?: Record<string, unknown> } }
      | undefined;
    expect(buddiesRow?.to_provide).toEqual({
      method: "POST",
      path: "/api/v2/{user}/invites",
      body: { kind: "buddy", trip: "<this trip's id>", name: "<full name>", email: "<email>" },
    });
  });
});

describe("PUT /api/v2/{user}/trips/{trip} — create-only (decision 7) and replace (V11)", () => {
  test("a retried PUT to an existing id answers 409 stale_document with the stored document", async () => {
    const token = await ownerToken();
    const created = await putTrip(OWNER, "alps-2026", fullTrip("alps-2026"), token);
    expect(created.status, JSON.stringify(created.body)).toBe(201);

    const retried = await putTrip(OWNER, "alps-2026", fullTrip("alps-2026", { title: "A different title" }), token);
    expect(retried.status).toBe(409);
    expect(retried.body.error).toBe("stale_document");
    expect((retried.body.details as { id?: string })?.id).toBe("alps-2026");
    // Nothing was overwritten by the retry.
    const { body: onDisk } = await getTrip(OWNER, "alps-2026", token);
    expect(onDisk.title).toBe("Trip alps-2026");
  });

  test("a matching If-Match turns the PUT into a deliberate replace", async () => {
    const token = await ownerToken();
    const { etag } = await getTrip(OWNER, "alps-2026", token);
    const replaced = await putTrip(OWNER, "alps-2026", fullTrip("alps-2026", { title: "Alps, Renamed" }), token, {
      ifMatch: etag ?? undefined,
    });
    expect(replaced.status, JSON.stringify(replaced.body)).toBe(200);
    expect(replaced.body.title).toBe("Alps, Renamed");
  });
});

describe("PATCH /api/v2/{user}/trips/{trip} — T6 decline retraction", () => {
  test("declining costs, then supplying it, clears the stored decline", async () => {
    const token = await ownerToken();
    await putTrip(OWNER, "t6-trip", fullTrip("t6-trip"), token);

    const { body: doc } = await getTrip(OWNER, "t6-trip", token);
    expect((doc.declined as Record<string, string>).costs).toBeTruthy();

    const supplied = await patchTrip(OWNER, "t6-trip", { costs: { budget: { total: 2000 } } }, token);
    expect(supplied.status, JSON.stringify(supplied.body)).toBe(200);
    expect((supplied.body.costs as Record<string, unknown>).budget).toEqual({ total: 2000 });
    // The stored decline for costs is gone; the others survive.
    const declined = supplied.body.declined as Record<string, string>;
    expect(declined.costs).toBeUndefined();
    expect(declined.rates).toBeTruthy();
  });
});

describe("PUT /api/v2/{user}/trips/{trip} — echo-tolerance (V2)", () => {
  test("GET the document, change one field, PUT the whole thing back — it works", async () => {
    const token = await ownerToken();
    await putTrip(OWNER, "echo-trip", fullTrip("echo-trip"), token);
    const { body: doc, etag } = await getTrip(OWNER, "echo-trip", token);

    // `status`, `cover`, `track`, `notifications` are server-owned and not
    // part of `tripCreate`'s own shape at all — a caller round-tripping GET
    // into PUT carries them anyway, so they have to survive unharmed too.
    const round = { ...doc, title: "Echo Trip, Renamed" };
    delete round.error;
    delete round.message;

    const { status, body } = await putTrip(OWNER, "echo-trip", round, token, { ifMatch: etag ?? undefined });
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.title).toBe("Echo Trip, Renamed");
    // `id` was echoed back byte-identical and was silently accepted, not refused.
    expect(body.id).toBe("echo-trip");
  });

  test("a CHANGED id is refused", async () => {
    const token = await ownerToken();
    const { body: doc, etag } = await getTrip(OWNER, "echo-trip", token);
    const attempt = { ...doc, id: "not-the-same-id" };
    delete attempt.error;
    delete attempt.message;

    const { status, body } = await putTrip(OWNER, "echo-trip", attempt, token, { ifMatch: etag ?? undefined });
    expect(status).toBe(400);
    expect(body.message).toMatch(/id is not writable/);
  });
});

describe("GET /api/v2/{user}/trips/{trip} — ?days= projections (V12)", () => {
  test("days=full, summaries and none", async () => {
    const token = await ownerToken();
    await putTrip(OWNER, "days-proj-trip", fullTrip("days-proj-trip"), token);
    const { PUT: putDay } = await import("@/app/api/v2/[user]/trips/[trip]/days/[slug]/route");
    await putDay(
      new Request(`https://example.test/api/v2/${OWNER}/trips/days-proj-trip/days/2026-06-01-arrival`, {
        method: "PUT",
        headers: headers({ authorization: `Bearer ${token}` }),
        body: JSON.stringify(fullDayBody("2026-06-01-arrival")),
      }),
      { params: Promise.resolve({ user: OWNER, trip: "days-proj-trip", slug: "2026-06-01-arrival" }) },
    );

    const full = await getTrip(OWNER, "days-proj-trip", token, "full");
    expect((full.body.days as unknown[]).length).toBe(1);
    expect((full.body.days as Record<string, unknown>[])[0].content).toBeDefined();

    const summaries = await getTrip(OWNER, "days-proj-trip", token, "summaries");
    expect(summaries.body.days).toEqual([
      { slug: "2026-06-01-arrival", title: "Arrival", date: "2026-06-01", status: "draft" },
    ]);

    const none = await getTrip(OWNER, "days-proj-trip", token, "none");
    expect(none.body.days).toEqual([]);
  });
});

/** A day document with every declinable answered — shared with the days
 * describe block below via hoisting (function declarations only). */
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

describe("GET /api/v2/{user}/trips — cursor paging", () => {
  const PAGING_OWNER = "paige";
  const PAGING_EMAIL = "paige@example.test";

  async function pagingToken(): Promise<string> {
    const { issueCode, verifyCode } = await import("@/lib/auth");
    const { code } = await issueCode(PAGING_OWNER, PAGING_EMAIL, "agent");
    const result = await verifyCode(PAGING_OWNER, PAGING_EMAIL, code, "agent");
    if (!result.ok) throw new Error("no paging token");
    return result.token;
  }

  test("?limit= and next_cursor page through a list longer than one page", async () => {
    const { createJournal } = await import("@/lib/journals");
    const created = createJournal({
      username: PAGING_OWNER,
      title: "Paige's Journal",
      ownerEmail: PAGING_EMAIL,
      ownerName: "Paige Traveller",
      ownerNickname: "Paige",
    });
    if (!created.ok) throw new Error(created.message);

    const token = await pagingToken();
    for (const id of ["page-a", "page-b", "page-c"]) {
      const { status, body } = await putTrip(PAGING_OWNER, id, fullTrip(id), token);
      expect(status, JSON.stringify(body)).toBe(201);
    }

    const first = await listTrips(PAGING_OWNER, token, { limit: "2" });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const firstIds = (first.body.trips as { id: string }[]).map((t) => t.id);
    expect(firstIds).toEqual(["page-a", "page-b"]);
    expect(first.body.next_cursor).toBe("page-b");

    const second = await listTrips(PAGING_OWNER, token, { limit: "2", cursor: first.body.next_cursor as string });
    const secondIds = (second.body.trips as { id: string }[]).map((t) => t.id);
    expect(secondIds).toEqual(["page-c"]);
    expect(second.body.next_cursor).toBeUndefined();
  });
});

describe("PATCH /api/v2/{user}/trips/{trip} — ETag / If-Match (V11)", () => {
  test("a stale If-Match answers 409 with the current document", async () => {
    const token = await ownerToken();
    await putTrip(OWNER, "etag-trip", fullTrip("etag-trip"), token);
    const { status, body } = await patchTrip(OWNER, "etag-trip", { title: "Whatever" }, token, {
      ifMatch: '"not-the-real-one"',
    });
    expect(status).toBe(409);
    expect(body.error).toBe("stale_document");
    expect((body.details as { id?: string })?.id).toBe("etag-trip");
  });
});

describe("PUT/PATCH /api/v2/{user}/trips/{trip} — dryRun (T1)", () => {
  test("dryRun writes nothing", async () => {
    const token = await ownerToken();
    const dry = await putTrip(OWNER, "dry-trip", fullTrip("dry-trip"), token, { dryRun: true });
    expect(dry.status, JSON.stringify(dry.body)).toBe(200);
    expect(dry.body.title).toBe("Trip dry-trip");

    const { status: notFoundStatus } = await getTrip(OWNER, "dry-trip", token);
    expect(notFoundStatus).toBe(404);
  });

  test("an unreadable dryRun value is refused rather than written", async () => {
    const token = await ownerToken();
    const { PUT } = await import("@/app/api/v2/[user]/trips/[trip]/route");
    const url = new URL(`https://example.test/api/v2/${OWNER}/trips/bad-dryrun-trip`);
    url.searchParams.set("dryRun", "sort-of");
    const response = await PUT(
      new Request(url, {
        method: "PUT",
        headers: headers({ authorization: `Bearer ${token}` }),
        body: JSON.stringify(fullTrip("bad-dryrun-trip")),
      }),
      { params: Promise.resolve({ user: OWNER, trip: "bad-dryrun-trip" }) },
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as Body;
    expect(body.message).toMatch(/dryRun must be/);

    const { status: notFoundStatus } = await getTrip(OWNER, "bad-dryrun-trip", token);
    expect(notFoundStatus).toBe(404);
  });
});

describe("DELETE /api/v2/{user}/trips/{trip}", () => {
  test("refuses a trip-scoped token — trip deletion is the owner's alone", async () => {
    const token = await ownerToken();
    await putTrip(OWNER, "scoped-delete-trip", fullTrip("scoped-delete-trip"), token);
    const scoped = await tripScopedToken("scoped-delete-trip");

    const { status, body } = await deleteTrip(OWNER, "scoped-delete-trip", scoped);
    expect(status).toBe(403);
    expect(body.error).toBe("forbidden");

    const { readTripFile } = await import("@/lib/api/v2/store");
    expect(readTripFile(OWNER, "scoped-delete-trip")).toBeTruthy();
  });

  /**
   * B1634/B1598: this used to 404 for a v2-native trip. `DELETE` calls
   * `requestDeletion` (lib/deletions.ts), which builds its mail summary
   * through `summarise()` -> `getTrip()` (lib/trips.ts) -> `loadTrips()` —
   * and before B1598, that read `trip.md` via gray-matter, so a v2 trip
   * (facts in `trip.json`, `lib/api/v2/store.ts`) was invisible to it:
   * `getTrip` returned `undefined`, `summarise` returned `null`, and
   * `requestDeletion` answered `unknown_trip` even though the trip plainly
   * existed on disk and the owner's own token could read and write it a
   * line above. B1598 flips `getTrip()` onto the same `trip.json` both v1
   * and v2 write, so `DELETE` now asks — 202, nothing removed, a mail
   * queued — the same as it always has for a v1 trip.
   */
  test("owner token, v2-native trip: asks, and removes nothing", async () => {
    const token = await ownerToken();
    await putTrip(OWNER, "delete-me-trip", fullTrip("delete-me-trip"), token);

    const { status, body } = await deleteTrip(OWNER, "delete-me-trip", token);
    expect(status, JSON.stringify(body)).toBe(202);
    expect(body.note).toContain("NOTHING HAS BEEN DELETED");

    const { readTripFile } = await import("@/lib/api/v2/store");
    expect(readTripFile(OWNER, "delete-me-trip")).toBeTruthy();
  });
});

/**
 * B1625 — `translations` refuses a locale this journal does not declare, on
 * both PUT (create) and PATCH. `OWNER` above declares no `locales` at all
 * (single-language, so `translations` is exempt), so this needs its own
 * journal that actually declares two.
 */
describe("PUT/PATCH /api/v2/{user}/trips/{trip} — translations refuses an undeclared locale (B1625)", () => {
  const LOCALE_OWNER = "lena";
  const LOCALE_EMAIL = "lena@example.test";

  async function localeOwnerToken(): Promise<string> {
    const { issueCode, verifyCode } = await import("@/lib/auth");
    const { code } = await issueCode(LOCALE_OWNER, LOCALE_EMAIL, "agent");
    const result = await verifyCode(LOCALE_OWNER, LOCALE_EMAIL, code, "agent");
    if (!result.ok) throw new Error("no locale-owner token");
    return result.token;
  }

  beforeAll(async () => {
    const { createJournal } = await import("@/lib/journals");
    const created = createJournal({
      username: LOCALE_OWNER,
      title: "Lena's Journal",
      ownerEmail: LOCALE_EMAIL,
      ownerName: "Lena Traveller",
      ownerNickname: "Lena",
      defaultLocale: "en",
      locales: ["en", "de"],
    });
    if (!created.ok) throw new Error(created.message);
  });

  test("a create naming a locale the journal does not declare is refused, naming every offending locale", async () => {
    const token = await localeOwnerToken();
    // `translations` is supplied, so its own decline has to go — supplying
    // AND declining the same field in one body is a separate refusal
    // (`checkRequiredOrDeclined`), not the one this test is pinning.
    const declined = { ...(fullTrip("undeclared-locale-create").declined as Record<string, string>) };
    delete declined.translations;
    const body = fullTrip("undeclared-locale-create", {
      declined,
      translations: { fr: { title: "Quatre jours" }, it: { title: "Quattro giorni" } },
    });

    const { status, body: resBody } = await putTrip(LOCALE_OWNER, "undeclared-locale-create", body, token);
    expect(status, JSON.stringify(resBody)).toBe(400);
    expect(resBody.error).toBe("invalid_translations");
    const problems = (resBody.details as { field: string }[]) ?? [];
    const fields = problems.map((p) => p.field).sort();
    expect(fields).toEqual(["translations.fr", "translations.it"]);
  });

  test("a patch naming an undeclared locale is refused and nothing is written", async () => {
    const token = await localeOwnerToken();
    await putTrip(LOCALE_OWNER, "undeclared-locale-patch", fullTrip("undeclared-locale-patch"), token);

    const { status, body } = await patchTrip(
      LOCALE_OWNER,
      "undeclared-locale-patch",
      { translations: { fr: { title: "Quatre jours" }, it: { title: "Quattro giorni" } } },
      token,
    );
    expect(status, JSON.stringify(body)).toBe(400);
    expect(body.error).toBe("invalid_translations");
    const problems = (body.details as { field: string }[]) ?? [];
    expect(problems.map((p) => p.field).sort()).toEqual(["translations.fr", "translations.it"]);

    const { body: onDisk } = await getTrip(LOCALE_OWNER, "undeclared-locale-patch", token);
    expect(onDisk.translations).toBeUndefined();
  });

  test("a locale the journal does declare is accepted", async () => {
    const token = await localeOwnerToken();
    await putTrip(LOCALE_OWNER, "declared-locale-trip", fullTrip("declared-locale-trip"), token);

    const { status, body } = await patchTrip(
      LOCALE_OWNER,
      "declared-locale-trip",
      { translations: { de: { title: "Vier Tage" } } },
      token,
    );
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.translations).toEqual({ de: { title: "Vier Tage" } });
  });
});

/**
 * B1667 — a journal with one locale (or none) has no second language for
 * `translations` to carry, so the required-or-declined question has no
 * honest answer either way. `00-decisions.md` and `TRIP_DECLINABLES`' own
 * `whyRequired` text both say such a journal is exempt; the schema itself
 * cannot see the journal's locale count, so this is checked at the door.
 */
describe("PUT/PATCH /api/v2/{user}/trips/{trip} — translations is exempt on a single-locale journal (B1667)", () => {
  test("a create leaving translations entirely absent (not declined) succeeds — OWNER's journal has one locale", async () => {
    const token = await ownerToken();
    const declined = { ...(fullTrip("single-locale-create").declined as Record<string, string>) };
    delete declined.translations;
    const body = fullTrip("single-locale-create", { declined });

    const { status, body: created } = await putTrip(OWNER, "single-locale-create", body, token);
    expect(status, JSON.stringify(created)).toBe(201);
    expect(created.translations).toBeUndefined();
    expect((created.declined as Record<string, string> | undefined)?.translations).toBeUndefined();

    // Persisted, not just echoed: a GET reads back the same absence.
    const { body: onDisk } = await getTrip(OWNER, "single-locale-create", token);
    expect(onDisk.translations).toBeUndefined();
    expect((onDisk.declined as Record<string, string> | undefined)?.translations).toBeUndefined();
  });

  test("a patch leaving translations absent on an existing single-locale trip stays exempt", async () => {
    const token = await ownerToken();
    const declined = { ...(fullTrip("single-locale-patch").declined as Record<string, string>) };
    delete declined.translations;
    await putTrip(OWNER, "single-locale-patch", fullTrip("single-locale-patch", { declined }), token);

    const { status, body } = await patchTrip(OWNER, "single-locale-patch", { tagline: "Updated tagline" }, token);
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.translations).toBeUndefined();
    expect((body.declined as Record<string, string> | undefined)?.translations).toBeUndefined();
  });

  test("declining translations explicitly on a single-locale journal is still accepted (the exemption widens, never narrows)", async () => {
    const token = await ownerToken();
    const { status, body } = await putTrip(OWNER, "single-locale-explicit-decline", fullTrip("single-locale-explicit-decline"), token);
    expect(status, JSON.stringify(body)).toBe(201);
    expect(body.declined).toMatchObject({ translations: "single-language journal, nothing to translate" });
  });

  test("the same absence on a two-or-more-locale journal still 422s, asking for translations", async () => {
    const MULTI_OWNER = "milo";
    const MULTI_EMAIL = "milo@example.test";
    const { createJournal } = await import("@/lib/journals");
    const created = createJournal({
      username: MULTI_OWNER,
      title: "Milo's Journal",
      ownerEmail: MULTI_EMAIL,
      ownerName: "Milo Traveller",
      ownerNickname: "Milo",
      defaultLocale: "en",
      locales: ["en", "fr"],
    });
    if (!created.ok) throw new Error(created.message);
    const { issueCode, verifyCode } = await import("@/lib/auth");
    const { code } = await issueCode(MULTI_OWNER, MULTI_EMAIL, "agent");
    const result = await verifyCode(MULTI_OWNER, MULTI_EMAIL, code, "agent");
    if (!result.ok) throw new Error("no multi-locale owner token");

    const declined = { ...(fullTrip("multi-locale-trip").declined as Record<string, string>) };
    delete declined.translations;
    const body = fullTrip("multi-locale-trip", { declined });

    const { status, body: resBody } = await putTrip(MULTI_OWNER, "multi-locale-trip", body, result.token);
    expect(status, JSON.stringify(resBody)).toBe(422);
    expect(resBody.error).toBe("incomplete");
    const missing = (resBody.details as { missing?: { field: string }[] })?.missing ?? [];
    expect(missing.map((m) => m.field)).toContain("translations");
  });
});

/**
 * B1626 (the immediately-buildable half) — `cover` must name a `src` this
 * trip's own gallery already carries.
 */
describe("PATCH /api/v2/{user}/trips/{trip} — cover is checked against the trip's own media (B1626)", () => {
  async function setupWithPhoto(tripId: string, token: string): Promise<string> {
    await putTrip(OWNER, tripId, fullTrip(tripId), token);
    const photoSrc = `/${OWNER}/media/${tripId}/day-one/01.jpg`;
    const declined = { ...(fullDayBody("2026-06-01-arrival").declined as Record<string, string>) };
    delete declined.media;
    const { PUT: putDay } = await import("@/app/api/v2/[user]/trips/[trip]/days/[slug]/route");
    const dayWritten = await putDay(
      new Request(`https://example.test/api/v2/${OWNER}/trips/${tripId}/days/2026-06-01-arrival`, {
        method: "PUT",
        headers: headers({ authorization: `Bearer ${token}` }),
        body: JSON.stringify(fullDayBody("2026-06-01-arrival", { media: [{ src: photoSrc }], declined })),
      }),
      { params: Promise.resolve({ user: OWNER, trip: tripId, slug: "2026-06-01-arrival" }) },
    );
    expect(dayWritten.status, JSON.stringify(await dayWritten.clone().json())).toBe(201);
    return photoSrc;
  }

  test("a cover naming a photo the trip does not have is refused, not written", async () => {
    const token = await ownerToken();
    const tripId = "cover-nonexistent-trip";
    await setupWithPhoto(tripId, token);

    const { status, body } = await patchTrip(OWNER, tripId, { cover: `/${OWNER}/media/${tripId}/nowhere/nope.jpg` }, token);
    expect(status, JSON.stringify(body)).toBe(400);
    expect(body.error).toBe("invalid_cover");

    // The stored file, not the read-side auto-pick — a trip WITH media but
    // no explicit `cover` legitimately reads back with `pickCover`'s choice
    // (lib/api/v2/trips.ts), which is not the same claim as "the bad value
    // was written".
    const { readTripFile } = await import("@/lib/api/v2/store");
    expect(readTripFile(OWNER, tripId)?.cover).toBeUndefined();
  });

  test("a cover naming a photo the trip actually has is accepted and read back", async () => {
    const token = await ownerToken();
    const tripId = "cover-real-trip";
    const photoSrc = await setupWithPhoto(tripId, token);

    const { status, body } = await patchTrip(OWNER, tripId, { cover: photoSrc }, token);
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.cover).toBe(photoSrc);

    const { body: onDisk } = await getTrip(OWNER, tripId, token);
    expect(onDisk.cover).toBe(photoSrc);
  });
});

/**
 * D14 (06-contract-deltas.md, owner's decision 2026-09-12) — `null` on a
 * PATCH removes `cover`, `accent`, `tagline` or `intro`, finishing RFC 7386
 * (JSON Merge Patch). Scope is exactly these four plain scalars: a
 * declinable SECTION keeps `declined` as its only "not answered" spelling,
 * a derived/conditional field keeps B1616's reconciliation, and a PUT
 * (decision 7 — a full replace already expresses absence by omission)
 * refuses `null` outright.
 */
describe("PATCH /api/v2/{user}/trips/{trip} — null clears a scalar back to absent (D14)", () => {
  async function setupWithPhoto(tripId: string, token: string): Promise<string> {
    await putTrip(OWNER, tripId, fullTrip(tripId), token);
    const photoSrc = `/${OWNER}/media/${tripId}/day-one/01.jpg`;
    const declined = { ...(fullDayBody("2026-06-01-arrival").declined as Record<string, string>) };
    delete declined.media;
    const { PUT: putDay } = await import("@/app/api/v2/[user]/trips/[trip]/days/[slug]/route");
    const dayWritten = await putDay(
      new Request(`https://example.test/api/v2/${OWNER}/trips/${tripId}/days/2026-06-01-arrival`, {
        method: "PUT",
        headers: headers({ authorization: `Bearer ${token}` }),
        body: JSON.stringify(fullDayBody("2026-06-01-arrival", { media: [{ src: photoSrc }], declined })),
      }),
      { params: Promise.resolve({ user: OWNER, trip: tripId, slug: "2026-06-01-arrival" }) },
    );
    expect(dayWritten.status, JSON.stringify(await dayWritten.clone().json())).toBe(201);
    return photoSrc;
  }

  test("null clears tagline, intro and accent, and the document reads back without the keys", async () => {
    const token = await ownerToken();
    const tripId = "null-clears-scalars-trip";
    await putTrip(
      OWNER,
      tripId,
      fullTrip(tripId, {
        tagline: "A slow week",
        intro: "Four passes, taken slowly.",
        accent: "coral",
        declined: {
          rates: "no foreign currency tracked on this trip at all",
          costs: "no budget tracked for this trip currently",
          plan: "no planned route recorded for this trip",
          days: "no days written for this trip at create time",
          translations: "single-language journal, nothing to translate",
          figures: "no walking figures drawn for this trip",
          buddies: "travelling solo, nobody else was on this trip",
        },
      }),
      token,
    );

    // Clearing a required-or-declined field returns it to the state before
    // it was ever answered — which still needs an answer, so the same call
    // declines each one it clears (D14's own `checkPatchConflicts` change:
    // `null` paired with a decline of the same field is a deliberate swap,
    // not a contradiction).
    const { status, body } = await patchTrip(
      OWNER,
      tripId,
      {
        tagline: null,
        intro: null,
        accent: null,
        declined: {
          tagline: "no one-line subtitle after all",
          intro: "no opening prose after all",
          accent: "reverted to the renderer's default",
        },
      },
      token,
    );
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.tagline).toBeUndefined();
    expect(body.intro).toBeUndefined();
    expect(body.accent).toBeUndefined();

    const { body: read } = await getTrip(OWNER, tripId, token);
    expect(read.tagline).toBeUndefined();
    expect(read.intro).toBeUndefined();
    expect(read.accent).toBeUndefined();

    const { readTripFile } = await import("@/lib/api/v2/store");
    const stored = readTripFile(OWNER, tripId);
    expect(stored && "tagline" in stored).toBe(false);
    expect(stored && "intro" in stored).toBe(false);
    expect(stored && "accent" in stored).toBe(false);
  });

  test("cover: null makes the auto-pick take over again — the thing \"\" could never reach", async () => {
    const token = await ownerToken();
    const tripId = "null-clears-cover-trip";
    const photoSrc = await setupWithPhoto(tripId, token);

    const set = await patchTrip(OWNER, tripId, { cover: photoSrc }, token);
    expect(set.status, JSON.stringify(set.body)).toBe(200);

    // The trip now has media, so clearing `cover` alone would re-raise the
    // "this trip now has photographs — pick one, or decline" question; the
    // same call declines it, letting the newest photo (the only one here)
    // stand in.
    const cleared = await patchTrip(
      OWNER,
      tripId,
      { cover: null, declined: { cover: "let the newest photo stand in" } },
      token,
    );
    expect(cleared.status, JSON.stringify(cleared.body)).toBe(200);
    expect(cleared.body.cover).toBe(photoSrc);

    const { readTripFile } = await import("@/lib/api/v2/store");
    expect(readTripFile(OWNER, tripId)?.cover).toBeUndefined();

    const { body: read } = await getTrip(OWNER, tripId, token);
    expect(read.cover).toBe(photoSrc);
  });

  test('cover: "" is still refused by checkCover — only null clears', async () => {
    const token = await ownerToken();
    const tripId = "empty-cover-refused-trip";
    await putTrip(OWNER, tripId, fullTrip(tripId), token);

    const { status, body } = await patchTrip(OWNER, tripId, { cover: "" }, token);
    expect(status, JSON.stringify(body)).toBe(400);
    expect(body.error).toBe("invalid_cover");
  });

  test('{"costs": null} is still refused — declinable sections use `declined`, not null', async () => {
    const token = await ownerToken();
    const tripId = "null-costs-refused-trip";
    await putTrip(OWNER, tripId, fullTrip(tripId), token);

    const { status, body } = await patchTrip(OWNER, tripId, { costs: null }, token);
    expect(status, JSON.stringify(body)).toBe(400);
    expect(body.error).toBe("invalid_request");
  });

  test('{"listed": null} is still refused — B1616 reconciles the derived visibility fields', async () => {
    const token = await ownerToken();
    const tripId = "null-listed-refused-trip";
    await putTrip(OWNER, tripId, fullTrip(tripId, { visibility: "public", teaser: undefined, listed: true }), token);

    const { status, body } = await patchTrip(OWNER, tripId, { listed: null }, token);
    expect(status, JSON.stringify(body)).toBe(400);
    expect(body.error).toBe("invalid_request");
  });

  test("null on a PUT is still refused — a replace already expresses absence by omission", async () => {
    const token = await ownerToken();
    const tripId = "null-on-put-refused-trip";
    await putTrip(OWNER, tripId, fullTrip(tripId), token);

    const replaced = await putTrip(
      OWNER,
      tripId,
      fullTrip(tripId, { accent: null }),
      token,
      { ifMatch: "*" },
    );
    expect(replaced.status, JSON.stringify(replaced.body)).toBe(400);
  });
});

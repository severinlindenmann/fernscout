import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { writeDayFixture, writeTripFixture } from "./fixtures/content";

/**
 * B1595 — the five owner-cookie doors onto v2, replacing `app/api/journal`,
 * `app/api/trip`, and the page-adjacent day-edit/unpublish/visibility routes
 * that wrote through v1's pre-B1598 functions.
 *
 * What is worth pinning here is the same thing `test/edit-the-day.test.ts`
 * and `test/take-a-day-down.test.ts` pinned for their own doors, since it is
 * the whole reason this shape of route exists: a bearer token — an agent's,
 * however it is scoped — is refused before the owner is even asked about,
 * somebody who is not the owner writes nothing, and an owner's own cookie
 * reaches the exact function the bearer-authenticated v2 route calls,
 * in-process, with no token minted for the browser to hold or forward.
 * `test/edit-the-day.test.ts`, `test/take-a-day-down.test.ts` and
 * `test/trip-details.test.ts` pinned the SAME properties against the routes
 * this replaces; those routes are gone (v1's flat `captions`/
 * `photoVisibility` maps, the `visibility`+details mixed-change refusal, and
 * a `start`/`end` pair are all retired in v2's document shape), so rather
 * than repoint a thousand lines of now-false assertions this is a fresh,
 * narrower suite against what actually changed.
 */

const OWNER = "alex";
const TRIP = "edit-trip";
const SLUG = "a-day";
// v2 addresses a day by its whole filename stem, date prefix and all
// (lib/api/v2/days.ts's own comment on the two conventions) — `writeDayFixture`
// takes the shorter v1-style suffix and prepends the date itself, but every
// route param and URL below has to carry the full stem.
const FULL_SLUG = `2026-09-02-${SLUG}`;

let dir: string;
let isOwnerMock: ReturnType<typeof vi.fn>;

vi.mock("@/lib/contacts/session", () => ({ isOwner: vi.fn() }));

const entryFile = () =>
  path.join(dir, OWNER, "trips", TRIP, "entries", `2026-09-02-${SLUG}.json`);
const tripFile = () => path.join(dir, OWNER, "trips", TRIP, "trip.json");
const journalFile = () => path.join(dir, OWNER, "config.json");

// Every required-or-declined section a day carries (DAY_DECLINABLES,
// lib/api/v2/schemas/day.ts) besides the ones a fixture sets directly — a
// day with none of these declined answers 422 `incomplete` on the very
// first PATCH, which is correct v2 behaviour and not what any of these
// tests are about.
const DAY_DECLINED = {
  media: "no photographs on this test day",
  costs: "not tracked on this test day",
  coordinates: "no position recorded",
  weather: "not recorded for this test day",
  time: "no time of day recorded",
  timezone: "not known for this test day",
  countryCode: "not recorded for this test day",
  transportMode: "a rest day, no travel",
  tags: "no tags on this test day",
  translations: "single-language test journal",
  visibility: "shown to everyone the trip lets in",
};
const { media: _mediaDeclined, ...DAY_DECLINED_MINUS_MEDIA } = DAY_DECLINED;

function writeJournal() {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: { auth: { enabled: true } },
    }),
  );
  clearConfigCache();

  fs.mkdirSync(path.join(dir, OWNER), { recursive: true });
  fs.writeFileSync(
    journalFile(),
    JSON.stringify({
      title: "Notebook",
      tagline: "one slow loop",
      owner: { name: "Alex B", nickname: "Alex", email: "alex@example.test" },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      visibility: "public",
      declined: { figures: "no default walking figures for this test journal" },
      features: {},
    }),
  );

  writeTripFixture(OWNER, {
    id: TRIP,
    title: "Original title",
    tagline: "original tagline",
    start: "2026-09-01",
    end: "2026-09-10",
    status: "current",
    visibility: "public",
    // A public trip states outright whether it is advertised — v1's writer
    // (lib/tripWrite.ts) can only ever write `teaser: false` for a CLOSED
    // trip, never `listed: false` for an open one... the other way round:
    // it writes `listed: false` explicitly but drops a false `teaser`
    // outright, so `public` + `listed: false` is the pair a fixture can
    // actually put on disk as a genuinely complete v2 document.
    listed: false,
    intro: "Intro.",
    // Every other required-or-declined section (TRIP_DECLINABLES,
    // lib/api/v2/schemas/trip.ts) already answered, so a PATCH touching one
    // field does not also have to answer the rest for the first time —
    // `days` is declined by the route itself for an existing trip.
    declined: {
      rates: "no foreign currency on this test trip",
      costs: "not tracked on this test trip",
      plan: "no planned route recorded",
      translations: "single-language test journal",
      accent: "default colour is fine",
      figures: "no walking figures for this test trip",
      buddies: "travelling solo",
    },
  });
  writeDayFixture(dir, OWNER, TRIP, {
    slug: SLUG,
    date: "2026-09-02",
    title: "A day",
    location: "Somewhere",
    country: "Nowhere",
    content: "Something happened.",
    declined: DAY_DECLINED,
  });
}

function req(url: string, method: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const journalParams = { params: Promise.resolve({ user: OWNER }) };
const tripParams = { params: Promise.resolve({ user: OWNER, trip: TRIP }) };
const dayParams = { params: Promise.resolve({ user: OWNER, trip: TRIP, slug: FULL_SLUG }) };

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-web-proxies-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  writeJournal();
  clearUserCache();

  const session = await import("@/lib/contacts/session");
  isOwnerMock = vi.mocked(session.isOwner);
  // `restoreAllMocks` below does not clear a factory-mocked `vi.fn()`'s call
  // history, and this file's several describe blocks each check "not called
  // at all" — a check that must start every test at zero, not wherever the
  // last test left it.
  isOwnerMock.mockClear();
  isOwnerMock.mockResolvedValue(true);
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  delete process.env.DATA_DIR;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("PATCH /api/web/{user} — the journal", { shuffle: false }, () => {
  test("a bearer token is refused before the owner is even asked about", async () => {
    const { PATCH } = await import("@/app/api/web/[user]/route");
    const response = await PATCH(
      req(`https://t.test/api/web/${OWNER}`, "PATCH", { title: "New" }, { authorization: "Bearer x" }),
      journalParams,
    );
    expect(response.status).toBe(403);
    expect(isOwnerMock).not.toHaveBeenCalled();
    expect(fs.readFileSync(journalFile(), "utf8")).toContain("Notebook");
  });

  test("somebody who is not the owner writes nothing", async () => {
    isOwnerMock.mockResolvedValue(false);
    const { PATCH } = await import("@/app/api/web/[user]/route");
    const response = await PATCH(req(`https://t.test/api/web/${OWNER}`, "PATCH", { title: "New" }), journalParams);
    expect(response.status).toBe(403);
    expect(fs.readFileSync(journalFile(), "utf8")).toContain("Notebook");
  });

  test("the owner's cookie reaches the same writer the bearer route uses", async () => {
    const { PATCH } = await import("@/app/api/web/[user]/route");
    const response = await PATCH(
      req(`https://t.test/api/web/${OWNER}`, "PATCH", { title: "New Name" }),
      journalParams,
    );
    expect(response.status).toBe(200);
    expect(fs.readFileSync(journalFile(), "utf8")).toContain("New Name");
  });
});

describe("PATCH /api/web/{user}/trips/{trip} — a trip's own details", { shuffle: false }, () => {
  test("a bearer token is refused before the owner is even asked about", async () => {
    const { PATCH } = await import("@/app/api/web/[user]/trips/[trip]/route");
    const response = await PATCH(
      req(`https://t.test/api/web/${OWNER}/trips/${TRIP}`, "PATCH", { title: "New" }, { authorization: "Bearer x" }),
      tripParams,
    );
    expect(response.status).toBe(403);
    expect(isOwnerMock).not.toHaveBeenCalled();
    expect(fs.readFileSync(tripFile(), "utf8")).toContain("Original title");
  });

  test("somebody who is not the owner writes nothing", async () => {
    isOwnerMock.mockResolvedValue(false);
    const { PATCH } = await import("@/app/api/web/[user]/trips/[trip]/route");
    const response = await PATCH(
      req(`https://t.test/api/web/${OWNER}/trips/${TRIP}`, "PATCH", { title: "New" }),
      tripParams,
    );
    expect(response.status).toBe(403);
    expect(fs.readFileSync(tripFile(), "utf8")).toContain("Original title");
  });

  test("the owner's cookie writes title, tagline and dates — v2's {from,to} shape", async () => {
    const { PATCH } = await import("@/app/api/web/[user]/trips/[trip]/route");
    const response = await PATCH(
      req(`https://t.test/api/web/${OWNER}/trips/${TRIP}`, "PATCH", {
        title: "Renamed trip",
        dates: { from: "2026-09-02", to: "2026-09-11" },
      }),
      tripParams,
    );
    expect(response.status).toBe(200);
    const written = fs.readFileSync(tripFile(), "utf8");
    expect(written).toContain("Renamed trip");
    expect(written).toContain("2026-09-11");
    // Untouched fields survive the merge-patch.
    expect(written).toContain("original tagline");
  });
});

describe("PATCH /api/web/{user}/trips/{trip}/visibility — narrowed to audience", { shuffle: false }, () => {
  test("a bearer token is refused before the owner is even asked about", async () => {
    const { PATCH } = await import("@/app/api/web/[user]/trips/[trip]/visibility/route");
    const response = await PATCH(
      req(
        `https://t.test/api/web/${OWNER}/trips/${TRIP}/visibility`,
        "PATCH",
        { visibility: "public" },
        { authorization: "Bearer x" },
      ),
      tripParams,
    );
    expect(response.status).toBe(403);
    expect(isOwnerMock).not.toHaveBeenCalled();
  });

  test("a field outside visibility/listed/teaser is refused", async () => {
    const { PATCH } = await import("@/app/api/web/[user]/trips/[trip]/visibility/route");
    const response = await PATCH(
      req(`https://t.test/api/web/${OWNER}/trips/${TRIP}/visibility`, "PATCH", { title: "Sneaking in" }),
      tripParams,
    );
    expect(response.status).toBe(400);
    expect(fs.readFileSync(tripFile(), "utf8")).toContain("Original title");
  });

  test("the owner's cookie changes who may read the trip", async () => {
    const { PATCH } = await import("@/app/api/web/[user]/trips/[trip]/visibility/route");
    const response = await PATCH(
      req(`https://t.test/api/web/${OWNER}/trips/${TRIP}/visibility`, "PATCH", {
        visibility: "public",
        listed: true,
      }),
      tripParams,
    );
    expect(response.status).toBe(200);
    const written = fs.readFileSync(tripFile(), "utf8");
    expect(written).toContain('"visibility": "public"');
    expect(written).toContain('"listed": true');
  });
});

describe("PATCH /api/web/{user}/trips/{trip}/days/{slug} — a day's own correction", { shuffle: false }, () => {
  test("a bearer token is refused before the owner is even asked about", async () => {
    const { PATCH } = await import("@/app/api/web/[user]/trips/[trip]/days/[slug]/route");
    const response = await PATCH(
      req(
        `https://t.test/api/web/${OWNER}/trips/${TRIP}/days/${FULL_SLUG}`,
        "PATCH",
        { title: "New" },
        { authorization: "Bearer x" },
      ),
      dayParams,
    );
    expect(response.status).toBe(403);
    expect(isOwnerMock).not.toHaveBeenCalled();
    expect(fs.readFileSync(entryFile(), "utf8")).toContain('"title": "A day"');
  });

  test("somebody who is not the owner writes nothing", async () => {
    isOwnerMock.mockResolvedValue(false);
    const { PATCH } = await import("@/app/api/web/[user]/trips/[trip]/days/[slug]/route");
    const response = await PATCH(
      req(`https://t.test/api/web/${OWNER}/trips/${TRIP}/days/${FULL_SLUG}`, "PATCH", { title: "New" }),
      dayParams,
    );
    expect(response.status).toBe(403);
    expect(fs.readFileSync(entryFile(), "utf8")).toContain('"title": "A day"');
  });

  /**
   * Carried over from the route this replaced. `EditDay` is a correction to a
   * day somebody already has, not a form that composes one — there is no CMS
   * here (decision 24) — so this door accepts only what the panel can draw.
   * Without the allowlist the browser could write any day field, and the
   * no-CMS rule would be a promise rather than a mechanism.
   */
  test("a field the panel cannot draw is refused rather than written", async () => {
    const { PATCH } = await import("@/app/api/web/[user]/trips/[trip]/days/[slug]/route");
    const before = fs.readFileSync(entryFile(), "utf8");
    const response = await PATCH(
      req(`https://t.test/api/web/${OWNER}/trips/${TRIP}/days/${FULL_SLUG}`, "PATCH", {
        tags: ["smuggled"],
      }),
      dayParams,
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("not_editable_here");
    expect(fs.readFileSync(entryFile(), "utf8")).toBe(before);
  });

  test("a correction lands on disk", async () => {
    const { PATCH } = await import("@/app/api/web/[user]/trips/[trip]/days/[slug]/route");
    const response = await PATCH(
      req(`https://t.test/api/web/${OWNER}/trips/${TRIP}/days/${FULL_SLUG}`, "PATCH", {
        title: "Arrival",
        content: "It rained.",
      }),
      dayParams,
    );
    expect(response.status).toBe(200);
    const written = fs.readFileSync(entryFile(), "utf8");
    expect(written).toContain('"title": "Arrival"');
    expect(written).toContain("It rained.");
    expect(written).not.toContain("Something happened.");
  });

  // v2 retired the flat `captions`/`photoVisibility` maps `EditDay` used to
  // send (owner review, 2026-09-12): a photograph's caption and its own
  // narrowing live on the day's `media` array, whole — `EditDay.tsx` now
  // builds that array itself.
  test("a caption travels on the media array, in the same patch as a title fix", async () => {
    writeDayFixture(dir, OWNER, TRIP, {
      slug: SLUG,
      date: "2026-09-02",
      title: "A day",
      location: "Somewhere",
      country: "Nowhere",
      content: "Something happened.",
      media: [{ src: `/media/${TRIP}/${SLUG}/01.jpg`, type: "image" }],
      declined: DAY_DECLINED_MINUS_MEDIA,
    });
    const src = `/${OWNER}/media/${TRIP}/${SLUG}/01.jpg`;
    const { PATCH } = await import("@/app/api/web/[user]/trips/[trip]/days/[slug]/route");
    const response = await PATCH(
      req(`https://t.test/api/web/${OWNER}/trips/${TRIP}/days/${FULL_SLUG}`, "PATCH", {
        title: "Arrival",
        media: [{ src, caption: "Lanterns", visibility: "private" }],
      }),
      dayParams,
    );
    expect(response.status).toBe(200);
    const written = fs.readFileSync(entryFile(), "utf8");
    expect(written).toContain("Lanterns");
    expect(written).toContain("private");
    expect(written).toContain('"title": "Arrival"');
  });
});

describe("POST /api/web/{user}/trips/{trip}/days/{slug}/unpublish", { shuffle: false }, () => {
  test("a bearer token is refused before the owner is even asked about", async () => {
    const { POST } = await import("@/app/api/web/[user]/trips/[trip]/days/[slug]/unpublish/route");
    const response = await POST(
      req(
        `https://t.test/api/web/${OWNER}/trips/${TRIP}/days/${FULL_SLUG}/unpublish`,
        "POST",
        undefined,
        { authorization: "Bearer x" },
      ),
      dayParams,
    );
    expect(response.status).toBe(403);
    expect(isOwnerMock).not.toHaveBeenCalled();
  });

  test("somebody who is not the owner cannot take a day down", async () => {
    isOwnerMock.mockResolvedValue(false);
    const { POST } = await import("@/app/api/web/[user]/trips/[trip]/days/[slug]/unpublish/route");
    const response = await POST(
      req(`https://t.test/api/web/${OWNER}/trips/${TRIP}/days/${FULL_SLUG}/unpublish`, "POST"),
      dayParams,
    );
    expect(response.status).toBe(403);
  });

  test("the owner's cookie takes a published day back to draft", async () => {
    writeDayFixture(dir, OWNER, TRIP, {
      slug: SLUG,
      date: "2026-09-02",
      title: "A day",
      location: "Somewhere",
      country: "Nowhere",
      content: "Something happened.",
    });
    const { POST } = await import("@/app/api/web/[user]/trips/[trip]/days/[slug]/unpublish/route");
    const response = await POST(
      req(`https://t.test/api/web/${OWNER}/trips/${TRIP}/days/${FULL_SLUG}/unpublish`, "POST"),
      dayParams,
    );
    expect(response.status).toBe(200);
    expect(fs.readFileSync(entryFile(), "utf8")).toContain('"status": "draft"');
  });
});

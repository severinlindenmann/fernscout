import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { writeDayFixture, writeTripFixture } from "./fixtures/content";
import { writeFigureDoc } from "@/lib/figures";

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

describe("PATCH /api/web/{user}/trips/{trip}/plan — the planner's own door", { shuffle: false }, () => {
  test("a bearer token is refused before the owner is even asked about", async () => {
    const { PATCH } = await import("@/app/api/web/[user]/trips/[trip]/plan/route");
    const response = await PATCH(
      req(
        `https://t.test/api/web/${OWNER}/trips/${TRIP}/plan`,
        "PATCH",
        { plan: { route: [{ location: "Somewhere", lat: 1, lng: 1 }] } },
        { authorization: "Bearer x" },
      ),
      tripParams,
    );
    expect(response.status).toBe(403);
    expect(isOwnerMock).not.toHaveBeenCalled();
    expect(fs.readFileSync(tripFile(), "utf8")).not.toContain("Somewhere");
  });

  test("a field outside plan/costs/declined is refused", async () => {
    const { PATCH } = await import("@/app/api/web/[user]/trips/[trip]/plan/route");
    const response = await PATCH(
      req(`https://t.test/api/web/${OWNER}/trips/${TRIP}/plan`, "PATCH", { title: "Sneaking in" }),
      tripParams,
    );
    expect(response.status).toBe(400);
    expect(fs.readFileSync(tripFile(), "utf8")).toContain("Original title");
  });

  test("somebody who is not the owner writes nothing", async () => {
    isOwnerMock.mockResolvedValue(false);
    const { PATCH } = await import("@/app/api/web/[user]/trips/[trip]/plan/route");
    const response = await PATCH(
      req(`https://t.test/api/web/${OWNER}/trips/${TRIP}/plan`, "PATCH", {
        plan: { route: [{ location: "Somewhere", lat: 1, lng: 1 }] },
      }),
      tripParams,
    );
    expect(response.status).toBe(403);
    expect(fs.readFileSync(tripFile(), "utf8")).not.toContain("Somewhere");
  });

  test("the owner's cookie writes a route and the server derives its dates", async () => {
    const { PATCH } = await import("@/app/api/web/[user]/trips/[trip]/plan/route");
    const response = await PATCH(
      req(`https://t.test/api/web/${OWNER}/trips/${TRIP}/plan`, "PATCH", {
        plan: { route: [{ location: "Somewhere", lat: 1, lng: 1, nights: 2 }] },
      }),
      tripParams,
    );
    expect(response.status).toBe(200);
    const written = fs.readFileSync(tripFile(), "utf8");
    expect(written).toContain("Somewhere");
    // Nights mode (the default) derives arrive from the trip's own start.
    expect(written).toContain("2026-09-01");
  });

  test("removing the last stop declines the plan section with the person's reason", async () => {
    const { PATCH } = await import("@/app/api/web/[user]/trips/[trip]/plan/route");
    const response = await PATCH(
      req(`https://t.test/api/web/${OWNER}/trips/${TRIP}/plan`, "PATCH", {
        declined: { plan: "not planned yet" },
      }),
      tripParams,
    );
    expect(response.status).toBe(200);
    const written = fs.readFileSync(tripFile(), "utf8");
    expect(written).toContain("not planned yet");
  });
});

describe("PATCH /api/web/{user}/trips/{trip}/plan — a trip the studio made, sections still open", { shuffle: false }, () => {
  // A trip made in the studio starts with costs, translations, figures,
  // buddies and teaser unanswered. The agent's route rightly refuses to
  // write it until they are; the owner's own planner must not (B2011,
  // found on the live journal on 2026-09-22).
  const OPEN_TRIP = "open-trip";
  const openTripFile = () => path.join(dir, OWNER, "trips", OPEN_TRIP, "trip.json");
  const openParams = { params: Promise.resolve({ user: OWNER, trip: OPEN_TRIP }) };

  beforeEach(() => {
    writeTripFixture(OWNER, {
      id: OPEN_TRIP,
      title: "Made in the studio",
      tagline: "nothing answered yet",
      start: "2027-02-12",
      end: "2027-03-28",
      status: "upcoming",
      visibility: "private",
      intro: "Intro.",
    });
    isOwnerMock.mockResolvedValue(true);
  });

  test("the planner writes the plan although other sections are open", async () => {
    const { PATCH } = await import("@/app/api/web/[user]/trips/[trip]/plan/route");
    const response = await PATCH(
      req(`https://t.test/api/web/${OWNER}/trips/${OPEN_TRIP}/plan`, "PATCH", {
        plan: { mode: "nights", route: [{ location: "Bangkok", lat: 13.75, lng: 100.5, nights: 3 }] },
      }),
      openParams,
    );
    expect(response.status).toBe(200);
    const onDisk = JSON.parse(fs.readFileSync(openTripFile(), "utf8"));
    expect(onDisk.plan.route[0]).toMatchObject({ id: "bangkok", location: "Bangkok", nights: 3, arrive: "2027-02-12", leave: "2027-02-15" });
    expect(onDisk.declined?.costs).toBeUndefined();
    expect(onDisk.title).toBe("Made in the studio");
  });

  test("the visibility door answers the studio's one question on a trip with open sections — B2071", async () => {
    // The studio's visibility page sends only `visibility`. In `whole` mode
    // the first PATCH answered 422 for every open section (and for the
    // teaser/listed question the new visibility raises), which the page
    // then retried or showed nothing about.
    const { PATCH } = await import("@/app/api/web/[user]/trips/[trip]/visibility/route");
    const toGuest = await PATCH(
      req(`https://t.test/api/web/${OWNER}/trips/${OPEN_TRIP}/visibility`, "PATCH", { visibility: "guest" }),
      openParams,
    );
    expect(toGuest.status).toBe(200);
    expect(JSON.parse(fs.readFileSync(openTripFile(), "utf8")).visibility).toBe("guest");
    const toPublic = await PATCH(
      req(`https://t.test/api/web/${OWNER}/trips/${OPEN_TRIP}/visibility`, "PATCH", { visibility: "public" }),
      openParams,
    );
    expect(toPublic.status).toBe(200);
    expect(JSON.parse(fs.readFileSync(openTripFile(), "utf8")).visibility).toBe("public");
  });

  test("Edit a trip's one Save lands on a trip with open sections — B2072", async () => {
    const { PATCH } = await import("@/app/api/web/[user]/trips/[trip]/route");
    const response = await PATCH(
      req(`https://t.test/api/web/${OWNER}/trips/${OPEN_TRIP}`, "PATCH", {
        title: "Renamed in the studio",
        tagline: "still open elsewhere",
        dates: { from: "2027-02-12", to: "2027-03-30" },
      }),
      openParams,
    );
    expect(response.status).toBe(200);
    const onDisk = JSON.parse(fs.readFileSync(openTripFile(), "utf8"));
    expect(onDisk.title).toBe("Renamed in the studio");
    expect(onDisk.dates.to).toBe("2027-03-30");
  });

  test("the reader-level door writes too", async () => {
    const { PATCH: writePlan } = await import("@/app/api/web/[user]/trips/[trip]/plan/route");
    await writePlan(
      req(`https://t.test/api/web/${OWNER}/trips/${OPEN_TRIP}/plan`, "PATCH", {
        plan: { route: [{ location: "Bangkok", lat: 13.75, lng: 100.5 }] },
      }),
      openParams,
    );
    const { PATCH } = await import("@/app/api/web/[user]/trips/[trip]/plan-readers/route");
    const response = await PATCH(
      req(`https://t.test/api/web/${OWNER}/trips/${OPEN_TRIP}/plan-readers`, "PATCH", { readers: "details" }),
      openParams,
    );
    expect(response.status).toBe(200);
    expect(JSON.parse(fs.readFileSync(openTripFile(), "utf8")).plan.readers).toBe("details");
  });

  test("a section the planner sends is still validated by its own schema", async () => {
    const { PATCH } = await import("@/app/api/web/[user]/trips/[trip]/plan/route");
    const response = await PATCH(
      req(`https://t.test/api/web/${OWNER}/trips/${OPEN_TRIP}/plan`, "PATCH", {
        plan: { route: [{ location: "Nowhere", lat: 999, lng: 0 }] },
      }),
      openParams,
    );
    expect(response.status).toBe(400);
    expect(fs.readFileSync(openTripFile(), "utf8")).not.toContain("Nowhere");
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
      // B2233 made tags editable here; coordinates are still not drawn.
      req(`https://t.test/api/web/${OWNER}/trips/${TRIP}/days/${FULL_SLUG}`, "PATCH", {
        coordinates: { lat: 1, lng: 2 },
      }),
      dayParams,
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("not_editable_here");
    expect(fs.readFileSync(entryFile(), "utf8")).toBe(before);
  });

  test("B2233: costs, how you travelled and tags round-trip, and each clears its left-blank decline (T6)", async () => {
    const { PATCH } = await import("@/app/api/web/[user]/trips/[trip]/days/[slug]/route");
    const costs = [{ label: "Train ticket", amount: 42.5, currency: "CHF" }, { label: "Lunch", amount: 18, currency: "EUR" }];
    const response = await PATCH(
      req(`https://t.test/api/web/${OWNER}/trips/${TRIP}/days/${SLUG}`, "PATCH", { costs, transportMode: "train", tags: ["lake", "old-town"] }),
      { params: Promise.resolve({ user: OWNER, trip: TRIP, slug: SLUG }) },
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const echoed = await response.json();
    expect(echoed.costs).toEqual(costs);
    expect(echoed.transportMode).toBe("train");
    expect(echoed.tags).toEqual(["lake", "old-town"]);
    const written = JSON.parse(fs.readFileSync(entryFile(), "utf8"));
    expect(written.costs).toEqual(costs);
    expect(written.transportMode).toBe("train");
    expect(written.tags).toEqual(["lake", "old-town"]);
    expect(written.declined.costs).toBeUndefined();
    expect(written.declined.transportMode).toBeUndefined();
    expect(written.declined.tags).toBeUndefined();
    // Untouched declines stay.
    expect(written.declined.coordinates).toBe(DAY_DECLINED.coordinates);

    // And the reader sees them.
    const { getAllEntries, AS_AUTHOR } = await import("@/lib/entries");
    const { tripRef } = await import("@/lib/trips");
    const entry = getAllEntries(tripRef(OWNER, TRIP), AS_AUTHOR).find((e) => e.slug === SLUG)!;
    expect(entry.costs.map((c) => [c.label, c.amount, c.currency])).toEqual([["Train ticket", 42.5, "CHF"], ["Lunch", 18, "EUR"]]);
    expect(entry.transport?.mode).toBe("train");
    expect(entry.tags).toEqual(["lake", "old-town"]);
  });

  test.each([
    ["a zero amount", { costs: [{ label: "Lunch", amount: 0, currency: "CHF" }] }],
    ["a currency that is not a code", { costs: [{ label: "Lunch", amount: 5, currency: "Euros" }] }],
    ["a way of travelling that is not on the list", { transportMode: "rocket" }],
    ["a tag that is not a slug", { tags: ["Old Town"] }],
  ])("B2233: %s is refused and nothing is written", async (_what, body) => {
    const { PATCH } = await import("@/app/api/web/[user]/trips/[trip]/days/[slug]/route");
    const before = fs.readFileSync(entryFile(), "utf8");
    const response = await PATCH(req(`https://t.test/api/web/${OWNER}/trips/${TRIP}/days/${FULL_SLUG}`, "PATCH", body), dayParams);
    expect(response.status).toBe(400);
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

  /**
   * Found live while driving `EditDay` in a real browser against
   * `content/example` for B1831/B1832: `EditDay.tsx` sends `entry.slug` —
   * the BARE, app-facing slug (`entrySlugFromFile`, lib/entries.ts), what
   * every owner page actually holds — not the date-prefixed on-disk
   * filename stem this route's URL parameter is documented to want. Every
   * other test in this file happens to pass the full stem by hand
   * (`FULL_SLUG`), which is correct for an agent's own v2 call but hid
   * this door 404ing on every real day. `resolveDayStem`
   * (lib/api/v2/store.ts) is the fix; this is its regression coverage
   * through the actual route, with the actual bare slug `EditDay` sends.
   */
  test("a correction lands on disk even addressed by the bare slug EditDay actually sends", async () => {
    const { PATCH } = await import("@/app/api/web/[user]/trips/[trip]/days/[slug]/route");
    const response = await PATCH(
      req(`https://t.test/api/web/${OWNER}/trips/${TRIP}/days/${SLUG}`, "PATCH", { title: "Fixed via the bare slug" }),
      { params: Promise.resolve({ user: OWNER, trip: TRIP, slug: SLUG }) },
    );
    expect(response.status).toBe(200);
    expect(fs.readFileSync(entryFile(), "utf8")).toContain('"title": "Fixed via the bare slug"');
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

  // B1586 — the panel's own `entry.gallery[].src` is owner-prefixed
  // (`mediaWithOwner`, lib/trips.ts, for the `<img>` tag), not the
  // trip-relative `src` the day file actually stores. A patch built from
  // that page model — exactly what `EditDay.tsx` sends — must still land
  // on the day's own src, not fork a second, browser-shaped entry that
  // orphans the real one.
  test("a caption sent back with the browser's owner-prefixed src still lands on the day's own src", async () => {
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
    const ownerPrefixedSrc = `/${OWNER}/media/${TRIP}/${SLUG}/01.jpg`;
    const { PATCH } = await import("@/app/api/web/[user]/trips/[trip]/days/[slug]/route");
    const response = await PATCH(
      req(`https://t.test/api/web/${OWNER}/trips/${TRIP}/days/${FULL_SLUG}`, "PATCH", {
        media: [{ src: ownerPrefixedSrc, caption: "Lanterns" }],
      }),
      dayParams,
    );
    expect(response.status).toBe(200);
    const written = JSON.parse(fs.readFileSync(entryFile(), "utf8"));
    expect(written.media).toHaveLength(1);
    expect(written.media[0].src).toBe(`/media/${TRIP}/${SLUG}/01.jpg`);
    expect(written.media[0].caption).toBe("Lanterns");
  });

  // D12 (spec §6, B1831) — the flow holds the version it read and a save
  // built on a stale one is refused, never applied silently. This is
  // `applyDayPatch`'s own `If-Match`/`stale_document` mechanism
  // (`test/edit-day.test.ts` pins it at the v2 bearer door already); what
  // was missing was this cookie door forwarding the header at all.
  test("GET answers the day's current ETag", async () => {
    const { GET } = await import("@/app/api/web/[user]/trips/[trip]/days/[slug]/route");
    const response = await GET(
      req(`https://t.test/api/web/${OWNER}/trips/${TRIP}/days/${FULL_SLUG}`, "GET"),
      dayParams,
    );
    expect(response.status).toBe(200);
    const json = (await response.json()) as { etag?: string };
    expect(typeof json.etag).toBe("string");
    expect(json.etag).toMatch(/^".+"$/);
  });

  test("GET answers the day's current ETag by the bare slug too — what EditDay actually holds", async () => {
    const { GET } = await import("@/app/api/web/[user]/trips/[trip]/days/[slug]/route");
    const response = await GET(
      req(`https://t.test/api/web/${OWNER}/trips/${TRIP}/days/${SLUG}`, "GET"),
      { params: Promise.resolve({ user: OWNER, trip: TRIP, slug: SLUG }) },
    );
    expect(response.status).toBe(200);
    expect((await response.json()).etag).toMatch(/^".+"$/);
  });

  test("a save whose If-Match no longer matches is refused, and nothing is written — two tabs, D12", async () => {
    const { GET, PATCH } = await import("@/app/api/web/[user]/trips/[trip]/days/[slug]/route");
    const before = (await (
      await GET(req(`https://t.test/api/web/${OWNER}/trips/${TRIP}/days/${FULL_SLUG}`, "GET"), dayParams)
    ).json()) as { etag: string };

    // Tab one saves first, moving the document on.
    const first = await PATCH(
      req(`https://t.test/api/web/${OWNER}/trips/${TRIP}/days/${FULL_SLUG}`, "PATCH", { title: "From tab one" }, {
        "if-match": before.etag,
      }),
      dayParams,
    );
    expect(first.status).toBe(200);

    // Tab two, still holding the version it opened with, saves next.
    const stored = fs.readFileSync(entryFile(), "utf8");
    const second = await PATCH(
      req(`https://t.test/api/web/${OWNER}/trips/${TRIP}/days/${FULL_SLUG}`, "PATCH", { title: "From tab two" }, {
        "if-match": before.etag,
      }),
      dayParams,
    );
    expect(second.status).toBe(409);
    expect((await second.json()).error).toBe("stale_document");
    // Nothing tab two sent was applied — the file is exactly as tab one left it.
    expect(fs.readFileSync(entryFile(), "utf8")).toBe(stored);
    expect(fs.readFileSync(entryFile(), "utf8")).toContain("From tab one");
    expect(fs.readFileSync(entryFile(), "utf8")).not.toContain("From tab two");
  });

  test("a save with no If-Match at all still writes — an older client, or a caller that never read the ETag", async () => {
    const { PATCH } = await import("@/app/api/web/[user]/trips/[trip]/days/[slug]/route");
    const response = await PATCH(
      req(`https://t.test/api/web/${OWNER}/trips/${TRIP}/days/${FULL_SLUG}`, "PATCH", { title: "No version sent" }),
      dayParams,
    );
    expect(response.status).toBe(200);
    expect(fs.readFileSync(entryFile(), "utf8")).toContain("No version sent");
  });
});

/**
 * B2241/B2242 — the one-page day (B2188) saves a draft with no title (B1442:
 * blank stays blank) and most declinables left blank (B2192: completeness is
 * asked at share time). "Change a day" must open and save exactly that draft;
 * a published day keeps the full check.
 */
describe("PATCH /api/web/{user}/trips/{trip}/days/{slug} — a draft the studio left blank", { shuffle: false }, () => {
  const blankDraft = (status: "draft" | "published" = "draft") =>
    writeDayFixture(dir, OWNER, TRIP, {
      slug: SLUG,
      date: "2026-09-02",
      title: "",
      content: "Something happened.",
      status,
      declined: { translations: "single-language test journal" },
    });
  const url = `https://t.test/api/web/${OWNER}/trips/${TRIP}/days/${FULL_SLUG}`;

  test("B2241: an untitled draft answers its version, and saves a correction", async () => {
    blankDraft();
    const { GET, PATCH } = await import("@/app/api/web/[user]/trips/[trip]/days/[slug]/route");
    const read = await GET(req(url, "GET"), dayParams);
    expect(read.status, await read.clone().text()).toBe(200);
    const { etag } = (await read.json()) as { etag: string };

    const saved = await PATCH(req(url, "PATCH", { content: "It rained." }, { "if-match": etag }), dayParams);
    expect(saved.status, await saved.clone().text()).toBe(200);
    const written = JSON.parse(fs.readFileSync(entryFile(), "utf8"));
    expect(written.content).toBe("It rained.");
    // Blank stays blank — nothing generated a title (C7).
    expect(written.title).toBe("");
    expect(written.status).toBe("draft");
  });

  test("B2242: a draft with blank declinables saves a cost, and the blanks stay blank rather than declined", async () => {
    blankDraft();
    const { PATCH } = await import("@/app/api/web/[user]/trips/[trip]/days/[slug]/route");
    const costs = [{ label: "Lunch", amount: 18, currency: "CHF" }];
    const saved = await PATCH(req(url, "PATCH", { title: "Along the lake", costs }), dayParams);
    expect(saved.status, await saved.clone().text()).toBe(200);
    const written = JSON.parse(fs.readFileSync(entryFile(), "utf8"));
    expect(written.title).toBe("Along the lake");
    expect(written.costs).toEqual(costs);
    expect(written.declined).toEqual({ translations: "single-language test journal" });
    expect(written.media).toBeUndefined();
  });

  test("B2242: a draft still refuses a section both given and declined, and T6 still retracts a decline", async () => {
    blankDraft();
    const { PATCH } = await import("@/app/api/web/[user]/trips/[trip]/days/[slug]/route");
    const before = fs.readFileSync(entryFile(), "utf8");
    const both = await PATCH(
      req(url, "PATCH", { tags: ["lake"], declined: { tags: "none" } }),
      dayParams,
    );
    expect(both.status).toBe(400);
    expect(fs.readFileSync(entryFile(), "utf8")).toBe(before);

    const declined = await PATCH(req(url, "PATCH", { declined: { tags: "no tags today" } }), dayParams);
    expect(declined.status, await declined.clone().text()).toBe(200);
    const retract = await PATCH(req(url, "PATCH", { tags: ["lake"] }), dayParams);
    expect(retract.status).toBe(200);
    const written = JSON.parse(fs.readFileSync(entryFile(), "utf8"));
    expect(written.tags).toEqual(["lake"]);
    expect(written.declined.tags).toBeUndefined();
  });

  test("B2242: a published day with blanks keeps the full check — 422 incomplete, nothing written", async () => {
    blankDraft("published");
    const { PATCH } = await import("@/app/api/web/[user]/trips/[trip]/days/[slug]/route");
    const before = fs.readFileSync(entryFile(), "utf8");
    const saved = await PATCH(req(url, "PATCH", { title: "Along the lake" }), dayParams);
    expect(saved.status).toBe(422);
    expect((await saved.json()).error).toBe("incomplete");
    expect(fs.readFileSync(entryFile(), "utf8")).toBe(before);
  });

  test("an untitled draft still refuses a bearer token and a non-owner", async () => {
    blankDraft();
    const { GET, PATCH } = await import("@/app/api/web/[user]/trips/[trip]/days/[slug]/route");
    const before = fs.readFileSync(entryFile(), "utf8");
    expect((await PATCH(req(url, "PATCH", { content: "x" }, { authorization: "Bearer x" }), dayParams)).status).toBe(403);
    isOwnerMock.mockResolvedValue(false);
    expect((await GET(req(url, "GET"), dayParams)).status).toBe(403);
    expect((await PATCH(req(url, "PATCH", { content: "x" }), dayParams)).status).toBe(403);
    expect(fs.readFileSync(entryFile(), "utf8")).toBe(before);
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

describe("POST /api/web/{user}/trips/{trip}/days/{slug}/publish — B2140", { shuffle: false }, () => {
  const url = `https://t.test/api/web/${OWNER}/trips/${TRIP}/days/${FULL_SLUG}/publish`;
  const draft = () =>
    writeDayFixture(dir, OWNER, TRIP, {
      slug: SLUG,
      date: "2026-09-02",
      title: "A day",
      location: "Somewhere",
      country: "Nowhere",
      content: "Something happened.",
      status: "draft",
      declined: DAY_DECLINED,
    });

  test("a bearer token is refused before the owner is even asked about", async () => {
    draft();
    const { POST } = await import("@/app/api/web/[user]/trips/[trip]/days/[slug]/publish/route");
    const response = await POST(req(url, "POST", {}, { authorization: "Bearer x" }), dayParams);
    expect(response.status).toBe(403);
    expect(isOwnerMock).not.toHaveBeenCalled();
    expect(fs.readFileSync(entryFile(), "utf8")).toContain('"status": "draft"');
  });

  test("somebody who is not the owner cannot publish a day", async () => {
    draft();
    isOwnerMock.mockResolvedValue(false);
    const { POST } = await import("@/app/api/web/[user]/trips/[trip]/days/[slug]/publish/route");
    const response = await POST(req(url, "POST", {}), dayParams);
    expect(response.status).toBe(403);
    expect(fs.readFileSync(entryFile(), "utf8")).toContain('"status": "draft"');
  });

  test("the owner's cookie puts a draft on the site, by its bare slug too, and sends nothing", async () => {
    draft();
    const { POST } = await import("@/app/api/web/[user]/trips/[trip]/days/[slug]/publish/route");
    const response = await POST(
      // A body asking for sends is not read: this door never announces.
      req(url, "POST", { sendMail: true, sendWhatsapp: true }),
      { params: Promise.resolve({ user: OWNER, trip: TRIP, slug: SLUG }) },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("published");
    expect(body.mail).toBeUndefined();
    expect(body.whatsapp).toBeUndefined();
    expect(fs.readFileSync(entryFile(), "utf8")).toContain('"status": "published"');
  });

  // B2192 (D3) — the share sheet names the blanks, and the owner's tap
  // records exactly those as left blank. Never trusted from the client.
  const { costs: _c, tags: _t, ...DECLINED_BUT_COSTS_AND_TAGS } = DAY_DECLINED;
  const blankDraft = (declined: Record<string, string> = DECLINED_BUT_COSTS_AND_TAGS) =>
    writeDayFixture(dir, OWNER, TRIP, {
      slug: SLUG,
      date: "2026-09-02",
      title: "A day",
      location: "Somewhere",
      country: "Nowhere",
      content: "Something happened.",
      status: "draft",
      declined,
    });
  const onDisk = () => JSON.parse(fs.readFileSync(entryFile(), "utf8"));

  test("B2192: without declineOpen a day with blanks is still refused, and stays a draft", async () => {
    blankDraft();
    const { POST } = await import("@/app/api/web/[user]/trips/[trip]/days/[slug]/publish/route");
    const response = await POST(req(url, "POST", {}), dayParams);
    expect(response.status).toBe(422);
    expect(onDisk().status).toBe("draft");
  });

  test("B2192: declineOpen naming exactly the blanks shares the day and records what happened", async () => {
    blankDraft();
    const { POST } = await import("@/app/api/web/[user]/trips/[trip]/days/[slug]/publish/route");
    const response = await POST(req(url, "POST", { declineOpen: ["costs", "tags"], sendMail: true }), dayParams);
    expect(response.status, await response.clone().text()).toBe(200);
    const body = await response.json();
    expect(body.mail).toBeUndefined();
    expect(body.whatsapp).toBeUndefined();
    const day = onDisk();
    expect(day.status).toBe("published");
    const reason = "left blank when the owner shared this day from the studio (not asked field by field)";
    expect(day.declined.costs).toBe(reason);
    expect(day.declined.tags).toBe(reason);
    // Nothing else was touched.
    expect(day.declined.media).toBe(DAY_DECLINED.media);
    expect(Object.values(day.declined).filter((r) => r === reason)).toHaveLength(2);

    // T6 still holds: a later value clears the share-time decline.
    const { applyDayPatch } = await import("@/app/api/v2/[user]/trips/[trip]/days/[slug]/route");
    const { readTripFile } = await import("@/lib/api/v2/store");
    const patched = await applyDayPatch(
      OWNER,
      TRIP,
      FULL_SLUG,
      readTripFile(OWNER, TRIP)!,
      req(`https://t.test/api/v2/${OWNER}/trips/${TRIP}/days/${FULL_SLUG}`, "PATCH", { costs: [{ label: "bread", amount: 3 }] }),
    );
    expect(patched.status, await patched.clone().text()).toBe(200);
    expect(onDisk().declined.costs).toBeUndefined();
    expect(onDisk().declined.tags).toBe(reason);
  });

  test.each([
    ["a field that is filled in", ["costs", "tags", "location"]],
    ["a field already answered", ["costs", "tags", "media"]],
    ["a field that is not declinable at all", ["costs", "tags", "title"]],
    ["status", ["costs", "tags", "status"]],
  ])("B2192: declineOpen naming %s is refused whole, and nothing is written", async (_what, declineOpen) => {
    blankDraft();
    const before = fs.readFileSync(entryFile(), "utf8");
    const { POST } = await import("@/app/api/web/[user]/trips/[trip]/days/[slug]/publish/route");
    const response = await POST(req(url, "POST", { declineOpen }), dayParams);
    expect(response.status).toBe(400);
    expect((await response.json()).refused).toEqual([declineOpen[2]]);
    expect(fs.readFileSync(entryFile(), "utf8")).toBe(before);
  });

  test("B2192: visibility is never left blank from the studio, even when it is blank", async () => {
    const { visibility: _v, ...declined } = DECLINED_BUT_COSTS_AND_TAGS;
    blankDraft(declined);
    const before = fs.readFileSync(entryFile(), "utf8");
    const { POST } = await import("@/app/api/web/[user]/trips/[trip]/days/[slug]/publish/route");
    const response = await POST(req(url, "POST", { declineOpen: ["costs", "tags", "visibility"] }), dayParams);
    expect(response.status).toBe(400);
    expect(fs.readFileSync(entryFile(), "utf8")).toBe(before);
  });

  test("B2192: declineOpen is refused to a bearer token and to somebody who is not the owner", async () => {
    blankDraft();
    const { POST } = await import("@/app/api/web/[user]/trips/[trip]/days/[slug]/publish/route");
    const bearer = await POST(req(url, "POST", { declineOpen: ["costs", "tags"] }, { authorization: "Bearer x" }), dayParams);
    expect(bearer.status).toBe(403);
    isOwnerMock.mockResolvedValue(false);
    const stranger = await POST(req(url, "POST", { declineOpen: ["costs", "tags"] }), dayParams);
    expect(stranger.status).toBe(403);
    expect(onDisk().status).toBe("draft");
    expect(onDisk().declined.costs).toBeUndefined();
  });
});

describe("DELETE /api/web/{user}/inbox/pins/{id} — B2014's own door", { shuffle: false }, () => {
  async function seedPin(): Promise<string> {
    const { storeInboxFile } = await import("@/lib/inbox");
    const { entry } = storeInboxFile(OWNER, "location", "pin.json", Buffer.from("{}"), {
      lat: 46.5,
      lon: 7.9,
      receivedAt: "2026-09-01T12:00:00.000Z",
    });
    return entry.id;
  }

  test("a bearer token is refused before the owner is even asked about", async () => {
    const id = await seedPin();
    const { DELETE } = await import("@/app/api/web/[user]/inbox/pins/[id]/route");
    const response = await DELETE(
      req(`https://t.test/api/web/${OWNER}/inbox/pins/${id}`, "DELETE", undefined, { authorization: "Bearer x" }),
      { params: Promise.resolve({ user: OWNER, id }) },
    );
    expect(response.status).toBe(403);
    expect(isOwnerMock).not.toHaveBeenCalled();
    const { listWaitingPins } = await import("@/lib/inbox");
    expect(listWaitingPins(OWNER)).toHaveLength(1);
  });

  test("somebody who is not the owner discards nothing", async () => {
    const id = await seedPin();
    isOwnerMock.mockResolvedValue(false);
    const { DELETE } = await import("@/app/api/web/[user]/inbox/pins/[id]/route");
    const response = await DELETE(req(`https://t.test/api/web/${OWNER}/inbox/pins/${id}`, "DELETE"), {
      params: Promise.resolve({ user: OWNER, id }),
    });
    expect(response.status).toBe(403);
    const { listWaitingPins } = await import("@/lib/inbox");
    expect(listWaitingPins(OWNER)).toHaveLength(1);
  });

  test("an unknown id answers not_found", async () => {
    const { DELETE } = await import("@/app/api/web/[user]/inbox/pins/[id]/route");
    const response = await DELETE(req(`https://t.test/api/web/${OWNER}/inbox/pins/nope`, "DELETE"), {
      params: Promise.resolve({ user: OWNER, id: "nope" }),
    });
    expect(response.status).toBe(404);
  });

  test("the owner's cookie discards the pin", async () => {
    const id = await seedPin();
    const { DELETE } = await import("@/app/api/web/[user]/inbox/pins/[id]/route");
    const response = await DELETE(req(`https://t.test/api/web/${OWNER}/inbox/pins/${id}`, "DELETE"), {
      params: Promise.resolve({ user: OWNER, id }),
    });
    expect(response.status).toBe(200);
    const { listWaitingPins } = await import("@/lib/inbox");
    expect(listWaitingPins(OWNER)).toHaveLength(0);
  });
});

describe("PATCH /api/web/{user}/figures/set — the journal's own default figures", { shuffle: false }, () => {
  test("a bearer token is refused before the owner is even asked about", async () => {
    const { PATCH } = await import("@/app/api/web/[user]/figures/set/route");
    const response = await PATCH(
      req(
        `https://t.test/api/web/${OWNER}/figures/set`,
        "PATCH",
        { figures: { mode: "off" } },
        { authorization: "Bearer x" },
      ),
      journalParams,
    );
    expect(response.status).toBe(403);
    expect(isOwnerMock).not.toHaveBeenCalled();
  });

  test("a field outside figures/declined is refused", async () => {
    const { PATCH } = await import("@/app/api/web/[user]/figures/set/route");
    const response = await PATCH(
      req(`https://t.test/api/web/${OWNER}/figures/set`, "PATCH", { title: "Sneaking in" }),
      journalParams,
    );
    expect(response.status).toBe(400);
    expect(fs.readFileSync(journalFile(), "utf8")).toContain("Notebook");
  });

  test("somebody who is not the owner writes nothing", async () => {
    isOwnerMock.mockResolvedValue(false);
    const { PATCH } = await import("@/app/api/web/[user]/figures/set/route");
    const response = await PATCH(
      req(`https://t.test/api/web/${OWNER}/figures/set`, "PATCH", {
        figures: { mode: "set", figures: ["anna"] },
      }),
      journalParams,
    );
    expect(response.status).toBe(403);
    expect(fs.readFileSync(journalFile(), "utf8")).not.toContain('"anna"');
  });

  test("the owner's cookie sets the journal's default figures, retracting the decline", async () => {
    const { PATCH } = await import("@/app/api/web/[user]/figures/set/route");
    const response = await PATCH(
      req(`https://t.test/api/web/${OWNER}/figures/set`, "PATCH", {
        figures: { mode: "set", figures: ["anna", "tomi"] },
      }),
      journalParams,
    );
    expect(response.status).toBe(200);
    const written = JSON.parse(fs.readFileSync(journalFile(), "utf8"));
    expect(written.figures).toEqual({ mode: "set", figures: ["anna", "tomi"] });
    expect(written.declined?.figures).toBeUndefined();
  });

  test("setting nobody walks by default writes mode off", async () => {
    const { PATCH } = await import("@/app/api/web/[user]/figures/set/route");
    const response = await PATCH(
      req(`https://t.test/api/web/${OWNER}/figures/set`, "PATCH", { figures: { mode: "off" } }),
      journalParams,
    );
    expect(response.status).toBe(200);
    const written = JSON.parse(fs.readFileSync(journalFile(), "utf8"));
    expect(written.figures).toEqual({ mode: "off" });
  });

  // The review's own finding: `applyJournalPatch` used to have no `mode` at
  // all, so this door — narrowed to `figures`/`declined` — was refused by
  // the SAME completeness check the whole-document v2 PATCH enforces,
  // purely because a journal signed up before v2 had no `tagline` and no
  // decline for it. "sections" (mirroring `applyTripPatch`'s own mode,
  // B2011) is what lets this door answer only the question it asked.
  test("a journal missing tagline (no decline either) still gets its figures set — sections skips the rest", async () => {
    const NO_TAGLINE = "no-tagline-journal";
    fs.mkdirSync(path.join(dir, NO_TAGLINE), { recursive: true });
    const configFile = path.join(dir, NO_TAGLINE, "config.json");
    fs.writeFileSync(
      configFile,
      JSON.stringify({
        title: "No Tagline Yet",
        owner: { name: "Sam Tester", nickname: "Sam", email: "sam@example.test" },
        locales: ["en"],
        baseCurrency: "CHF",
        displayCurrencies: ["CHF"],
        units: "metric",
        visibility: "public",
        features: {},
        // Deliberately absent: `tagline` and `declined` — a real v1-era
        // journal, never touched by v2's own required-or-declined check.
      }),
    );
    clearUserCache();

    const params = { params: Promise.resolve({ user: NO_TAGLINE }) };
    const { PATCH } = await import("@/app/api/web/[user]/figures/set/route");
    const response = await PATCH(
      req(`https://t.test/api/web/${NO_TAGLINE}/figures/set`, "PATCH", {
        figures: { mode: "set", figures: ["anna"] },
      }),
      params,
    );
    expect(response.status).toBe(200);
    const written = JSON.parse(fs.readFileSync(configFile, "utf8"));
    expect(written.figures).toEqual({ mode: "set", figures: ["anna"] });
    // Untouched — sections mode never asked about it.
    expect(written.tagline).toBeUndefined();
    expect(written.declined?.tagline).toBeUndefined();

    // The same journal, now with figures answered but tagline still open,
    // still answers 422 `incomplete` on the v2 PATCH's own "whole" contract
    // — `applyJournalPatch` is the exact function that route calls after
    // its own bearer check, called here directly with its default mode.
    const { applyJournalPatch } = await import("@/app/api/v2/[user]/route");
    const { journalDoc } = await import("@/lib/api/v2/schemas");
    const { journalV2Fields } = await import("@/lib/journals");
    const { getUser } = await import("@/lib/users");
    const journal = getUser(NO_TAGLINE);
    if (!journal) throw new Error("fixture journal missing");
    const stored = journalDoc.parse({ ...journalV2Fields(journal), username: NO_TAGLINE });
    const wholeResponse = await applyJournalPatch(
      NO_TAGLINE,
      stored,
      req(`https://t.test/api/v2/${NO_TAGLINE}`, "PATCH", {}),
    );
    expect(wholeResponse.status).toBe(422);
    const wholeBody = await wholeResponse.json();
    expect(wholeBody.error).toBe("incomplete");
  });
});

describe("PATCH /api/web/{user}/trips/{trip}/figures — one trip's own party", { shuffle: false }, () => {
  test("a bearer token is refused before the owner is even asked about", async () => {
    const { PATCH } = await import("@/app/api/web/[user]/trips/[trip]/figures/route");
    const response = await PATCH(
      req(
        `https://t.test/api/web/${OWNER}/trips/${TRIP}/figures`,
        "PATCH",
        { figures: { mode: "off" } },
        { authorization: "Bearer x" },
      ),
      tripParams,
    );
    expect(response.status).toBe(403);
    expect(isOwnerMock).not.toHaveBeenCalled();
  });

  test("a field outside figures/declined is refused", async () => {
    const { PATCH } = await import("@/app/api/web/[user]/trips/[trip]/figures/route");
    const response = await PATCH(
      req(`https://t.test/api/web/${OWNER}/trips/${TRIP}/figures`, "PATCH", { title: "Sneaking in" }),
      tripParams,
    );
    expect(response.status).toBe(400);
    expect(fs.readFileSync(tripFile(), "utf8")).toContain("Original title");
  });

  test("somebody who is not the owner writes nothing", async () => {
    isOwnerMock.mockResolvedValue(false);
    const { PATCH } = await import("@/app/api/web/[user]/trips/[trip]/figures/route");
    const response = await PATCH(
      req(`https://t.test/api/web/${OWNER}/trips/${TRIP}/figures`, "PATCH", {
        figures: { mode: "custom", figures: ["anna"] },
      }),
      tripParams,
    );
    expect(response.status).toBe(403);
    expect(fs.readFileSync(tripFile(), "utf8")).not.toContain('"anna"');
  });

  test("the owner's cookie sets this trip's own party, retracting the decline", async () => {
    const { PATCH } = await import("@/app/api/web/[user]/trips/[trip]/figures/route");
    const response = await PATCH(
      req(`https://t.test/api/web/${OWNER}/trips/${TRIP}/figures`, "PATCH", {
        figures: { mode: "custom", figures: ["anna", "tomi"] },
      }),
      tripParams,
    );
    expect(response.status).toBe(200);
    const written = JSON.parse(fs.readFileSync(tripFile(), "utf8"));
    expect(written.figures).toEqual({ mode: "custom", figures: ["anna", "tomi"] });
    expect(written.declined?.figures).toBeUndefined();
  });

  test("switching a trip to nobody writes mode off", async () => {
    const { PATCH } = await import("@/app/api/web/[user]/trips/[trip]/figures/route");
    const response = await PATCH(
      req(`https://t.test/api/web/${OWNER}/trips/${TRIP}/figures`, "PATCH", { figures: { mode: "off" } }),
      tripParams,
    );
    expect(response.status).toBe(200);
    const written = JSON.parse(fs.readFileSync(tripFile(), "utf8"));
    expect(written.figures).toEqual({ mode: "off" });
  });

  test("a trip the studio made, other sections still open, still writes its party", async () => {
    const OPEN_TRIP = "open-figures-trip";
    const openParams = { params: Promise.resolve({ user: OWNER, trip: OPEN_TRIP }) };
    writeTripFixture(OWNER, {
      id: OPEN_TRIP,
      title: "Made in the studio",
      start: "2027-02-12",
      end: "2027-03-28",
      status: "upcoming",
      visibility: "private",
      intro: "Intro.",
    });
    const { PATCH } = await import("@/app/api/web/[user]/trips/[trip]/figures/route");
    const response = await PATCH(
      req(`https://t.test/api/web/${OWNER}/trips/${OPEN_TRIP}/figures`, "PATCH", {
        figures: { mode: "custom", figures: ["anna"] },
      }),
      openParams,
    );
    expect(response.status).toBe(200);
    const written = JSON.parse(
      fs.readFileSync(path.join(dir, OWNER, "trips", OPEN_TRIP, "trip.json"), "utf8"),
    );
    expect(written.figures).toEqual({ mode: "custom", figures: ["anna"] });
  });
});

describe("DELETE /api/web/{user}/figures/{id} — B2022, the library's own delete", { shuffle: false }, () => {
  const figureParams = { params: Promise.resolve({ user: OWNER, id: "anna" }) };

  function writeFigure() {
    writeFigureDoc(OWNER, { id: "anna", name: "Anna" });
  }

  function figureFile() {
    return path.join(dir, OWNER, "figures", "anna.json");
  }

  test("a bearer token is refused before the owner is even asked about", async () => {
    writeFigure();
    const { DELETE } = await import("@/app/api/web/[user]/figures/[id]/route");
    const response = await DELETE(
      req(`https://t.test/api/web/${OWNER}/figures/anna`, "DELETE", undefined, { authorization: "Bearer x" }),
      figureParams,
    );
    expect(response.status).toBe(403);
    expect(isOwnerMock).not.toHaveBeenCalled();
    expect(fs.existsSync(figureFile())).toBe(true);
  });

  test("somebody who is not the owner deletes nothing", async () => {
    writeFigure();
    isOwnerMock.mockResolvedValue(false);
    const { DELETE } = await import("@/app/api/web/[user]/figures/[id]/route");
    const response = await DELETE(req(`https://t.test/api/web/${OWNER}/figures/anna`, "DELETE"), figureParams);
    expect(response.status).toBe(403);
    expect(fs.existsSync(figureFile())).toBe(true);
  });

  test("a figure still named on a trip is refused, naming that trip", async () => {
    writeFigure();
    writeTripFixture(OWNER, {
      id: "figure-user-trip",
      title: "Uses Anna",
      start: "2027-01-01",
      end: "2027-01-05",
      status: "upcoming",
      visibility: "private",
      intro: "Intro.",
      figures: { mode: "custom", figures: ["anna"] },
    });
    const { DELETE } = await import("@/app/api/web/[user]/figures/[id]/route");
    const response = await DELETE(req(`https://t.test/api/web/${OWNER}/figures/anna`, "DELETE"), figureParams);
    expect(response.status).toBe(409);
    const json = await response.json();
    expect(json.error).toBe("figure_referenced");
    expect(json.details?.trips).toContain("figure-user-trip");
    expect(fs.existsSync(figureFile())).toBe(true);
  });

  test("the owner's cookie deletes an unreferenced figure", async () => {
    writeFigure();
    const { DELETE } = await import("@/app/api/web/[user]/figures/[id]/route");
    const response = await DELETE(req(`https://t.test/api/web/${OWNER}/figures/anna`, "DELETE"), figureParams);
    expect(response.status).toBe(200);
    expect(fs.existsSync(figureFile())).toBe(false);
  });
});

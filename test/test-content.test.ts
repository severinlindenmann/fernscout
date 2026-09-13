import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { isIndexable, isTestContent } from "@/lib/access";
import { buildFeedXml } from "@/lib/feed";
import { buildSearchIndexJson } from "@/lib/search";
import { getTrip } from "@/lib/trips";
import { AS_AUTHOR, getAllEntries } from "@/lib/entries";
import { entrySummary, tripSummary } from "@/lib/api/entries";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { issueCode, verifyCode } from "@/lib/auth";

// `mayReadTrip` reads the guest cookie through `next/headers`, which throws
// outside a request scope. An empty jar is the case that matters: a stranger
// with the URL, which is who the twin is for.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));
import { markdownTwin } from "@/lib/api/markdownTwin";

/**
 * `test: true` — content nobody lived.
 *
 * There is one legitimate reason to write a day that did not happen: proving
 * that signup, a journal, a trip, a day and its photographs still work end to
 * end. The guide otherwise forbids inventing detail, and the agent that was
 * asked to do it had no way to mark it — it wrote "this is invented test
 * content" into the prose, which is a convention rather than a guarantee.
 *
 * What is tested here is the containment: reachable by its URL, and nowhere
 * else. A fabricated Tuesday arriving in somebody's feed reader beside real
 * ones is the harm the draft rule exists to prevent, wearing a different hat.
 */

let dir: string;

function writeTrip(id: string, extra: string[], entries: { slug: string; extra?: string[] }[]) {
  const tripPath = path.join(dir, "alex", "trips", id);
  fs.mkdirSync(path.join(tripPath, "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(tripPath, "trip.md"),
    [
      "---",
      `id: ${id}`,
      `title: "${id}"`,
      'start: "2026-01-01"',
      'end: "2026-01-31"',
      "status: past",
      "visibility: public",
      "listed: true",
      ...extra,
      "---",
      "",
      "Body.",
      "",
    ].join("\n"),
  );
  for (const entry of entries) {
    fs.writeFileSync(
      path.join(tripPath, "entries", `2026-01-05-${entry.slug}.md`),
      [
        "---",
        `title: "${entry.slug}"`,
        'date: "2026-01-05"',
        'location: "Somewhere"',
        'country: "Nowhere"',
        ...(entry.extra ?? []),
        "---",
        "",
        `MARKER-${entry.slug.toUpperCase()}`,
        "",
      ].join("\n"),
    );
  }
}

const OWNER_EMAIL = "alex@example.test";

/** A real agent token for alex, minted the way the auth route mints one. */
async function agentToken(): Promise<string> {
  const { code } = await issueCode("alex", OWNER_EMAIL, "agent");
  const verified = await verifyCode("alex", OWNER_EMAIL, code, "agent");
  if (!verified.ok) throw new Error(`could not mint a token: ${verified.reason}`);
  return verified.token;
}

/**
 * The v1 day-list ROUTE (`GET /api/v1/.../days`) is deleted outright, with
 * no v1-side survivor to drive — but the function that gave each row its
 * inherited `test` flag (B116) was `entrySummary` (`lib/api/entries.ts`),
 * called with the trip so `isTestContent` could resolve the inheritance,
 * and that function is untouched: no route imports it any more (a route
 * this migration deleted was its only caller — an orphan left behind,
 * worth a cleanup ticket, not fixed here), but it is exactly the unit B116
 * was actually about, called the same way the route used to call it.
 */
async function dayList(_token: string, trip: string): Promise<Record<string, unknown>[]> {
  const ref = `alex/${trip}`;
  const found = getTrip(ref);
  return getAllEntries(ref, AS_AUTHOR).map((entry) => entrySummary(entry, found));
}

/** ── v2 fixtures, for the two sections below that used to drive deleted v1
 * REST routes ────────────────────────────────────────────────────────────
 *
 * Everything above this reads v1 markdown directly (`getTrip`, `getAllEntries`,
 * `isTestContent`, `buildFeedXml`, `buildSearchIndexJson`, `tripSummary`,
 * `markdownTwin`, `listDrafts`) and needs no change at all: none of it goes
 * through a route, deleted or otherwise. Only the day list (B116) and the
 * drafts queue (B134) drove REST routes directly, and both of those routes
 * are gone — repointed below onto `lib/api/v2/store.ts`'s JSON documents,
 * which is a different storage than the markdown `writeTrip`/`writeDraft`
 * above write to, so each section builds its own v2-native fixture.
 */
import { writeTripFile, writeDayFile } from "@/lib/api/v2/store";
import { toStoredMedia } from "@/lib/api/v2/days";
import { tripCreate, dayWrite } from "@/lib/api/v2/schemas";

function v2Trip(id: string, opts: { test?: boolean } = {}) {
  const parsed = tripCreate.parse({
    id,
    title: id,
    dates: { from: "2026-01-01", to: "2026-01-31" },
    visibility: "public",
    people: [{ name: "Alex B", email: OWNER_EMAIL }],
    ...(opts.test ? { test: true } : {}),
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
      listed: "not advertised for this fixture",
      buddies: "travelling solo",
    },
  });
  const { days: _ignored, ...fields } = parsed;
  writeTripFile("alex", id, fields);
}

function v2Day(tripId: string, slug: string, opts: { test?: boolean; draft?: boolean } = {}) {
  const parsed = dayWrite.parse({
    slug,
    title: slug,
    date: slug.slice(0, 10),
    content: `MARKER-${slug.slice(11).toUpperCase()}`,
    status: "draft",
    ...(opts.test ? { test: true } : {}),
    declined: {
      media: "n/a for this fixture",
      costs: "n/a for this fixture",
      coordinates: "n/a for this fixture",
      weather: "n/a for this fixture",
      time: "n/a for this fixture",
      timezone: "n/a for this fixture",
      location: "n/a for this fixture",
      country: "n/a for this fixture",
      countryCode: "n/a for this fixture",
      transportMode: "n/a for this fixture",
      tags: "n/a for this fixture",
      translations: "n/a for this fixture",
      visibility: "n/a for this fixture",
    },
  });
  // `toStoredMedia` rather than the parsed wire items: a stored day's media
  // carries `type`/`width`/`height`, derived at upload and absent from the
  // wire shape, so `DayFile` is not satisfied by what `dayWrite` returns.
  writeDayFile("alex", tripId, slug, {
    ...parsed,
    media: toStoredMedia(parsed.media, undefined),
    status: opts.draft ? "draft" : "published",
  });
}

async function v2DayList(token: string, tripId: string): Promise<{ slug: string; test?: boolean }[]> {
  const { GET } = await import("@/app/api/v2/[user]/trips/[trip]/days/route");
  const response = await GET(
    new Request(`https://t.test/api/v2/alex/trips/${tripId}/days`, {
      headers: { authorization: `Bearer ${token}` },
    }),
    { params: Promise.resolve({ user: "alex", trip: tripId }) },
  );
  const body = (await response.json()) as { days: { slug: string; test?: boolean }[] };
  if (response.status !== 200) throw new Error(`v2 day list answered ${response.status}: ${JSON.stringify(body)}`);
  return body.days;
}

async function v2Status(token: string) {
  const { GET } = await import("@/app/api/v2/[user]/status/route");
  const response = await GET(new Request("https://t.test/api/v2/alex/status", { headers: { authorization: `Bearer ${token}` } }), {
    params: Promise.resolve({ user: "alex" }),
  });
  return (await response.json()) as { drafts: Record<string, unknown>[] };
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-testflag-"));
  process.env.CONTENT_DIR = dir;
  // The write API needs a session store and a signing key. Auth is on here
  // only so the day list can be called the way an agent calls it.
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "test-secret-for-the-test-flag";
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      features: { auth: { enabled: true } },
    }),
  );
  fs.mkdirSync(path.join(dir, "alex", "trips"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "Alex",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: OWNER_EMAIL },
    }),
  );
  clearConfigCache();
  clearUserCache();

  writeTrip("real-2026", [], [{ slug: "realday" }, { slug: "fakeday", extra: ["test: true"] }]);
  writeTrip("proving-2026", ["test: true"], [{ slug: "provingday" }]);

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

describe("a whole trip marked test", () => {
  test("reads its flag back", () => {
    expect(getTrip("alex/proving-2026")?.test).toBe(true);
    expect(getTrip("alex/real-2026")?.test).toBeUndefined();
  });

  test("is never indexable, however public it says it is", () => {
    // Both trips are `visibility: public, listed: true`. Only one is offered.
    expect(isIndexable(getTrip("alex/real-2026")!)).toBe(true);
    expect(isIndexable(getTrip("alex/proving-2026")!)).toBe(false);
  });

  test("is still readable at its own URL", () => {
    // Not hidden — the point is a banner on a page somebody deliberately
    // opened, not a second draft mechanism.
    expect(getAllEntries("alex/proving-2026")).toHaveLength(1);
  });

  test("covers its days without each of them saying so", () => {
    const day = getAllEntries("alex/proving-2026")[0];
    expect(day.test).toBeUndefined();
    expect(isTestContent(getTrip("alex/proving-2026"), day)).toBe(true);
  });
});

describe("a single test day inside a real trip", () => {
  test("does not reach the feed, while its neighbours do", () => {
    const xml = buildFeedXml("alex")!;
    expect(xml).toContain("MARKER-REALDAY");
    expect(xml).not.toContain("MARKER-FAKEDAY");
    expect(xml).not.toContain("MARKER-PROVINGDAY");
  });

  test("does not reach the search index", () => {
    const json = buildSearchIndexJson("alex")!;
    expect(json).toContain("realday");
    expect(json).not.toContain("fakeday");
    expect(json).not.toContain("provingday");
  });

  test("is still on the site for anyone with the link", () => {
    const slugs = getAllEntries("alex/real-2026").map((e) => e.slug);
    expect(slugs).toContain("fakeday");
  });

  test("and is flagged, so the page can put a banner on it", () => {
    const day = getAllEntries("alex/real-2026").find((e) => e.slug === "fakeday");
    expect(day?.test).toBe(true);
    expect(isTestContent(getTrip("alex/real-2026"), day)).toBe(true);
  });

  test("a real day beside it is not flagged", () => {
    const day = getAllEntries("alex/real-2026").find((e) => e.slug === "realday");
    expect(isTestContent(getTrip("alex/real-2026"), day)).toBe(false);
  });
});

/**
 * B47 — the flag has to survive being read back.
 *
 * It could be written and never seen: `tripSummary` omitted it, so an agent
 * that set it was never told it was accepted; the day read reported only the
 * entry's own, so a day inheriting it from its trip looked ordinary; and worst,
 * the markdown twin — public, unauthenticated, and the surface built so that
 * agents read it *instead of* the page with the banner on it — said nothing at
 * all. That handed invented content, unlabelled, to the one audience with no
 * other way of telling.
 */
describe("reading the flag back", () => {
  test("the trip summary says so, and only when it is true", () => {
    expect(tripSummary("alex", "proving-2026")).toMatchObject({ test: true });
    expect(tripSummary("alex", "real-2026")).not.toHaveProperty("test");
  });

  test("the markdown twin carries it in the frontmatter", async () => {
    const body = await (await markdownTwin("alex", "proving-2026", "provingday")).text();
    expect(body).toMatch(/^test: true$/m);
  });

  test("and says so in words, above the prose", async () => {
    // Frontmatter is for parsers. Anything reading only the text still has to
    // meet the warning, and has to meet it before the content.
    const body = await (await markdownTwin("alex", "proving-2026", "provingday")).text();
    const warning = body.indexOf("did not happen");
    const prose = body.indexOf("MARKER-PROVINGDAY");
    expect(warning).toBeGreaterThan(-1);
    expect(warning).toBeLessThan(prose);
  });

  test("a day that inherits it from its trip is flagged too", async () => {
    // The day carries no flag of its own — this is the case an operator
    // marking a whole test trip actually produces.
    const day = getAllEntries("alex/proving-2026")[0];
    expect(day.test).toBeUndefined();

    const body = await (await markdownTwin("alex", "proving-2026", "provingday")).text();
    expect(body).toMatch(/^test: true$/m);
  });

  test("an ordinary day's twin says none of it", async () => {
    const body = await (await markdownTwin("alex", "real-2026", "realday")).text();
    expect(body).not.toMatch(/^test: true$/m);
    expect(body).not.toContain("did not happen");
  });

  test("a test day inside an otherwise real trip is still flagged", async () => {
    const body = await (await markdownTwin("alex", "real-2026", "fakeday")).text();
    expect(body).toMatch(/^test: true$/m);
    expect(body).toContain("did not happen");
  });
});

/**
 * B116 — the day list, which is where an agent looks for one invented day
 * inside an otherwise real trip. B47 fixed the trip summary, the day read
 * and the markdown twin; B116 fixed the day list itself.
 *
 * v2's own list — `GET /api/v2/{user}/trips/{trip}/days`
 * (`app/api/v2/.../days/route.ts`) — reports `test` correctly for a day that
 * carries the flag itself (repointed below, and still true). What it does
 * NOT do is B47/B116's inheritance half: it builds each row from
 * `dayDoc.parse(dayEchoInput(day))` alone, with no reference to the trip's
 * own `test` at all — so a day inside a `test: true` trip, with no flag of
 * its own, is reported as ordinary. That is the exact shape of bug B116
 * fixed, reappeared on the v2-native day list; the publish/send routes get
 * this right (`isTestContent(...) || trip.test === true || day.test ===
 * true`, checked before every send), so the gap is specifically in what a
 * caller is TOLD when they merely list or read a day, not in what the
 * server will actually do with one. Filed rather than silently worked
 * around: the second test below documents the gap as it stands rather than
 * asserting the (currently false) fixed behaviour.
 */
describe("the day list says which days did not happen — repointed onto entrySummary directly, the v1 route is gone", () => {
  test("a day that inherits the flag from its trip is marked", async () => {
    expect(getAllEntries("alex/proving-2026")[0].test).toBeUndefined();
    const days = await dayList(await agentToken(), "proving-2026");
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({ slug: "provingday", test: true });
  });

  test("a single invented day inside a real trip is marked, and its neighbour is not", async () => {
    const days = await dayList(await agentToken(), "real-2026");
    const bySlug = Object.fromEntries(days.map((d) => [d.slug as string, d]));
    expect(bySlug.fakeday).toMatchObject({ test: true });
    expect(bySlug.realday).not.toHaveProperty("test");
  });
});

describe("v2's day list — GET /api/v2/{user}/trips/{trip}/days (B1612 repoint)", () => {
  test("a day's own test flag is reported", async () => {
    v2Trip("v2-real");
    v2Day("v2-real", "2026-01-05-fakeday", { test: true });
    v2Day("v2-real", "2026-01-05-realday");

    const days = await v2DayList(await agentToken(), "v2-real");
    const bySlug = Object.fromEntries(days.map((d) => [d.slug, d]));
    expect(bySlug["2026-01-05-fakeday"]).toMatchObject({ test: true });
    expect(bySlug["2026-01-05-realday"]).not.toHaveProperty("test");
  });

  /**
   * B1620 #1 closed the gap this test used to document: unlike v1's day list
   * (B116, still exercised above), v2's did NOT resolve a day's `test` status
   * from its trip — a day with no flag of its own, inside a `test: true`
   * trip, read as ordinary here, the exact bug B116 exists to have fixed,
   * present again in the v2-native path. `resolveDayTest`
   * (`lib/api/v2/days.ts`), called from `app/api/v2/[user]/trips/[trip]/days/route.ts`,
   * is the fix — mirroring the `isTestContent`/`trip.test` check the publish
   * route already makes.
   */
  test("inheriting the flag from the trip is resolved here (the B116 bug, fixed)", async () => {
    v2Trip("v2-proving", { test: true });
    v2Day("v2-proving", "2026-01-05-provingday"); // no flag of its own

    const days = await v2DayList(await agentToken(), "v2-proving");
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({ test: true });
  });
});

/**
 * B134 — the review queue, which is the surface read out loud to a person at
 * the moment they decide what goes on the site. `GET /api/v1/<user>/drafts`
 * is deleted; v2's equivalent field is `drafts` on
 * `GET /api/v2/{user}/status` (`lib/api/v2/status.ts`'s `buildJournalStatus`,
 * still reading v1 markdown through `listDrafts` unchanged — this endpoint
 * was never migrated off the v1 read layer, so the fixtures above work
 * unmodified). What is NOT preserved: `buildJournalStatus` narrows every
 * draft down to `{trip, slug}` before it reaches the wire (its own comment:
 * the v2 status schema is deliberately a "smaller, frozen contract" than
 * v1's `journalStatus`) — `title`, `date` AND `test` are all dropped. B134's
 * whole property (an agent reading the review queue is told which drafts
 * nobody lived) does not survive onto this endpoint at all; there is no
 * partial repoint to make; the test below documents the absence rather than
 * asserting a property that is not there to assert.
 */
describe("the review queue says which drafts nobody lived — repointed onto draftQueue directly, the v1 route is gone", () => {
  /** A draft in one of the fixture trips. */
  function writeDraft(trip: string, slug: string, extra: string[] = []) {
    fs.writeFileSync(
      path.join(dir, "alex", "trips", trip, "entries", `2026-01-09-${slug}.md`),
      [
        "---",
        `title: "${slug}"`,
        'date: "2026-01-09"',
        'location: "Somewhere"',
        "status: draft",
        ...extra,
        "---",
        "",
        `MARKER-${slug.toUpperCase()}`,
        "",
      ].join("\n"),
    );
  }

  /**
   * `GET /api/v1/<user>/drafts` is deleted outright. What it called —
   * `draftQueue` (`lib/api/status.ts`) — is untouched and still resolves
   * B134's inheritance the same way (via `listDrafts`), so this drives that
   * function directly with a real resolved session rather than a route that
   * no longer exists.
   */
  async function draftsRoute(token: string) {
    const { resolveBearer } = await import("@/lib/api/v2/auth");
    const { draftQueue } = await import("@/lib/api/status");
    const bearer = await resolveBearer(
      new Request("https://t.test/api/v1/alex/drafts", { headers: { authorization: `Bearer ${token}` } }),
    );
    if (!bearer.ok) throw new Error("could not resolve the bearer session");
    return draftQueue("alex", bearer.session, "https://t.test") as unknown as Record<string, unknown>[];
  }

  test("a draft that inherits the flag from its trip is marked", async () => {
    writeDraft("proving-2026", "provingdraft");
    const { listDrafts } = await import("@/lib/api/entries");
    expect(listDrafts("alex/proving-2026")).toEqual([
      { slug: "provingdraft", title: "provingdraft", date: "2026-01-09", test: true },
    ]);

    const drafts = await draftsRoute(await agentToken());
    expect(drafts.find((d) => d.slug === "provingdraft")).toMatchObject({ test: true });
  });

  test("a draft with its own flag is marked, and a real one beside it is not", async () => {
    writeDraft("real-2026", "fakedraft", ["test: true"]);
    writeDraft("real-2026", "realdraft");

    const drafts = await draftsRoute(await agentToken());
    const bySlug = Object.fromEntries(drafts.map((d) => [d.slug as string, d]));
    expect(bySlug.fakedraft).toMatchObject({ test: true });
    expect(bySlug.realdraft).not.toHaveProperty("test");
  });
});

describe("v2's status endpoint — GET /api/v2/{user}/status (B1620 #2: drafts widened)", () => {
  test("its drafts list carries title and test, resolved from listDrafts", async () => {
    // `buildJournalStatus` reads through `listDrafts` — the v1 markdown
    // reader — regardless of anything v2-native, so the already-fixtured
    // "proving-2026" trip (whole-trip `test: true`, beforeEach above) and a
    // hand-written draft inside it are enough; no v2 JSON document is
    // involved in this endpoint at all.
    fs.writeFileSync(
      path.join(dir, "alex", "trips", "proving-2026", "entries", "2026-01-09-queueday.md"),
      ["---", 'title: "queueday"', 'date: "2026-01-09"', "status: draft", "---", "", "MARKER-QUEUEDAY", ""].join("\n"),
    );

    const status = await v2Status(await agentToken());
    const row = status.drafts.find((d) => d.slug === "queueday");
    expect(row).toBeDefined();
    // `{trip, slug, title, test}` — widened per Q14 ("widen: yes"), so an
    // agent reading the review queue can say which day is waiting and
    // whether it is content nobody lived, with no GET per row.
    expect(row).toMatchObject({ trip: "proving-2026", slug: "queueday", title: "queueday", test: true });
  });
});

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
import { getAllEntries } from "@/lib/entries";
import { tripSummary } from "@/lib/api/entries";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { issueCode, verifyCode } from "@/lib/auth";
import { GET as dayListRoute } from "@/app/api/v1/[user]/trips/[trip]/days/route";

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

/** `GET /api/v1/alex/trips/<trip>/days`, through the route itself. */
async function dayList(token: string, trip: string): Promise<Record<string, unknown>[]> {
  const response = await dayListRoute(
    new Request(`https://t.test/api/v1/alex/trips/${trip}/days`, {
      headers: { authorization: `Bearer ${token}` },
    }),
    { params: Promise.resolve({ user: "alex", trip }) },
  );
  const body = (await response.json()) as { days: Record<string, unknown>[] };
  if (response.status !== 200) throw new Error(`day list answered ${response.status}`);
  return body.days;
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
 * inside an otherwise real trip.
 *
 * B47 fixed the trip summary, the day read and the markdown twin. This list
 * still returned `slug`, `title`, `date`, `location`, `lat`, `lng` and
 * `photos` and no `test`, so the one surface built for enumerating a trip's
 * days was also the one surface that could not tell you which of them nobody
 * lived.
 */
describe("the day list says which days did not happen", () => {
  test("a day that inherits the flag from its trip is marked", async () => {
    // The case that was silent: the operator marked the trip once, so the
    // entry file carries nothing of its own.
    expect(getAllEntries("alex/proving-2026")[0].test).toBeUndefined();

    const days = await dayList(await agentToken(), "proving-2026");
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({ slug: "provingday", test: true });
  });

  test("a single invented day inside a real trip is marked, and its neighbour is not", async () => {
    const days = await dayList(await agentToken(), "real-2026");
    const bySlug = Object.fromEntries(days.map((d) => [d.slug as string, d]));

    expect(bySlug.fakeday).toMatchObject({ test: true });
    // Absent, not `false`: absent means real, which is what every other flag
    // on these surfaces does.
    expect(bySlug.realday).not.toHaveProperty("test");
  });

  test("and agrees with the day read about the same day", async () => {
    // Two doors onto one day. `GET .../days/<slug>` has resolved the
    // inherited flag since B47; the list must not answer differently.
    const { GET: dayRoute } = await import(
      "@/app/api/v1/[user]/trips/[trip]/days/[slug]/route"
    );
    const token = await agentToken();
    const one = await dayRoute(
      new Request("https://t.test/api/v1/alex/trips/proving-2026/days/provingday", {
        headers: { authorization: `Bearer ${token}` },
      }),
      { params: Promise.resolve({ user: "alex", trip: "proving-2026", slug: "provingday" }) },
    );
    const read = (await one.json()) as { test?: boolean };
    const listed = (await dayList(token, "proving-2026"))[0];

    expect(read.test).toBe(true);
    expect(listed.test).toBe(read.test);
  });
});

/**
 * B134 — the review queue, which is the surface read out loud to a person at
 * the moment they decide what goes on the site.
 *
 * B47 fixed the trip summary, the day read and the markdown twin; B116 fixed
 * the day list. `listDrafts` returned `{ slug, title, date }` and nothing else,
 * so `GET /api/v1/<user>/drafts` — the one list an agent is *instructed* to
 * read back before asking "which of these do you want up?" — could not say
 * that a draft was content nobody lived. An agent
 * that names five drafts without mentioning that two are inventions has handed
 * somebody a decision without the fact that decides it.
 */
describe("the review queue says which drafts nobody lived", () => {
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

  async function draftsRoute(token: string) {
    const { GET } = await import("@/app/api/v1/[user]/drafts/route");
    const response = await GET(
      new Request("https://t.test/api/v1/alex/drafts", {
        headers: { authorization: `Bearer ${token}` },
      }),
      { params: Promise.resolve({ user: "alex" }) },
    );
    const body = (await response.json()) as { drafts: Record<string, unknown>[] };
    return body.drafts;
  }

  test("a draft that inherits the flag from its trip is marked", async () => {
    // The case that was silent, and the likely one: the whole trip is a
    // proving run, so the entry file says nothing of its own.
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
    // Absent, not `false` — absent means real, on every surface that carries
    // this flag.
    expect(bySlug.realdraft).not.toHaveProperty("test");
  });

  test("and the queue agrees with the day read about the same day", async () => {
    // Two doors, one day. Publishing it is the decision this list exists to
    // inform, so the two must not describe it differently.
    writeDraft("proving-2026", "provingdraft");
    const token = await agentToken();
    const { GET: dayRoute } = await import(
      "@/app/api/v1/[user]/trips/[trip]/days/[slug]/route"
    );
    const one = await dayRoute(
      new Request("https://t.test/api/v1/alex/trips/proving-2026/days/provingdraft", {
        headers: { authorization: `Bearer ${token}` },
      }),
      { params: Promise.resolve({ user: "alex", trip: "proving-2026", slug: "provingdraft" }) },
    );
    const read = (await one.json()) as { test?: boolean };
    const queued = (await draftsRoute(token)).find((d) => d.slug === "provingdraft");

    expect(read.test).toBe(true);
    expect(queued?.test).toBe(read.test);
  });
});

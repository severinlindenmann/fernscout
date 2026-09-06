import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * The write budget — B571.
 *
 * B566 made every page open cost a database row, on a codebase where page
 * renders are not rate-limited at all (`lib/rateLimit.ts` is called from
 * `app/api/` only). An unauthenticated loop against `/<user>` therefore cost
 * unbounded rows, on the one disk Postgres is on, for every journal on the
 * instance — availability rather than disclosure, since nothing about a reader
 * is stored either way.
 *
 * What has to be true, and what this file asserts:
 *
 * - a flood from one address is **bounded**, and the site keeps rendering;
 * - ordinary reading is **untouched** — this is the half that would make the
 *   feature useless if it went wrong, because a limit set on the wrong side of
 *   a household's evening turns real readers into a flat line;
 * - the budget is spent on rows **written**, not requests received, so an
 *   owner's own reading does not consume the family's.
 */

/** What the page render hands to `recordView`. Re-set per test. */
const req = vi.hoisted(() => ({ headers: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(req.headers),
  // Nobody is signed in in this file: `isOwner` reads a session through
  // `resolveAccess`, and no cookie means no owner, which is the anonymous
  // stranger this ticket is about.
  cookies: async () => ({ get: () => undefined }),
}));

const OWNER = "ana";
const BROWSER =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

let dir: string;

/** One page open from one address. */
async function view(ip: string, slug = "d1"): Promise<void> {
  req.headers = { "x-forwarded-for": ip, "user-agent": BROWSER };
  const { recordView } = await import("@/lib/analytics/record");
  await recordView(OWNER, { kind: "day", tripId: "alps", slug });
}

async function rowCount(): Promise<number> {
  const { getDatabase } = await import("@/lib/db");
  const handle = await getDatabase();
  const rows = await handle.db.selectFrom("analytics_events").selectAll().execute();
  return rows.length;
}

async function settle(): Promise<void> {
  const { flushAfterResponse } = await import("@/lib/afterResponse");
  await flushAfterResponse();
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-budget-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "budget.db")}`;

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test" },
      users: { reserved: [] },
      features: { analytics: { enabled: true } },
    }),
  );
  fs.mkdirSync(path.join(dir, OWNER), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Ana",
      owner: { name: "Ana A", nickname: "Ana", email: "ana@example.test" },
      features: { analytics: { enabled: true } },
    }),
  );

  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  clearConfigCache();
  clearUserCache();
});

beforeEach(async () => {
  // The table, not the limiter: `lib/rateLimit.ts` holds one module-level map
  // with no reset, deliberately (nothing in the application should be able to
  // clear a limit). So every test below uses an address of its own rather than
  // asking for the map to be emptied.
  const { getDatabase } = await import("@/lib/db");
  const handle = await getDatabase();
  await handle.db.deleteFrom("analytics_events").execute();
});

afterAll(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("a flood from one address is bounded", () => {
  test("a thousand requests leave at most the budget, and nothing throws", async () => {
    const { VIEW_BUDGET } = await import("@/lib/analytics/record");
    for (let i = 0; i < 1000; i++) await view("198.51.100.1", `d${i}`);
    await settle();
    // The bound, exactly: 1000 requests in, `max` rows out. Before B571 this
    // was 1000 — and 1000 is the small number; the ticket's flood is millions.
    expect(await rowCount()).toBe(VIEW_BUDGET.max);
  });

  test("the page still renders — a flood is dropped, never refused", async () => {
    // `recordView` resolves normally past the budget rather than throwing or
    // signalling. The reader gets their page; only the counting stops. If this
    // ever became a refusal, one stranger's loop would decide who may read a
    // family's journal.
    await expect(view("198.51.100.2")).resolves.toBeUndefined();
    for (let i = 0; i < 400; i++) {
      await expect(view("198.51.100.2", `d${i}`)).resolves.toBeUndefined();
    }
  });

  test("one address being throttled does not silence another", async () => {
    const { VIEW_BUDGET } = await import("@/lib/analytics/record");
    for (let i = 0; i < VIEW_BUDGET.max + 50; i++) await view("198.51.100.3", `d${i}`);
    await settle();
    const afterFlood = await rowCount();

    await view("198.51.100.4");
    await settle();
    // The neighbour's single honest visit is still counted. A shared bucket
    // would have made one flooder erase everybody else's readership.
    expect(await rowCount()).toBe(afterFlood + 1);
  });
});

describe("ordinary reading is untouched", () => {
  test("a person opening ten days in a row is ten rows", async () => {
    for (let i = 0; i < 10; i++) await view("203.0.113.10", `day-${i}`);
    await settle();
    expect(await rowCount()).toBe(10);
  });

  test("a household's whole evening still fits", async () => {
    const { VIEW_BUDGET } = await import("@/lib/analytics/record");
    // Four people behind one connection, each reading a forty-day trip end to
    // end. This is the number the budget was chosen against, and it is the
    // assertion that fails if somebody tightens it without thinking about who
    // shares an address.
    const evening = 4 * 43;
    expect(evening).toBeLessThan(VIEW_BUDGET.max);
    for (let i = 0; i < evening; i++) await view("203.0.113.11", `day-${i}`);
    await settle();
    expect(await rowCount()).toBe(evening);
  });
});

describe("the budget is spent on rows, not on requests", () => {
  test("bots and prefetches cost nothing", async () => {
    const { VIEW_BUDGET } = await import("@/lib/analytics/record");
    const { recordView } = await import("@/lib/analytics/record");

    // Two thousand crawls and prefetches from one address...
    for (let i = 0; i < 1000; i++) {
      req.headers = { "x-forwarded-for": "203.0.113.12", "user-agent": "Googlebot/2.1" };
      await recordView(OWNER, { kind: "journal", tripId: "alps" });
      req.headers = {
        "x-forwarded-for": "203.0.113.12",
        "user-agent": BROWSER,
        "next-router-prefetch": "1",
      };
      await recordView(OWNER, { kind: "journal", tripId: "alps" });
    }
    await settle();
    expect(await rowCount()).toBe(0);

    // ...and the reader behind that same address still has their whole budget.
    for (let i = 0; i < VIEW_BUDGET.max; i++) await view("203.0.113.12", `d${i}`);
    await settle();
    expect(await rowCount()).toBe(VIEW_BUDGET.max);
  });
});

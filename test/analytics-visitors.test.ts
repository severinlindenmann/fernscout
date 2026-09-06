import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase, newId, nowIso } from "@/lib/db";
import { RETENTION_DAYS } from "@/lib/analytics/record";
import { visitorReport } from "@/lib/analytics/report";
import { dailySalt, forgetSalt, looksLikeBot, visitorHash } from "@/lib/analytics/visitor";
import { dialectCases } from "./support/dialects";

/**
 * B566, and specifically the half a code review cannot see.
 *
 * `site/legal/*.md` now makes four claims to readers, in words, on behalf of
 * this code: that the IP address is never stored, that the identifier rotates
 * daily, that yesterday cannot be linked to today, and that rows are deleted
 * after about ninety days. A test suite that only checked the report added up
 * would leave every one of those as an assertion nobody had ever run.
 *
 * So the first describe block is not "unit tests for a hash function". It is
 * the imprint, mechanised.
 */

describe("the visitor identifier is what the imprint says it is", () => {
  beforeEach(() => forgetSalt());
  afterEach(() => forgetSalt());

  const day1 = new Date("2026-03-01T09:00:00Z");
  const day2 = new Date("2026-03-02T09:00:00Z");

  test("the same reader within one day is one visitor", () => {
    const a = visitorHash("alice", "203.0.113.9", "Mozilla/5.0", day1);
    const b = visitorHash("alice", "203.0.113.9", "Mozilla/5.0", new Date("2026-03-01T23:59:00Z"));
    expect(a).toBe(b);
  });

  test("the next day is a different code, and nothing links the two", () => {
    const before = visitorHash("alice", "203.0.113.9", "Mozilla/5.0", day1);
    const after = visitorHash("alice", "203.0.113.9", "Mozilla/5.0", day2);
    expect(after).not.toBe(before);
    // And the salt that made the first is gone, not merely superseded — which
    // is the property that makes yesterday's rows unattributable rather than
    // just inconvenient to attribute.
    expect(dailySalt(day2).equals(dailySalt(day2))).toBe(true);
    expect(visitorHash("alice", "203.0.113.9", "Mozilla/5.0", day1)).not.toBe(before);
  });

  test("a restart rotates early rather than persisting the salt", () => {
    const before = visitorHash("alice", "203.0.113.9", "Mozilla/5.0", day1);
    forgetSalt(); // what a process restart does
    expect(visitorHash("alice", "203.0.113.9", "Mozilla/5.0", day1)).not.toBe(before);
  });

  test("two journals cannot compare notes about the same reader", () => {
    expect(visitorHash("alice", "203.0.113.9", "UA", day1)).not.toBe(
      visitorHash("bob", "203.0.113.9", "UA", day1),
    );
  });

  test("different readers are different codes", () => {
    const a = visitorHash("alice", "203.0.113.9", "UA", day1);
    expect(visitorHash("alice", "203.0.113.10", "UA", day1)).not.toBe(a);
    expect(visitorHash("alice", "203.0.113.9", "Other", day1)).not.toBe(a);
  });

  test("the code is not a reversible encoding of anything it was made from", () => {
    const hash = visitorHash("alice", "203.0.113.9", "Mozilla/5.0 (X11)", day1);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    expect(hash).not.toContain("203");
    expect(hash).not.toContain("alice");
  });

  test("a field boundary cannot be forged by moving the separator", () => {
    // `a` + `:b` must not collide with `a:` + `b`, which a naively joined
    // input would allow an attacker-controlled user agent to arrange.
    expect(visitorHash("alice", "1.1.1.1", ":UA", day1)).not.toBe(
      visitorHash("alice", "1.1.1.1:", "UA", day1),
    );
  });

  test("machines are not readers", () => {
    expect(looksLikeBot("Googlebot/2.1")).toBe(true);
    expect(looksLikeBot("WhatsApp/2.2 preview")).toBe(true);
    expect(looksLikeBot("curl/8.4.0")).toBe(true);
    expect(looksLikeBot(null)).toBe(true);
    expect(looksLikeBot("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/605.1")).toBe(false);
  });
});

/** Undefined for the block above, which needs no journal on disk — the
 * teardown below is file-scoped and runs for it too. */
let dir: string | undefined;

async function setup(dialect: string, enabled: boolean): Promise<void> {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-analytics-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL =
    dialect === "postgres"
      ? process.env.POSTGRES_TEST_URL!
      : `sqlite:${path.join(dir, "analytics.db")}`;

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test" },
      users: { reserved: [] },
      features: { analytics: { enabled: true } },
    }),
  );
  fs.mkdirSync(path.join(dir, "alice"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alice", "config.json"),
    JSON.stringify({
      title: "Alice",
      owner: { name: "Alice A", nickname: "Alice", email: "a@example.test" },
      features: { analytics: { enabled } },
    }),
  );
  clearConfigCache();
  clearUserCache();

  const handle = await getDatabase();
  const { dropEverything } = await import("./support/dialects");
  if (dialect === "postgres") {
    await dropEverything(handle);
    const { migrateToLatest } = await import("@/lib/db/migrate");
    await migrateToLatest(handle);
  }
}

/** Rows written directly: `recordView` needs a request scope for `headers()`,
 * and what is under test here is the reading and the sweeping. The recording
 * path's own decisions are covered by the identifier block above and by the
 * acceptance walk-through in the browser. */
async function seed(rows: {
  kind: string;
  tripId?: string | null;
  slug?: string | null;
  visitor: string;
  at: string;
}[]): Promise<void> {
  const handle = await getDatabase();
  await handle.db
    .insertInto("analytics_events")
    .values(
      rows.map((r) => ({
        id: newId(),
        owner_id: "alice",
        kind: r.kind,
        trip_id: r.tripId ?? null,
        slug: r.slug ?? null,
        visitor_hash: r.visitor,
        occurred_at: r.at,
      })),
    )
    .execute();
}

function daysAgo(n: number, now: Date): string {
  return new Date(now.getTime() - n * 86_400_000).toISOString();
}

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  clearConfigCache();
  clearUserCache();
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe.each(dialectCases().map((c) => c.name))("the report (%s)", (dialect) => {
  const now = new Date("2026-05-01T12:00:00Z");
  beforeEach(() => setup(dialect, true));

  test("opens and people are counted separately", async () => {
    await seed([
      { kind: "journal", tripId: "alps", visitor: "aaa", at: daysAgo(1, now) },
      { kind: "journal", tripId: "alps", visitor: "aaa", at: daysAgo(1, now) },
      { kind: "journal", tripId: "alps", visitor: "bbb", at: daysAgo(1, now) },
    ]);
    const r = await visitorReport("alice", 30, now);
    // Three opens by two people. Reporting either number alone is the thing
    // this pair exists to prevent.
    expect(r?.opens).toBe(3);
    expect(r?.visitors).toBe(2);
  });

  test("the gallery is countable, which is why there is no client beacon", async () => {
    await seed([
      { kind: "gallery", tripId: "alps", visitor: "aaa", at: daysAgo(1, now) },
      { kind: "day", tripId: "alps", slug: "2026-04-02-pass", visitor: "aaa", at: daysAgo(1, now) },
    ]);
    const r = await visitorReport("alice", 30, now);
    expect(r?.kinds.find((k) => k.kind === "gallery")?.opens).toBe(1);
    expect(r?.entries).toEqual([
      { id: "2026-04-02-pass", label: "2026-04-02-pass", opens: 1, visitors: 1 },
    ]);
  });

  test("trips are ranked, and a day belongs to its trip as well as to itself", async () => {
    await seed([
      { kind: "trip", tripId: "alps", visitor: "aaa", at: daysAgo(2, now) },
      { kind: "day", tripId: "alps", slug: "d1", visitor: "bbb", at: daysAgo(2, now) },
      { kind: "trip", tripId: "peru", visitor: "aaa", at: daysAgo(2, now) },
    ]);
    const r = await visitorReport("alice", 30, now);
    expect(r?.trips.map((t) => [t.id, t.opens])).toEqual([
      ["alps", 2],
      ["peru", 1],
    ]);
  });

  test("the window excludes what is outside it", async () => {
    await seed([
      { kind: "journal", tripId: "alps", visitor: "aaa", at: daysAgo(2, now) },
      { kind: "journal", tripId: "alps", visitor: "aaa", at: daysAgo(20, now) },
    ]);
    expect((await visitorReport("alice", 7, now))?.opens).toBe(1);
    expect((await visitorReport("alice", 30, now))?.opens).toBe(2);
  });

  test("rows past their retention are gone once somebody looks", async () => {
    await seed([
      { kind: "journal", tripId: "alps", visitor: "aaa", at: daysAgo(RETENTION_DAYS + 5, now) },
      { kind: "journal", tripId: "alps", visitor: "aaa", at: daysAgo(1, now) },
    ]);
    await visitorReport("alice", 7, now);
    const handle = await getDatabase();
    const left = await handle.db.selectFrom("analytics_events").selectAll().execute();
    // Not merely absent from the report — actually deleted, which is the claim
    // the imprint makes.
    expect(left).toHaveLength(1);
  });

  test("one journal's rows are not another's", async () => {
    await seed([{ kind: "journal", tripId: "alps", visitor: "aaa", at: daysAgo(1, now) }]);
    const handle = await getDatabase();
    await handle.db
      .insertInto("analytics_events")
      .values({
        id: newId(),
        owner_id: "bob",
        kind: "journal",
        trip_id: "x",
        slug: null,
        visitor_hash: "zzz",
        occurred_at: nowIso(),
      })
      .execute();
    expect((await visitorReport("alice", 30, now))?.opens).toBe(1);
  });

  test("a journal with nothing recorded reports zero rather than nothing", async () => {
    const r = await visitorReport("alice", 30, now);
    // Not null: the capability is on and the database answered. "Nobody has
    // read it" and "we cannot tell you" must stay different answers.
    expect(r).not.toBeNull();
    expect(r?.opens).toBe(0);
    expect(r?.perDay).toEqual([]);
  });
});

describe.each(dialectCases().map((c) => c.name))("with analytics switched off (%s)", (dialect) => {
  beforeEach(() => setup(dialect, false));

  test("there is no report at all, which is what makes the page absent", async () => {
    await seed([{ kind: "journal", visitor: "aaa", at: nowIso() }]);
    expect(await visitorReport("alice", 30)).toBeNull();
  });
});

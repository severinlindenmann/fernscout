import "server-only";
import { sql } from "kysely";
import { isEnabled } from "../capabilities";
import { getDatabaseOrNull } from "../db";
import { RETENTION_DAYS, type ViewKind } from "./record";

/**
 * What the owner is shown — B566.
 *
 * Three questions, and the page answers exactly these: how much was opened and
 * by how many people, over time; which trips and days; and how much of it was
 * the gallery. Anything else an analytics product would show is either derived
 * from data this design does not keep (country, browser, device) or is the
 * referrer, which is deliberately not recorded — see `021-analytics`.
 *
 * **Opens and visitors are two numbers, everywhere.** `count(*)` and
 * `count(distinct visitor_hash)`. Reporting only the first makes one person
 * refreshing look like a readership; only the second hides that somebody read
 * the whole trip twice. Both, side by side, is the honest pair — with the
 * caveat that a "visitor" is one day's worth of one address, which the page
 * says in words next to the figure.
 *
 * ponytail: one query per panel, no cache, no rollup table. A journal's ninety
 * days is thousands of rows behind an index, and this page is opened by one
 * person occasionally. Add a rollup when a real journal makes it slow.
 */

type DayCount = { day: string; opens: number; visitors: number };
type Named = { id: string; label: string; opens: number; visitors: number };

export type VisitorReport = {
  days: number;
  opens: number;
  visitors: number;
  /** One row per calendar day in the window that has any traffic. Days with
   * nothing are absent rather than zero-filled; the page draws the gaps. */
  perDay: DayCount[];
  /** Trip ids, most-opened first. */
  trips: Named[];
  /** Day slugs, most-opened first, across the whole journal. */
  entries: Named[];
  /** Opens per kind — how the reading actually divided up. */
  kinds: { kind: ViewKind; opens: number; visitors: number }[];
};

/** `count(distinct …)` comes back as a bigint on Postgres and a number on
 * SQLite; every count in this file goes through here for that reason. */
function n(value: unknown): number {
  return Number(value ?? 0);
}

function since(days: number, now: Date): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}

/**
 * Delete what is past its retention.
 *
 * On the read path, deliberately: a sweep that only matters when somebody
 * looks can run when somebody looks, and this saves a job, a worker and a
 * schedule for a table one person reads. The cost is that a journal nobody
 * has opened the page of keeps rows a little longer than ninety days — so the
 * imprint says "about ninety days", not "exactly".
 *
 * ponytail: opportunistic sweep. Move it into `lib/jobs` if retention ever has
 * to be provable rather than merely true.
 */
async function sweep(handle: NonNullable<Awaited<ReturnType<typeof getDatabaseOrNull>>>, now: Date) {
  await handle.db
    .deleteFrom("analytics_events")
    .where("occurred_at", "<", since(RETENTION_DAYS, now))
    .execute();
}

export async function visitorReport(
  username: string,
  days: number,
  now: Date = new Date(),
): Promise<VisitorReport | null> {
  if (!isEnabled("analytics", username)) return null;
  const handle = await getDatabaseOrNull();
  // The capability requires a database, so this is an outage rather than a
  // configuration. Null, not an empty report: "nobody read it" and "we cannot
  // tell you" must not render as the same page.
  if (!handle) return null;

  await sweep(handle, now);

  const from = since(days, now);
  const scope = handle.db
    .selectFrom("analytics_events")
    .where("owner_id", "=", username)
    .where("occurred_at", ">=", from);

  const opens = sql<number>`count(*)`.as("opens");
  const visitors = sql<number>`count(distinct visitor_hash)`.as("visitors");

  const [totals, perDay, trips, entries, kinds] = await Promise.all([
    scope.select([opens, visitors]).executeTakeFirst(),
    // The date, as text. `substr` over an ISO-8601 string is the one date
    // expression that means the same thing on both dialects — `date_trunc` is
    // Postgres-only and `strftime` is SQLite-only. This is why timestamps are
    // stored as text; see the note at the top of lib/db/schema.ts.
    scope
      .select([sql<string>`substr(occurred_at, 1, 10)`.as("day"), opens, visitors])
      .groupBy(sql`substr(occurred_at, 1, 10)`)
      .orderBy(sql`substr(occurred_at, 1, 10)`)
      .execute(),
    scope
      .where("trip_id", "is not", null)
      .select(["trip_id", opens, visitors])
      .groupBy("trip_id")
      .orderBy("opens", "desc")
      .limit(20)
      .execute(),
    scope
      .where("kind", "=", "day")
      .where("slug", "is not", null)
      .select(["slug", opens, visitors])
      .groupBy("slug")
      .orderBy("opens", "desc")
      .limit(20)
      .execute(),
    scope.select(["kind", opens, visitors]).groupBy("kind").orderBy("opens", "desc").execute(),
  ]);

  return {
    days,
    opens: n(totals?.opens),
    visitors: n(totals?.visitors),
    perDay: perDay.map((r) => ({ day: r.day, opens: n(r.opens), visitors: n(r.visitors) })),
    trips: trips.map((r) => ({
      id: r.trip_id ?? "",
      label: r.trip_id ?? "",
      opens: n(r.opens),
      visitors: n(r.visitors),
    })),
    entries: entries.map((r) => ({
      id: r.slug ?? "",
      label: r.slug ?? "",
      opens: n(r.opens),
      visitors: n(r.visitors),
    })),
    kinds: kinds.map((r) => ({
      kind: r.kind as ViewKind,
      opens: n(r.opens),
      visitors: n(r.visitors),
    })),
  };
}

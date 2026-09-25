import type { MigrationDb } from "./types";

/**
 * Whether anybody is reading — B566.
 *
 * The owner sends a guest link to their family and has, until this table, no
 * way to know whether it was opened. `features.logging` (B257) writes a line
 * per request to `journalctl`, which is an operator's tool on a server the
 * owner may not have a shell on, and it carries no identity at all by design.
 *
 * ## Why the row is this narrow
 *
 * Everything an analytics product normally stores — country, city, browser,
 * device, operating system — is derived from the IP address and the user
 * agent, and both of those are hashed and discarded before anything reaches
 * this table (`lib/analytics/visitor.ts`). Storing any of it would mean
 * keeping the inputs, which is the one thing the design exists to avoid.
 *
 * The referrer is left out for a different and sharper reason: it is where a
 * *private* link was pasted. A journal's whole access model is that a closed
 * trip's URL is only as safe as the people it was sent to, and a referrer
 * column would quietly record which chat application or forum it travelled
 * through.
 *
 * ## Why there is no unique constraint
 *
 * A visitor opening the same day twice is two rows, and that is the intent:
 * opens and unique visitors are two different questions and the page shows
 * both. Deduplication happens in the query — `count(distinct visitor_hash)` —
 * where it can be undone, rather than in the schema, where it cannot.
 *
 * ## Retention
 *
 * Rows older than ninety days are deleted opportunistically on the read path
 * (`lib/analytics/report.ts`). No job, no worker: a sweep that only matters
 * when somebody looks at the page can happen when somebody looks at the page.
 * Ninety days is stated to readers in `site/legal/*.md`, so the number in
 * `RETENTION_DAYS` and the number in the imprint are one fact in two files and
 * have to be changed together.
 */
export async function up(db: MigrationDb): Promise<void> {
  await db.schema
    .createTable("analytics_events")
    .addColumn("id", "text", (c) => c.primaryKey().notNull())
    // The username, per the first convention in lib/db/owner.ts. `notNull` on
    // every column that has a value in every row: SQLite permits NULL in a
    // TEXT PRIMARY KEY, and `test/db-migrations.test.ts` checks nullability
    // agrees across the two dialects.
    .addColumn("owner_id", "text", (c) => c.notNull())
    .addColumn("kind", "text", (c) => c.notNull())
    .addColumn("trip_id", "text")
    .addColumn("slug", "text")
    .addColumn("visitor_hash", "text", (c) => c.notNull())
    .addColumn("occurred_at", "text", (c) => c.notNull())
    .execute();

  // Every query this table answers is "one journal, one window of time", and
  // the retention sweep is a range delete on the same two columns. Without
  // this the page is a full scan, which is fine at a thousand rows and is not
  // the size this is being built for.
  await db.schema
    .createIndex("analytics_events_owner_time")
    .on("analytics_events")
    .columns(["owner_id", "occurred_at"])
    .execute();
}

export async function down(db: MigrationDb): Promise<void> {
  await db.schema.dropIndex("analytics_events_owner_time").execute();
  await db.schema.dropTable("analytics_events").execute();
}

/**
 * Delete `message_log` rows older than 90 days — B2438.
 *
 *   npm run messages:sweep
 *   npm run messages:sweep -- --dry-run
 *
 * Run nightly by `scripts/backup.sh`, next to `reminders:send`. `--dry-run`
 * deletes nothing and only reports the count, the same contract every other
 * sweep script here keeps.
 *
 * Run through `tsx --conditions=react-server` (see package.json): the module
 * it reaches is `server-only`.
 */
import { sweepOldMessages, RETENTION_DAYS } from "../lib/messages/log";
import { getDatabaseOrNull } from "../lib/db";

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const handle = await getDatabaseOrNull();
  if (!handle) {
    console.log("[messages:sweep] no database configured; nothing to sweep.");
    return;
  }
  if (dryRun) {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { count } = await handle.db
      .selectFrom("message_log")
      .select(({ fn }) => [fn.countAll().as("count")])
      .where("created_at", "<", cutoff)
      .executeTakeFirstOrThrow();
    console.log(`[messages:sweep] would delete ${Number(count)} row(s) older than ${RETENTION_DAYS} days.`);
    return;
  }
  const removed = await sweepOldMessages();
  console.log(`[messages:sweep] deleted ${removed} row(s) older than ${RETENTION_DAYS} days.`);
}

await main();

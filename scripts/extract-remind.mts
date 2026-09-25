/**
 * The nightly camera-roll-import expiry sweep — B1751, task 0.5.
 *
 *   npm run extract:remind
 *   npm run extract:remind -- --dry-run
 *
 * Every staged import run gets one warning 24 hours after it started, and —
 * for a run that was continued after that warning — one final notice before
 * it actually goes. All the judgement (when to warn, when to pin, when an
 * extension has already been spent) lives in `lib/staging/expiry.ts`; this is
 * only the door onto it and the message printed either side, the same split
 * `scripts/reminders.mts` keeps with `lib/digest/reminder.ts`.
 *
 * `--dry-run` sends nothing and stamps nothing, and prints exactly which runs
 * would have been told — the same contract `reminders:send` and
 * `rates-refresh.mts --dry-run` keep: running it again afterwards, dry or
 * not, behaves as though the dry run had never happened.
 *
 * Run nightly by `scripts/backup.sh`, right beside the evening reminder sweep
 * — the one thing on the box that already runs every night and already
 * reports its own failures.
 *
 * Run through `tsx --conditions=react-server` (see package.json), for the
 * same reason `scripts/reminders.mts` is: the modules it reaches are
 * `server-only`.
 */
import { sweepExpiryWarnings } from "../lib/staging/expiry";

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const result = await sweepExpiryWarnings(new Date(), { dryRun });

  for (const runId of result.warned) {
    console.log(`${dryRun ? "[would warn]" : "[warned]"} run ${runId}`);
  }
  for (const runId of result.finalNotices) {
    console.log(`${dryRun ? "[would send final notice]" : "[final notice]"} run ${runId}`);
  }

  console.log(
    `${dryRun ? "would warn" : "warned"} ${result.warned.length} run(s); `
      + `${dryRun ? "would send" : "sent"} ${result.finalNotices.length} final notice(s).`,
  );
}

await main();

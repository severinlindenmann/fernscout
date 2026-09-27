/**
 * The nightly first-trip nudge sweep — B2447 (W44 D5).
 *
 *   npm run first-trip:send
 *   npm run first-trip:send -- --dry-run
 *
 * For every journal that opted into getting-started tips at signup and has
 * not yet added a trip: a push at day 2 (see `ownerPushSubscription`'s own
 * comment in lib/digest/firstTrip.ts for why that branch never fires today),
 * otherwise a mail at day 3, and a mail at day 5 after a push. Sent at most
 * once per account, ever.
 *
 * `--dry-run` sends nothing and records nothing, the same contract
 * `reminders.mts --dry-run` and `notify.mts --dry-run` keep. Run nightly by
 * `scripts/backup.sh`, next to the evening reminder sweep.
 *
 * Run through `tsx --conditions=react-server` (see package.json), the same
 * reason `scripts/reminders.mts` is: the modules it reaches are
 * `server-only`.
 */
import { sweepFirstTrip } from "../lib/digest/firstTrip";

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const result = await sweepFirstTrip({ dryRun });

  for (const [username, action] of result.acted) {
    console.log(`${dryRun ? "[would nudge]" : "[nudged]"} ${username} via ${action}`);
  }

  const acted = dryRun ? result.acted.length : result.pushed + result.mailed;
  console.log(
    `${result.checked} journal(s) checked; ${dryRun ? "would send" : "sent"} ${acted} nudge(s).`,
  );
}

await main();

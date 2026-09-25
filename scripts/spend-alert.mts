/**
 * The nightly metered-spend check.
 *
 *   npm run spend:alert
 *   npm run spend:alert -- --dry-run
 *
 * Mails the instance operator when yesterday's metered spend went over
 * `costs.alertDailyRappen`. `--dry-run` sends nothing and prints what would
 * have gone, the contract `reminders.mts --dry-run` keeps.
 *
 * Run nightly by `scripts/backup.sh`, beside the reminder sweep. All the
 * judgement lives in `lib/spendAlert.ts`; this is the door onto it. The
 * operator's address is not printed: this line ends up in the backup log.
 *
 * Run through `tsx --conditions=react-server` (see package.json), because the
 * modules it reaches are `server-only`.
 */
import { formatChf } from "../lib/creditsFormat";
import { checkSpendAlert } from "../lib/spendAlert";

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const result = await checkSpendAlert({ dryRun });
  if (result.sent) {
    console.log(
      `${result.dryRun ? "[would mail]" : "[mailed]"} the operator: ${formatChf(result.rappen)} metered on ${result.date}.`,
    );
  } else {
    console.log(`No spend alert: ${result.reason}.`);
  }
}

await main();

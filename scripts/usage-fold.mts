/**
 * The nightly usage-retention fold — B2605.
 *
 *   npm run usage:fold
 *
 * Folds every `usage` row older than `USAGE_RETENTION_MONTHS` into
 * `usage_monthly_totals` (one row per owner/month/provider) and deletes the
 * rows it folded. All the judgement lives in `lib/usage.ts`'s
 * `foldUsageOlderThan`; this is the door onto it, the same shape
 * `spend-alert.mts` already takes.
 *
 * Run nightly by `scripts/backup.sh`, beside the spend alert. Never fatal:
 * a dropped fold leaves rows at full grain for one more night, which is
 * recoverable, not a reason to fail the backup it rides along with.
 *
 * Run through `tsx --conditions=react-server` (see package.json), because
 * `lib/usage.ts` is `server-only`.
 */
import { foldUsageOlderThan, USAGE_RETENTION_MONTHS } from "../lib/usage";

async function main(): Promise<void> {
  const cutoff = new Date();
  cutoff.setUTCMonth(cutoff.getUTCMonth() - USAGE_RETENTION_MONTHS);
  const result = await foldUsageOlderThan(cutoff.toISOString());
  console.log(
    `usage fold: ${result.groups} owner/month/provider group(s) folded, ${result.deletedRows} row(s) deleted (cutoff ${cutoff.toISOString().slice(0, 10)}).`,
  );
}

await main();

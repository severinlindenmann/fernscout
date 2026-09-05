/**
 * What is on this instance, in one screen.
 *
 *   npm run status                    # print it
 *   npm run status -- --json          # the same numbers, machine-readable
 *
 * A thin CLI over `lib/statusReport.ts`, which is where the counting and the
 * rendering live — `scripts/alert.mts` mails the same report and needs the
 * data rather than this output (B475).
 */
import { collectStatus, statusText } from "../lib/statusReport";

const report = await collectStatus();
console.log(process.argv.includes("--json") ? JSON.stringify(report, null, 2) : statusText(report));

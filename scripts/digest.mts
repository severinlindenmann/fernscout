/**
 * The email digest — "3 new days since you last looked", to everyone who asked.
 *
 *   npm run digest -- --user severin --dry-run
 *   npm run digest -- --user severin
 *   npm run digest -- --user severin --since 2026-08-01
 *   npm run digest -- --user severin --force      # ignore the quiet rules
 *
 * This is the primary notification channel (decision 6), so it is built to be
 * run unattended from cron and to survive being run twice:
 *
 * - **`--dry-run` writes nothing at all** — no rows, no mail, no watermark
 *   moved — and prints exactly what a real run would send. It is the same code
 *   path, stopped one step short, rather than a simulation of it.
 * - **A second run sends nothing.** Every mail records how far it read, so the
 *   next run finds nothing new for the people who already have it. That is what
 *   makes "the cron job fired twice" a non-event rather than an apology.
 * - **Quiet rules apply** (D8): at most one digest a day per reader, and never
 *   in their night. `--force` overrides both, for the "we are home, send the
 *   last one now" case.
 *
 * Run through `npm run digest`, not `tsx scripts/digest.mts` directly: several
 * lib/ modules this pulls in import `server-only`, which throws unless the
 * `react-server` export condition is active — supplied here by the npm script's
 * `--conditions=react-server` flag.
 */
import { closeDatabase } from "../lib/db";
import { runDigest, type DigestOutcome } from "../lib/digest";
import { getUsernames } from "../lib/users";

type Args = {
  user?: string;
  since?: string;
  dryRun: boolean;
  force: boolean;
  now?: string;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    switch (token) {
      case "--user":
        args.user = argv[++i];
        break;
      case "--since":
        args.since = argv[++i];
        break;
      case "--now":
        // Undocumented on purpose: it exists so the quiet rules can be
        // exercised by hand ("what would happen at 03:00?") without changing
        // the machine's clock.
        args.now = argv[++i];
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--force":
        args.force = true;
        break;
      default:
        if (!token.startsWith("--") && !args.user) args.user = token;
    }
  }
  return args;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function report(outcome: DigestOutcome, dryRun: boolean): void {
  const { plan } = outcome;
  const verb = dryRun ? "would go to" : "went to";

  console.log(
    `\n${plan.ready.length} digest(s) ${verb} ${plan.ready.length === 1 ? "1 reader" : `${plan.ready.length} readers`}` +
      ` — ${plan.owner}, ${plan.now.toISOString()}\n`,
  );

  for (const recipient of plan.ready) {
    const trips = recipient.content.trips
      .map((trip) => `${trip.tripId}:${trip.newDays}`)
      .join(", ");
    console.log(
      `  ${recipient.email}  [${recipient.locale}] ${recipient.content.dayCount} new day(s) ` +
        `since ${recipient.since}  (${trips})`,
    );
  }

  if (plan.skipped.length > 0) {
    console.log(`\nNot written to (${plan.skipped.length}):\n`);
    for (const skip of plan.skipped) {
      console.log(`  ${skip.email}  ${skip.reason}${skip.detail ? ` — ${skip.detail}` : ""}`);
    }
  }

  if (!dryRun) {
    console.log("");
    for (const one of outcome.sent) {
      console.log(`  sent  ${one.email}  "${one.subject}"  -> ${one.reference ?? "(no reference)"}`);
    }
    for (const one of outcome.failed) {
      console.error(`  FAILED  ${one.email}  ${one.error}`);
    }
  }

  console.log(
    dryRun
      ? "\nDry run: nothing was sent and nothing was recorded. Re-run without --dry-run to send.\n"
      : `\n${outcome.sent.length} sent, ${outcome.failed.length} failed.\n`,
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.user) {
    console.error(
      "Usage: npm run digest -- --user <username> [--dry-run] [--since YYYY-MM-DD] [--force]",
    );
    const known = getUsernames();
    if (known.length > 0) console.error(`Known users: ${known.join(", ")}`);
    process.exit(1);
  }

  if (!getUsernames().includes(args.user)) {
    fail(`No such user: "${args.user}". Known users: ${getUsernames().join(", ") || "(none)"}`);
  }

  let now: Date | undefined;
  if (args.now) {
    now = new Date(args.now);
    if (Number.isNaN(now.getTime())) fail(`--now is not a date: "${args.now}"`);
  }

  try {
    const outcome = await runDigest(args.user, {
      dryRun: args.dryRun,
      since: args.since,
      force: args.force,
      now,
    });
    report(outcome, args.dryRun);
    if (outcome.failed.length > 0) process.exitCode = 1;
  } catch (err) {
    console.error(`\n${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  } finally {
    // The open SQLite handle is the only thing holding the event loop.
    await closeDatabase();
  }
}

main();

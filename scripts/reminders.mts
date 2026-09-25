/**
 * The nightly evening-reminder sweep — B1219, D46, and B673 with a decision
 * finally made.
 *
 *   npm run reminders:send
 *   npm run reminders:send -- --dry-run
 *
 * For every journal on this instance, every trip that opted in
 * ("erinnere mich abends", through `set_reminder` in the room) is checked
 * against tonight: is it actually running, and has today gone by with
 * nothing written for it yet. At most one nudge per journal, whichever trip
 * qualified first, ever — a second trip going quiet on the same night does
 * not mean a second mail.
 *
 * `--dry-run` sends nothing and marks nothing as nudged, and prints exactly
 * who would have been told, the same contract `notify.mts --dry-run` and
 * `rates-refresh.mts --dry-run` keep: running it again afterwards, dry or
 * not, behaves as though the dry run had never happened.
 *
 * Run nightly by `scripts/backup.sh`, beside the currency refresh — the one
 * thing on the box that already runs every night and already reports its own
 * failures. All the judgement — whose trip is due, what a journal has
 * already been sent tonight — lives in `lib/digest/reminder.ts`; this is only
 * the door onto it and the message printed either side.
 *
 * Run through `tsx --conditions=react-server` (see package.json), for the
 * same reason `scripts/notify.mts` is: the modules it reaches are
 * `server-only`.
 */
import { sweepReminders } from "../lib/digest/reminder";

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const result = await sweepReminders({ dryRun });

  for (const [username, ref, channel] of result.notified) {
    console.log(`${dryRun ? "[would nudge]" : "[nudged]"} ${username} about ${ref} via ${channel}`);
  }

  const acted = dryRun ? result.notified.length : result.sent;
  console.log(
    `${result.checked} trip(s) due tonight; ${dryRun ? "would send" : "sent"} ${acted} reminder(s).`,
  );
}

await main();

/**
 * Fills in a trip's `rates:` table for every currency its costs use that it
 * does not already cover.
 *
 *   npm run rates:fill
 *   npm run rates:fill -- --user ana
 *   npm run rates:fill -- --dry-run
 *
 * The same shape as `npm run weather:update` (B325) — a *sweep*, never a
 * build step. The costs page reads whatever is in `trip.md` and must succeed
 * with no network at all.
 *
 * Why it exists at all, given the write routes already fill a trip's rates
 * after every day written or edited: a currency can arrive on a day the
 * archive's 90-day window has since moved past, or on content synced in from
 * offline and written straight to disk. This is what comes back for those.
 * Idempotent by construction, because `fillTripRates` refuses a currency that
 * already has a rate. Safe on a timer.
 *
 * Run through `tsx --conditions=react-server` (see package.json), for the
 * same reason `npm run weather:update` is: the modules it reaches are
 * `server-only`.
 */
import { fillTripRates, type RateFillOutcome } from "../lib/api/tripRates";
import { isEnabled } from "../lib/capabilities";
import { getTrips, tripRef } from "../lib/trips";
import { getUsernames } from "../lib/users";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const onlyUser = args[args.indexOf("--user") + 1];
const wanted = args.includes("--user") && onlyUser && !onlyUser.startsWith("--") ? onlyUser : null;

const tally: Partial<Record<RateFillOutcome, number>> = {};

for (const username of getUsernames()) {
  if (wanted && username !== wanted) continue;

  // Said out loud rather than skipped in silence, the same reason
  // weather:update does: "it did nothing" and "it is switched off for this
  // journal" are two different answers somebody running this needs to tell
  // apart.
  if (!isEnabled("costs", username)) {
    console.log(`${username}: the costs capability is off — nothing fetched, nothing written.`);
    continue;
  }

  for (const trip of getTrips(username)) {
    const ref = tripRef(username, trip.id);
    const outcomes = await fillTripRates(ref, { dryRun });
    for (const [code, outcome] of Object.entries(outcomes)) {
      tally[outcome] = (tally[outcome] ?? 0) + 1;
      if (outcome === "filled" || outcome === "would_fetch") {
        console.log(`${outcome === "filled" ? "filled     " : "would fetch"}  ${ref}  ${code}`);
      }
    }
  }
}

const summary = Object.entries(tally)
  .map(([outcome, n]) => `${outcome} ${n}`)
  .join(", ");
console.log(summary ? `\n${summary}` : "\nnothing to do.");

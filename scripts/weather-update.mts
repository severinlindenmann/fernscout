/**
 * Fills in the weather for every day that asked for it and has none yet.
 *
 *   npm run weather:update
 *   npm run weather:update -- --user ana
 *   npm run weather:update -- --dry-run
 *
 * The same shape as `scripts/update-rates.mjs`: a *refresh*, never a build
 * step. The build reads whatever is in the day's frontmatter and must succeed
 * with no network at all.
 *
 * Why it exists at all, given the write routes already look a day up: the
 * archive is reanalysis and lags real time, and a day can be written offline,
 * on a bus, into a folder that syncs later. A day that got nothing on the way
 * in is not a failure — it is "not yet" — and this is what comes back for it.
 * Idempotent by construction, because `fillDayWeather` refuses a day that
 * already carries a reading. Safe on a timer.
 *
 * Run through `tsx --conditions=react-server` (see package.json), for the same
 * reason `npm run photobook` is: the modules it reaches are `server-only`.
 */
import { fillDayWeather, type FillOutcome } from "../lib/api/weather";
import { getAllEntries } from "../lib/entries";
import { isEnabled } from "../lib/capabilities";
import { getTrips, tripRef } from "../lib/trips";
import { getUsernames } from "../lib/users";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const onlyUser = args[args.indexOf("--user") + 1];
const wanted = args.includes("--user") && onlyUser && !onlyUser.startsWith("--") ? onlyUser : null;

const tally: Partial<Record<FillOutcome, number>> = {};

for (const username of getUsernames()) {
  if (wanted && username !== wanted) continue;

  // Said out loud rather than skipped in silence: "it did nothing" and "it is
  // switched off for this journal" are the two answers somebody running this
  // needs to be able to tell apart.
  if (!isEnabled("weather", username)) {
    console.log(`${username}: the weather capability is off — nothing fetched, nothing written.`);
    continue;
  }

  for (const trip of getTrips(username)) {
    const ref = tripRef(username, trip.id);
    // Drafts included. A day waiting for a person to read it back is exactly
    // the day whose weather should already be there when they do.
    for (const entry of getAllEntries(ref, { includeDrafts: true })) {
      const outcome = await fillDayWeather(ref, entry.slug, { dryRun });
      tally[outcome] = (tally[outcome] ?? 0) + 1;
      if (outcome === "filled" || outcome === "would_fetch") {
        console.log(`${outcome === "filled" ? "filled     " : "would fetch"}  ${ref}/${entry.slug}  ${entry.date}`);
      }
    }
  }
}

const summary = Object.entries(tally)
  .map(([outcome, n]) => `${outcome} ${n}`)
  .join(", ");
console.log(summary ? `\n${summary}` : "\nnothing to do.");

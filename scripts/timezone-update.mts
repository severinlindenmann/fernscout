/**
 * Fills in the zone for every day that has coordinates and none yet.
 *
 *   npm run timezone:update
 *   npm run timezone:update -- --user ana
 *   npm run timezone:update -- --dry-run
 *
 * The same shape as `scripts/weather-update.mts` — a *refresh*, never a build
 * step, run on a timer or by hand. Why it exists at all: B42 gave an entry a
 * `timezone:` field and taught the feed and the day page to read it, but no
 * day written before B1090 carries one. The write routes now resolve it going
 * forward (`lib/api/entries.ts`); this is what catches up every day that
 * already existed. Idempotent by construction — `fillDayTimezone` refuses a
 * day that already names a zone.
 *
 * Run through `tsx --conditions=react-server`, same reason `weather:update`
 * is: the modules it reaches are `server-only`.
 */
import { fillDayTimezone, type TimezoneFillOutcome } from "../lib/api/timezoneBackfill";
import { getAllEntries } from "../lib/entries";
import { getTrips, tripRef } from "../lib/trips";
import { getUsernames } from "../lib/users";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const onlyUser = args[args.indexOf("--user") + 1];
const wanted = args.includes("--user") && onlyUser && !onlyUser.startsWith("--") ? onlyUser : null;

const tally: Partial<Record<TimezoneFillOutcome, number>> = {};

for (const username of getUsernames()) {
  if (wanted && username !== wanted) continue;

  for (const trip of getTrips(username)) {
    const ref = tripRef(username, trip.id);
    // Drafts included, same reasoning as weather: a day waiting to be read
    // back is exactly the day whose zone should already be there.
    for (const entry of getAllEntries(ref, { includeDrafts: true })) {
      const outcome = fillDayTimezone(ref, entry.slug, { dryRun });
      tally[outcome] = (tally[outcome] ?? 0) + 1;
      if (outcome === "filled" || outcome === "would_fill") {
        console.log(`${outcome === "filled" ? "filled     " : "would fill "}  ${ref}/${entry.slug}  ${entry.date}`);
      }
      if (outcome === "unresolvable") {
        console.log(`unresolvable  ${ref}/${entry.slug}  ${entry.date} — coordinates matched no zone`);
      }
    }
  }
}

const summary = Object.entries(tally)
  .map(([outcome, n]) => `${outcome} ${n}`)
  .join(", ");
console.log(summary ? `\n${summary}` : "\nnothing to do.");

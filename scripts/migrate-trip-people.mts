/**
 * B2297 — nobody loses write access when `people:` stops granting it.
 *
 * Before this ticket, everyone listed in a trip's `people:` block could
 * write to that trip, with no owner approval anywhere in it — a second,
 * unapproved door beside a buddy granted at `/<user>/studio/readers`
 * (B2295, one door for readers, B2291). Once `lib/tripPeople.ts` stops
 * reading `people:` for write access, every one of those names loses the
 * ability to write unless something turns them into a real, granted
 * `trip_people` place first. This is that something.
 *
 * For every journal and every trip, every non-owner `people:` entry becomes:
 *   - a contact, confirmed and approved (`grantContactAccess` — the same
 *     three steps Studio › Readers' own "add a person" does: request,
 *     owner-confirm, approve), and
 *   - a granted `trip_people` place on that trip (`claimTripPlace` then
 *     `approveTripPlaces`), the same shape a redeemed buddy link ends in
 *     once the owner says yes.
 *
 * Idempotent: run it twice and the second run changes nothing. Every step it
 * calls already is (`requestContact` merges into an existing row rather than
 * duplicating it; `confirmContactByOwner` only ever touches a row with no
 * `confirmed_at` yet; `claimTripPlace`'s unique index is `(owner, trip,
 * contact)` and never demotes a place that is already granted;
 * `approveTripPlaces` returns nothing for a place already approved). An
 * address the owner had already blocked is left alone and named in the
 * summary, never force-granted.
 *
 *   npx tsx --conditions=react-server scripts/migrate-trip-people.mts
 *   npx tsx --conditions=react-server scripts/migrate-trip-people.mts --dry-run
 *   npx tsx --conditions=react-server scripts/migrate-trip-people.mts --user alex
 *
 * `--dry-run` reports what it would grant without writing anything.
 * `--user` limits the run to one journal, for trying it on a single account
 * or a temp `CONTENT_DIR` first.
 */
import { getUsernames, getUser } from "../lib/users";
import { getTrips } from "../lib/trips";
import { grantContactAccess } from "../lib/contacts";
import { claimTripPlace, approveTripPlaces } from "../lib/tripPeople";
import { getDatabase } from "../lib/db";
import { migrateToLatest } from "../lib/db/migrate";
import { pickLocale } from "../lib/contacts/locale";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const userIdx = args.indexOf("--user");
const onlyUser = userIdx >= 0 ? args[userIdx + 1] : undefined;

type Outcome = "granted" | "already-granted" | "skipped-blocked" | "skipped-owner";

async function run(): Promise<void> {
  await migrateToLatest(await getDatabase());

  const usernames = onlyUser ? [onlyUser] : getUsernames();
  const counts: Record<Outcome, number> = {
    granted: 0,
    "already-granted": 0,
    "skipped-blocked": 0,
    "skipped-owner": 0,
  };
  const blocked: string[] = [];

  for (const username of usernames) {
    const journal = getUser(username);
    if (!journal) continue;
    const ownerEmail = journal.owner.email?.trim().toLowerCase();

    for (const trip of getTrips(username)) {
      // One contact request per unique address, even when the same person
      // is named on several trips — `grantContactAccess` once, then a
      // `trip_people` place per trip that named them.
      const byEmail = new Map<string, { name: string }>();
      for (const person of trip.people) {
        const email = person.email.trim().toLowerCase();
        if (email === ownerEmail) {
          counts["skipped-owner"] += 1;
          continue;
        }
        if (!byEmail.has(email)) byEmail.set(email, { name: person.name });
      }

      for (const [email, { name }] of byEmail) {
        const label = `${username}/${trip.id}: ${name} <${email}>`;
        if (dryRun) {
          console.log(`[dry-run] would grant ${label}`);
          counts.granted += 1;
          continue;
        }

        const granted = await grantContactAccess(username, {
          name,
          email,
          locale: pickLocale(journal.defaultLocale),
        });
        if (!granted.ok) {
          counts["skipped-blocked"] += 1;
          blocked.push(label);
          continue;
        }

        await claimTripPlace(username, trip.id, granted.contact.id, null);
        const approved = await approveTripPlaces(username, granted.contact.id);
        counts[approved.includes(trip.id) ? "granted" : "already-granted"] += 1;
        console.log(`[migrate-trip-people] ${label} -> ${granted.contact.id}`);
      }
    }
  }

  console.log("");
  console.log(
    `${dryRun ? "Would grant" : "Granted"} ${counts.granted}, already granted ${counts["already-granted"]}, ` +
      `skipped ${counts["skipped-owner"]} owner entries, skipped ${counts["skipped-blocked"]} blocked address(es).`,
  );
  if (blocked.length > 0) {
    console.log("Blocked (left alone — the owner already said no to these):");
    for (const line of blocked) console.log(`  ${line}`);
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

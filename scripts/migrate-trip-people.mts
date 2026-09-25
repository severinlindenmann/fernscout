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
 * For every journal and every trip, every non-owner `people:` entry with an
 * email becomes:
 *   - a contact, confirmed and approved — the same three steps Studio ›
 *     Readers' own "add a person" does (`grantContactAccess`: request,
 *     owner-confirm, approve), except for one consent this run sets
 *     differently on purpose (see below), and
 *   - a granted `trip_people` place on that trip (`claimTripPlace` then
 *     `approveTripPlaces`), the same shape a redeemed buddy link ends in
 *     once the owner says yes.
 *
 * **`wantsEmailDigest: true`, not `grantContactAccess`'s own `false`.** Read
 * access to a closed trip and its day-update mail both used to come from a
 * bare `people:` entry (D3 closes that door too, not only write's — see
 * `lib/tripPeople.ts`'s file banner). Everyone this migration touches was
 * therefore already receiving the day-update letter before it ran; granting
 * them a place with the digest off would be this migration itself taking
 * something away, which is the one thing it exists not to do. So this script
 * calls `requestContact`/`confirmContactByOwner`/`approveContact` directly —
 * `grantContactAccess`'s own three steps, inlined — rather than the shared
 * helper, which stays `false` for its other caller
 * (`app/api/helper/[user]/reader/grant/route.ts`), an owner adding someone
 * new who never had the mail to begin with.
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
import { requestContact, confirmContactByOwner, approveContact, getContactByEmail } from "../lib/contacts";
import { claimTripPlace, approveTripPlaces } from "../lib/tripPeople";
import { getDatabase } from "../lib/db";
import { migrateToLatest } from "../lib/db/migrate";
import { pickLocale } from "../lib/contacts/locale";

/**
 * `grantContactAccess`'s own three steps, inlined so a *brand-new* contact
 * can start with `wantsEmailDigest: true` instead of the shared helper's own
 * `false` — see the file banner for why. An address that already has a
 * contact row here (an earlier run, or any other door) keeps whatever it
 * already carries: `requestContact` writes this consent unconditionally on
 * every call, so re-running this script must read the existing value back
 * rather than a second run quietly re-enabling a digest the owner has since
 * turned off for that person.
 */
async function grantWithDigestOn(
  owner: string,
  input: { name: string; email: string; locale: ReturnType<typeof pickLocale> },
): Promise<{ ok: true; contactId: string } | { ok: false }> {
  const existing = await getContactByEmail(owner, input.email);
  const result = await requestContact(owner, {
    name: input.name,
    email: input.email,
    locale: input.locale,
    wantsEmailDigest: existing ? existing.wantsEmailDigest : true,
    wantsPostcard: existing ? existing.wantsPostcard : false,
    wantsWhatsapp: existing ? existing.wantsWhatsapp : false,
    createdVia: "owner-grant",
  });
  if (result.outcome === "ignored" || !result.contactId) return { ok: false };
  await confirmContactByOwner(owner, result.contactId);
  const approved = await approveContact(owner, result.contactId);
  if (!approved) return { ok: false };
  return { ok: true, contactId: approved.contact.id };
}

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

        const granted = await grantWithDigestOn(username, {
          name,
          email,
          locale: pickLocale(journal.defaultLocale),
        });
        if (!granted.ok) {
          counts["skipped-blocked"] += 1;
          blocked.push(label);
          continue;
        }

        await claimTripPlace(username, trip.id, granted.contactId, null);
        const approved = await approveTripPlaces(username, granted.contactId);
        counts[approved.includes(trip.id) ? "granted" : "already-granted"] += 1;
        console.log(`[migrate-trip-people] ${label} -> ${granted.contactId}`);
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

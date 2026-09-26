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
 * **The rule this script holds itself to: exactly the access a `people:`
 * entry had before, nothing more.** A bare `people:` entry gave read+write
 * on *that one trip*, never the journal's `guest` trips (`isJournalGuest`
 * needs an `access_grants` row, which nothing about `people:` ever wrote)
 * and never day-update mail (`recipientsFor` in `lib/digest/dayLetter.ts`
 * only ever mails an *existing, active* contact — a bare `people:` name with
 * no contacts row was never in that loop at all). A first pass at this
 * script got both of those wrong (security review, D3/B2297's F1–F4); this
 * is the corrected version.
 *
 * For every journal and every trip, every non-owner `people:` entry with a
 * valid email becomes:
 *   - a contact, confirmed and activated (`requestContact`, then
 *     `confirmContactByOwner`, then `activateContactStatus` — **not**
 *     `approveContact`, which always writes the journal-wide `access_grants`
 *     row this migration must not add), and
 *   - a granted `trip_people` place on *that one trip*
 *     (`claimTripPlace` then `approveTripPlaces(..., trip.id)`, scoped with
 *     the same `onlyTrip` B2292 added — never the contact's other, unrelated
 *     places, pending or revoked, on a different trip).
 *
 * **A brand-new contact gets `wantsEmailDigest: false`.** A bare `people:`
 * entry never mailed anyone (see above), so a contact this migration creates
 * from scratch starts with the same silence, not a new subscription nobody
 * asked for. An address that already has a contact row here — an earlier
 * run, or any other door — keeps whatever consent it already carries;
 * `requestContact` writes every consent unconditionally on its update
 * branch, so re-running this script reads the existing value back rather
 * than overwriting a preference the owner has since changed. The same
 * applies to `locale`: a fresh contact gets the journal's default, an
 * existing one keeps its own.
 *
 * **A contact the owner has blocked is never touched.** `requestContact`
 * already refuses to write anything for a `blocked` row (`outcome:
 * "ignored"`), so this script's only job is to report it rather than force
 * it — the blocked address is named in the summary and nothing about it
 * changes. There is no separate "deleted" case to guard here: a deleted
 * contact's row is gone (`deleteContact`/`deleteContactSelf` hard-delete
 * it), so "an address that deleted itself" is indistinguishable from "never
 * had a row" by the time this script runs, and both are handled the same
 * way — a fresh contact, exactly as if nobody had ever asked before.
 *
 * Idempotent: run it twice and the second run changes nothing beyond what
 * the first one already granted. Every step it calls already is
 * (`requestContact` merges into an existing row rather than duplicating it;
 * `confirmContactByOwner` only ever touches a row with no `confirmed_at`
 * yet; `activateContactStatus` is a no-op on an already-`active` row;
 * `claimTripPlace`'s unique index is `(owner, trip, contact)` and never
 * demotes a place that is already granted; `approveTripPlaces` returns
 * nothing for a place already approved).
 *
 *   npx tsx --conditions=react-server scripts/migrate-trip-people.mts
 *   npx tsx --conditions=react-server scripts/migrate-trip-people.mts --dry-run
 *   npx tsx --conditions=react-server scripts/migrate-trip-people.mts --user alex
 *
 * `--dry-run` reports what it would grant without writing anything — and,
 * since it still has to know what it *would* do, it reads the existing
 * contact row (if any) first, so a blocked address is reported as blocked
 * here too, never miscounted as a grant that dry-run never actually checked.
 * `--user` limits the run to one journal, for trying it on a single account
 * or a temp `CONTENT_DIR` first.
 */
import { isEmail } from "../lib/auth";
import { getUsernames, getUser } from "../lib/users";
import { getTrips } from "../lib/trips";
import {
  requestContact,
  confirmContactByOwner,
  activateContactStatus,
  getContactByEmail,
} from "../lib/contacts";
import { claimTripPlace, approveTripPlaces, isPersonOn } from "../lib/tripPeople";
import { getDatabase } from "../lib/db";
import { migrateToLatest } from "../lib/db/migrate";
import { pickLocale } from "../lib/contacts/locale";

/**
 * `requestContact` → `confirmContactByOwner` → `activateContactStatus` — the
 * three steps that put a real, active contact behind a trip place, without
 * ever writing the journal-wide read grant `approveContact` always would.
 * See the file banner for why a brand-new contact starts with
 * `wantsEmailDigest: false` and why an existing one's own locale/consents are
 * read back rather than overwritten.
 */
async function activateForTripOnly(
  owner: string,
  input: { name: string; email: string; defaultLocale: ReturnType<typeof pickLocale> },
): Promise<{ ok: true; contactId: string } | { ok: false }> {
  const existing = await getContactByEmail(owner, input.email);
  const result = await requestContact(owner, {
    name: input.name,
    email: input.email,
    locale: existing?.locale ?? input.defaultLocale,
    wantsEmailDigest: existing ? existing.wantsEmailDigest : false,
    wantsPostcard: existing ? existing.wantsPostcard : false,
    wantsWhatsapp: existing ? existing.wantsWhatsapp : false,
    createdVia: "owner-grant",
  });
  if (result.outcome === "ignored" || !result.contactId) return { ok: false };
  await confirmContactByOwner(owner, result.contactId);
  const activated = await activateContactStatus(owner, result.contactId);
  if (!activated) return { ok: false };
  return { ok: true, contactId: activated.id };
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const userIdx = args.indexOf("--user");
const onlyUser = userIdx >= 0 ? args[userIdx + 1] : undefined;

type Outcome = "granted" | "already-granted" | "skipped-blocked" | "skipped-owner" | "skipped-invalid";

async function run(): Promise<void> {
  await migrateToLatest(await getDatabase());

  const usernames = onlyUser ? [onlyUser] : getUsernames();
  const counts: Record<Outcome, number> = {
    granted: 0,
    "already-granted": 0,
    "skipped-blocked": 0,
    "skipped-owner": 0,
    "skipped-invalid": 0,
  };
  const blocked: string[] = [];
  const invalid: string[] = [];

  for (const username of usernames) {
    const journal = getUser(username);
    if (!journal) continue;
    const ownerEmail = journal.owner.email?.trim().toLowerCase();

    for (const trip of getTrips(username)) {
      // One contact request per unique address, even when the same person
      // is named on several trips — the contact once, then a `trip_people`
      // place per trip that named them, each scoped to that trip alone.
      const byEmail = new Map<string, { name: string }>();
      for (const person of trip.people) {
        const email = person.email.trim().toLowerCase();
        if (email === ownerEmail) {
          counts["skipped-owner"] += 1;
          continue;
        }
        if (!isEmail(email)) {
          counts["skipped-invalid"] += 1;
          invalid.push(`${username}/${trip.id}: ${person.name} <${person.email}>`);
          continue;
        }
        if (!byEmail.has(email)) byEmail.set(email, { name: person.name });
      }

      for (const [email, { name }] of byEmail) {
        const label = `${username}/${trip.id}: ${name} <${email}>`;

        if (dryRun) {
          // Still has to know what it would do: a blocked address is
          // reported as blocked, never counted as a grant dry-run never
          // actually checked (F4).
          const existing = await getContactByEmail(username, email);
          if (existing?.status === "blocked") {
            counts["skipped-blocked"] += 1;
            blocked.push(label);
            continue;
          }
          // B2368 — a place a real run (or any other door) already granted
          // is not a fresh grant dry-run would make; without this check
          // every dry run reported "already granted 0" regardless of what
          // had already happened.
          if (await isPersonOn(trip, email)) {
            counts["already-granted"] += 1;
            continue;
          }
          console.log(`[dry-run] would grant ${label}`);
          counts.granted += 1;
          continue;
        }

        const activated = await activateForTripOnly(username, {
          name,
          email,
          defaultLocale: pickLocale(journal.defaultLocale),
        });
        if (!activated.ok) {
          counts["skipped-blocked"] += 1;
          blocked.push(label);
          continue;
        }

        await claimTripPlace(username, trip.id, activated.contactId, null);
        const approved = await approveTripPlaces(username, activated.contactId, trip.id);
        counts[approved.includes(trip.id) ? "granted" : "already-granted"] += 1;
        console.log(`[migrate-trip-people] ${label} -> ${activated.contactId}`);
      }
    }
  }

  console.log("");
  console.log(
    `${dryRun ? "Would grant" : "Granted"} ${counts.granted}, already granted ${counts["already-granted"]}, ` +
      `skipped ${counts["skipped-owner"]} owner entries, skipped ${counts["skipped-invalid"]} invalid address(es), ` +
      `skipped ${counts["skipped-blocked"]} blocked address(es).`,
  );
  if (invalid.length > 0) {
    console.log("Invalid (the whole trip.json parser would already have refused these — flagged, not written):");
    for (const line of invalid) console.log(`  ${line}`);
  }
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

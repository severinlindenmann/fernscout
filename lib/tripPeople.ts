import "server-only";
import { getDatabaseOrNull, newId, nowIso } from "./db";
import { grantIsLive } from "./grants";
import type { Trip } from "./types";
import { getUser } from "./users";

/**
 * Who may write to a trip.
 *
 * The journal's owner always may — they own the folder, and a trip that names
 * nobody is theirs alone. Beyond that, anyone in the trip's `people:` block
 * may write to **the whole trip**, not only to the days they wrote. Two people
 * on one bus are not two authors with separate columns; splitting a shared day
 * between them is a distinction nobody was making at the time.
 *
 * Scoped to one trip, deliberately. Being on somebody's Vietnam trip is not a
 * reason to be able to rewrite their honeymoon.
 *
 * ## Two sources, and why (B33)
 *
 * The list used to be one thing: the file on disk. It is now the file **plus**
 * the rows in `trip_people` — somebody who redeemed a buddy link and whom the
 * owner then approved. That split has a real cost, and it was argued rather
 * than assumed: `trip.md` stops being the whole answer to "who was on this",
 * and anybody reading the frontmatter alone now has a partial one.
 *
 * It loses to two things a file cannot do. A stranger following a link must
 * not cause a file the owner owns to be rewritten. And a row can be revoked,
 * expired and listed, which is the entire reason for leaving a shared password
 * behind — cutting one person off without cutting off everyone.
 *
 * The merge is **additive and in that order**: the file is read first and is
 * never contradicted, so a hand-written `people:` entry behaves exactly as it
 * did before any of this existed, and a database that is missing, empty or
 * switched off changes nothing about it.
 *
 * What a redeemed place does *not* do is put somebody in the byline.
 * `travellersOf` (`lib/site.ts`) still reads the file alone: credit for a trip
 * is the owner's editorial statement about whose trip it was, made by typing a
 * name into their own file, and it renders on every page from disk with no
 * database in the path. Write access and credit were the same list until B33
 * and are now two, which is a divergence worth knowing about rather than one
 * to paper over.
 */

/**
 * The list as `trip.md` states it: the owner, then `people:`.
 *
 * **Not the access check.** This is the record on disk, which since B33 is
 * only part of the answer — use `isPersonOn` to decide anything. It is
 * exported for the two callers that genuinely want the file's own version: the
 * merge below, and anything reporting what the frontmatter says.
 */
export function peopleNamedIn(trip: Trip): string[] {
  const rawOwner = getUser(trip.username)?.owner.email;
  // Normalised here rather than trusted from the config parser: this is the
  // security-relevant comparison (`isPersonOn`, below), and it should not
  // depend on `parseOwner` having already lower-cased it for an unrelated
  // reason (`lib/site.ts`'s byline).
  const owner = rawOwner?.trim().toLowerCase();
  const listed = trip.people.map((p) => p.email);
  return owner ? [...new Set([owner, ...listed])] : listed;
}

/** Every address that may write to this trip, lower-cased. */
export async function peopleOf(trip: Trip): Promise<string[]> {
  const named = peopleNamedIn(trip);
  const redeemed = await redeemedPeopleOf(trip.username, trip.id);
  return [...new Set([...named, ...redeemed])];
}

/** Whether this address took this trip (or owns the journal it is in). */
export async function isPersonOn(trip: Trip, email: string | undefined | null): Promise<boolean> {
  if (!email) return false;
  const address = email.trim().toLowerCase();
  // The file first, and no query at all when it answers. The owner reading
  // their own journal is the commonest caller by a wide margin, and they are
  // always the first entry in the list above.
  if (peopleNamedIn(trip).includes(address)) return true;
  return (await redeemedPeopleOf(trip.username, trip.id)).includes(address);
}

/**
 * The addresses holding a live place on this trip.
 *
 * Three conditions, and all three are the row saying the owner meant it:
 * `granted_at` set (a row without it is a request, not access), `revoked_at`
 * null, and an expiry that has not passed — `grantIsLive`, the same rule
 * `access_grants` is read by, so "live" means one thing in this codebase.
 *
 * Returns nothing at all when there is no database. That is a supported way to
 * run (`lib/db`), and it degrades in the right direction: the file's own list
 * still works, and nobody is let in by an absence.
 */
export async function redeemedPeopleOf(username: string, tripId: string): Promise<string[]> {
  const handle = await getDatabaseOrNull();
  if (!handle) return [];
  const now = new Date();
  const rows = await handle.db
    .selectFrom("trip_people")
    .innerJoin("contacts", "contacts.id", "trip_people.contact_id")
    .select(["contacts.email_key as email", "trip_people.expires_at as expires_at"])
    .where("trip_people.owner_id", "=", username)
    .where("trip_people.trip_id", "=", tripId)
    .where("trip_people.granted_at", "is not", null)
    .where("trip_people.revoked_at", "is", null)
    // A blocked contact is somebody the owner showed the door. They keep their
    // row so they cannot re-request their way back in, and it must not still
    // be a way onto a trip.
    .where("contacts.status", "=", "active")
    .execute();

  return rows
    .filter((row) => grantIsLive(row.expires_at, now))
    .map((row) => row.email.trim().toLowerCase());
}

/**
 * Every trip in this journal this address holds a live place on.
 *
 * One query for a whole page, rather than `isPersonOn` per trip. `resolveViewer`
 * and `listableTrips` both render a list of every trip in a journal, and both
 * are on the path of an ordinary page view.
 */
export async function redeemedTripsFor(
  username: string,
  email: string | undefined | null,
): Promise<Set<string>> {
  if (!email) return new Set();
  const handle = await getDatabaseOrNull();
  if (!handle) return new Set();
  const now = new Date();
  const rows = await handle.db
    .selectFrom("trip_people")
    .innerJoin("contacts", "contacts.id", "trip_people.contact_id")
    .select(["trip_people.trip_id as trip_id", "trip_people.expires_at as expires_at"])
    .where("trip_people.owner_id", "=", username)
    .where("contacts.email_key", "=", email.trim().toLowerCase())
    .where("trip_people.granted_at", "is not", null)
    .where("trip_people.revoked_at", "is", null)
    .where("contacts.status", "=", "active")
    .execute();

  const out = new Set<string>();
  for (const row of rows) if (grantIsLive(row.expires_at, now)) out.add(row.trip_id);
  return out;
}

/**
 * The same question as `isPersonOn`, asked against an already-loaded set.
 *
 * For the two list renderers. Written here rather than inlined at both call
 * sites so that "the file, then the redeemed places" is one rule in one place
 * — the panel and the gate disagreeing about who is on a trip would be B41's
 * bug in a new spot.
 */
export function isPersonOnWith(
  trip: Trip,
  email: string | undefined | null,
  redeemed: Set<string>,
): boolean {
  if (!email) return false;
  if (peopleNamedIn(trip).includes(email.trim().toLowerCase())) return true;
  return redeemed.has(trip.id);
}

/**
 * The scope string stored on a session, and read back off it.
 *
 * A journal's owner gets the unqualified `write:content` they have always had.
 * Somebody who is only on one trip gets a scope naming it, so the same token
 * presented against another trip is refused by `scopeAllows` below rather than
 * by a check somebody has to remember to write.
 */
export function tripWriteScope(tripId: string): string {
  return `write:trip:${tripId}`;
}

export function scopeAllows(scope: string | undefined, trip: Trip): boolean {
  if (!scope) return false;
  if (scope === "write:content") return true; // the journal's owner
  return scope === tripWriteScope(trip.id);
}

/**
 * Why a write is allowed or refused — the scope **and** whether the person
 * behind it is still on the trip.
 *
 * `scopeAllows` alone is not enough, and B98 is why. The scope is a string
 * baked into the `sessions` row when the token was minted and never looked at
 * again, so revoking somebody — `revokeContact`, `deleteContact`, or a name
 * deleted from `people:` in `trip.md` by hand — stopped them reading
 * immediately and let them keep writing for the remaining seven days of the
 * token. Reads asked the database on every request; writes asked a week-old
 * string.
 *
 * The check happens **at use** rather than the revocations each remembering to
 * sweep `sessions`, because a name removed from a file by hand has nothing to
 * hang a sweep off: there is no request, no row, and no code path that runs.
 * Checking here covers that case and the database ones together.
 *
 * `out_of_scope` and `revoked` are separated so the caller can answer them
 * differently. They must be: "this is not your trip" has to be
 * indistinguishable from "no such trip" or a trip-scoped token could
 * enumerate a journal by guessing ids, while "you were removed from this trip"
 * is about the one trip the token already names and gives away nothing.
 *
 * The owner's unqualified `write:content` returns without a query. It is the
 * commonest write in the system by a wide margin, and an owner cannot revoke
 * themselves.
 */
export type TripWriteVerdict = "allowed" | "out_of_scope" | "revoked";

export async function tripWriteVerdict(
  scope: string | undefined,
  email: string | undefined | null,
  trip: Trip,
): Promise<TripWriteVerdict> {
  if (!scope) return "out_of_scope";
  if (scope === "write:content") return "allowed"; // the journal's owner
  if (scope !== tripWriteScope(trip.id)) return "out_of_scope";
  return (await isPersonOn(trip, email)) ? "allowed" : "revoked";
}

/**
 * Somebody redeemed a buddy link — B33.
 *
 * Writes a **request**, not a place: `granted_at` stays null, so nothing above
 * reads this row as access. It is the trip-shaped half of what
 * `requestContact` writes on the contacts table, and it exists for the same
 * reason — the link decides who may ask, the owner decides who gets in.
 *
 * Redeeming twice is not two rows. The unique index is `(owner, trip,
 * contact)`, and a second redemption of a place that has already been granted
 * leaves the grant alone: re-following the link in a group chat must not
 * quietly demote somebody who is already on the trip, the same rule
 * `requestContact` follows for an `active` contact.
 */
export async function claimTripPlace(
  username: string,
  tripId: string,
  contactId: string,
  inviteId: string | null,
): Promise<void> {
  const handle = await getDatabaseOrNull();
  if (!handle) return;
  const existing = await handle.db
    .selectFrom("trip_people")
    .select(["id"])
    .where("owner_id", "=", username)
    .where("trip_id", "=", tripId)
    .where("contact_id", "=", contactId)
    .executeTakeFirst();
  if (existing) return;

  await handle.db
    .insertInto("trip_people")
    .values({
      id: newId(),
      owner_id: username,
      trip_id: tripId,
      contact_id: contactId,
      invite_id: inviteId,
      requested_at: nowIso(),
      granted_at: null,
      granted_by: null,
      revoked_at: null,
      expires_at: null,
    })
    .execute();
}

/**
 * The owner waved somebody in, so every trip they asked to join opens.
 *
 * Called from `approveContact` and nowhere else, which is what keeps the
 * promise in `AGENTS.md` true: approval is the only thing that turns a request
 * into access, and there is one approval rather than two for the owner to
 * remember. Approving somebody who redeemed a buddy link therefore does both
 * things at once — lets them into the journal's `guest` trips, and puts them
 * on the trip they were invited to. That is why a buddy link is described
 * everywhere as the stronger of the two and not the one to forward.
 *
 * Returns the trips that were opened, so the caller can say so.
 */
export async function approveTripPlaces(username: string, contactId: string): Promise<string[]> {
  const handle = await getDatabaseOrNull();
  if (!handle) return [];
  const pending = await handle.db
    .selectFrom("trip_people")
    .select(["id", "trip_id"])
    .where("owner_id", "=", username)
    .where("contact_id", "=", contactId)
    .where("granted_at", "is", null)
    .where("revoked_at", "is", null)
    .execute();
  if (pending.length === 0) return [];

  await handle.db
    .updateTable("trip_people")
    .set({ granted_at: nowIso(), granted_by: username })
    .where("owner_id", "=", username)
    .where("contact_id", "=", contactId)
    .where("granted_at", "is", null)
    .where("revoked_at", "is", null)
    .execute();

  return pending.map((row) => row.trip_id);
}

/**
 * Take it back.
 *
 * Marked rather than deleted, matching `revokeContact`: the record that this
 * person was once on the trip is worth keeping, and a deleted row would let
 * them redeem the same link again into a clean slate. A place that was never
 * granted is revoked too — an outstanding request from somebody the owner has
 * just blocked should not be waiting to be approved by a later click.
 */
export async function revokeTripPlaces(username: string, contactId: string): Promise<void> {
  const handle = await getDatabaseOrNull();
  if (!handle) return;
  await handle.db
    .updateTable("trip_people")
    .set({ revoked_at: nowIso() })
    .where("owner_id", "=", username)
    .where("contact_id", "=", contactId)
    .where("revoked_at", "is", null)
    .execute();
}

/** Every trip this contact has asked to join or been let onto, granted or
 * not — for the owner deciding, and for telling somebody what they are
 * waiting on. */
export async function tripPlacesOf(
  username: string,
  contactId: string,
): Promise<{ tripId: string; grantedAt: string | null; revokedAt: string | null }[]> {
  const handle = await getDatabaseOrNull();
  if (!handle) return [];
  const rows = await handle.db
    .selectFrom("trip_people")
    .select(["trip_id", "granted_at", "revoked_at"])
    .where("owner_id", "=", username)
    .where("contact_id", "=", contactId)
    .execute();
  return rows.map((row) => ({
    tripId: row.trip_id,
    grantedAt: row.granted_at,
    revokedAt: row.revoked_at,
  }));
}

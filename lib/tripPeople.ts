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
 */

/** Every address that may write to this trip, lower-cased. */
export function peopleOf(trip: Trip): string[] {
  const owner = getUser(trip.username)?.owner.email;
  const listed = trip.people.map((p) => p.email);
  return owner ? [...new Set([owner, ...listed])] : listed;
}

/** Whether this address took this trip (or owns the journal it is in). */
export function isPersonOn(trip: Trip, email: string | undefined | null): boolean {
  if (!email) return false;
  return peopleOf(trip).includes(email.trim().toLowerCase());
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

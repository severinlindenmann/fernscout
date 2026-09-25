import { normaliseEmail } from "./index";

/** One trip's write list, already normalised — `peopleOf()`'s own answer. */
export type TripMembership = { id: string; title: string; people: string[] };

export type ContactRelationship = {
  owner: boolean;
  guest: boolean;
  buddyOf: { id: string; title: string }[];
};

/**
 * What a contact actually is to this journal — B630.
 *
 * Derived, never stored, from the same three answers the gates themselves
 * ask: `owner.email` for the owner, `peopleOf()` (passed in per trip, already
 * merged with the redeemed buddy-link rows) for a buddy, and the live
 * `access_grants` row `journalReader` checks for a guest. A person can be more
 * than one of these at once — an owner is also often a buddy of their own
 * trip's `people:` block — so nothing here picks a winner.
 */
export function relationshipsFor(
  email: string,
  ownerEmail: string | null,
  trips: TripMembership[],
  guest: boolean,
): ContactRelationship {
  const address = normaliseEmail(email);
  return {
    owner: ownerEmail !== null && address === ownerEmail,
    guest,
    buddyOf: trips
      .filter((trip) => trip.people.includes(address))
      .map((trip) => ({ id: trip.id, title: trip.title })),
  };
}

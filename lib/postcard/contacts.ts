import "server-only";
import { listContacts } from "../contacts/index.ts";
import { isPostable } from "../contacts/crypto.ts";
import type { PostalAddress } from "./render.ts";

/**
 * Recipients pulled from the contacts table rather than a hand-written file —
 * B273, filling in what `scripts/postcard.ts`'s header comment has said since
 * the pipeline was built: "Once the contacts work lands this reads from the
 * contacts table instead, and the file becomes the fallback."
 *
 * Three things a row has to clear to become an envelope:
 *
 * - `status === "active"` — the owner has actually let this person in. A
 *   `pending` request or a `blocked` address is not somebody to post to.
 * - `wantsPostcard` — the same consent the admin panel shows as "wants a
 *   postcard", set when a reader typed an address on a form that said what it
 *   was for. Having an address on file is not the same as having asked for
 *   this.
 * - `isPostable` — enough of the address to put on an envelope. A phone
 *   number alone, or a name with no street, is neither.
 *
 * The phone number never crosses into `PostalAddress`: it is not part of what
 * an envelope needs, and `lib/postcard/render.ts`'s own type has no field for
 * it.
 */
async function eligible(owner: string): Promise<{ id: string; to: PostalAddress }[]> {
  const contacts = await listContacts(owner);
  const out: { id: string; to: PostalAddress }[] = [];
  for (const contact of contacts) {
    const postal = contact.postalAddress;
    if (contact.status !== "active" || !contact.wantsPostcard || !postal || !isPostable(postal)) {
      continue;
    }
    out.push({
      id: contact.id,
      to: {
        // The name on the envelope first, falling back to the contact's own
        // name and then their address — the same order the admin panel and the
        // guest forms use for "who is this for".
        name: postal.name || contact.name || contact.email,
        line1: postal.line1,
        line2: postal.line2 || undefined,
        postcode: postal.postcode,
        city: postal.city,
        country: postal.country || undefined,
      },
    });
  }
  return out;
}

export async function postcardRecipientsFromContacts(owner: string): Promise<PostalAddress[]> {
  return (await eligible(owner)).map((row) => row.to);
}

/**
 * Somebody an order may be addressed to, as much of them as an agent gets.
 *
 * A name, a town and a country — enough to say "shall I send one to Marta in
 * Lisbon?", and not the street. B434: an agent composes the order from these
 * ids and never holds an address, so a card can only ever go to somebody who
 * asked this journal for one. There is deliberately no route that turns an id
 * back into an address; only `addressesFor` does, on the server, at render and
 * at send.
 */
export type PostcardCandidate = {
  contactId: string;
  name: string;
  city: string;
  country: string | null;
};

export async function postcardCandidates(owner: string): Promise<PostcardCandidate[]> {
  return (await eligible(owner)).map(({ id, to }) => ({
    contactId: id,
    name: to.name,
    city: to.city,
    country: to.country ?? null,
  }));
}

/**
 * Turn the ids on an order back into envelopes.
 *
 * Only ids that are *still* eligible come back, which is the point: a contact
 * who withdrew their consent, was blocked, or deleted their address between
 * the order and the Send is simply not in the map, and the send skips them
 * rather than posting to somebody who has since said no. The caller compares
 * sizes and tells the person whose journal it is.
 */
export async function addressesFor(
  owner: string,
  contactIds: string[],
): Promise<Map<string, PostalAddress>> {
  const wanted = new Set(contactIds);
  const map = new Map<string, PostalAddress>();
  for (const { id, to } of await eligible(owner)) {
    if (wanted.has(id)) map.set(id, to);
  }
  return map;
}

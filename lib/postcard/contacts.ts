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
 *
 * `requireConsent` exists for `lib/photobook/recipients.ts`, which shares
 * this same shape but not this same gate: `wantsPostcard` is consent to
 * *postcards*, and a photobook posted to yourself must not require having
 * ticked that box. Postcard call sites below never pass it, so their
 * behaviour is unchanged.
 */
export async function eligible(
  owner: string,
  requireConsent = true,
): Promise<{ id: string; email: string; to: PostalAddress; locale: string | null }[]> {
  const contacts = await listContacts(owner);
  const out: { id: string; email: string; to: PostalAddress; locale: string | null }[] = [];
  for (const contact of contacts) {
    const postal = contact.postalAddress;
    if (
      contact.status !== "active" ||
      (requireConsent && !contact.wantsPostcard) ||
      !postal ||
      !isPostable(postal)
    ) {
      continue;
    }
    out.push({
      id: contact.id,
      // Only so `lib/photobook/recipients.ts` can tell which of these rows is
      // the owner themselves — see `self` there. Never rendered: the page
      // shows a name and a town, and an address is not the only thing worth
      // keeping off it.
      email: contact.email,
      // The language this journal writes to them in. Carried through to the
      // preview page so the owner can see a card going out in a language its
      // reader does not read — B452.
      locale: contact.locale,
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
 * Why nobody, or not everybody, is on `postcardCandidates` — as counts, per
 * reason, and never a name — B1399.
 *
 * `postcardCandidates` returns an empty array whether this journal has no
 * contacts at all, or has one whose row fails `eligible()`'s gates — the
 * owner's own "add me" button, for instance, files an `active` row with
 * every consent off and no address, which is not a recipient by any of the
 * three tests but is a real row all the same. The helper cannot tell those
 * two cases apart from the empty array, so it told the owner who had just
 * pressed that button to go and add a contact.
 *
 * **A contact is fine to count here, and the quantities are fine to hand the
 * model** — the owner already knows every fact a count states back (they are
 * the one who did or did not tick "wants a postcard"); what AGENTS.md
 * protects is the address, and none of these three numbers is one. A
 * contact can fail more than one gate and is counted in each it fails, so
 * the three numbers do not have to add up to how many contacts exist.
 *
 * **Honest limit, not hidden**: with exactly one ineligible contact, a count
 * of 1 in a single bucket is arithmetically the same as naming that
 * contact's status — the identifier and the town are still withheld, so this
 * is strictly less revealing than the eligible-recipient shape above, but it
 * is unlabelled rather than anonymous, and it should not be sold as more
 * than that.
 */
export type IneligibleCounts = {
  /** Not `active` — a pending request, or a blocked address. */
  notActive: number;
  /** No postal address on file, or not enough of one to post to. */
  noAddress: number;
  /** An address is on file, but "wants a postcard" is not ticked. */
  noConsent: number;
};

export async function ineligibleCounts(owner: string): Promise<IneligibleCounts> {
  const contacts = await listContacts(owner);
  const counts: IneligibleCounts = { notActive: 0, noAddress: 0, noConsent: 0 };
  for (const contact of contacts) {
    const postable = !!contact.postalAddress && isPostable(contact.postalAddress);
    if (contact.status === "active" && postable && contact.wantsPostcard) continue; // eligible
    if (contact.status !== "active") counts.notActive += 1;
    if (!postable) counts.noAddress += 1;
    if (!contact.wantsPostcard) counts.noConsent += 1;
  }
  return counts;
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
  /** The language this journal writes to them in, or null if they never said.
   * A language is not an address, so this side of the line is fine to hand an
   * agent — and it is what lets one ask "shall I write Marta's in German?" */
  locale: string | null;
};

export async function postcardCandidates(owner: string): Promise<PostcardCandidate[]> {
  return (await eligible(owner)).map(({ id, to, locale }) => ({
    contactId: id,
    name: to.name,
    city: to.city,
    country: to.country ?? null,
    locale,
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

/** The same recipients an order names, with their languages, for the preview
 * page — which needs the address *and* the locale in one pass rather than two
 * decryptions of the same rows. */
export async function recipientsOf(
  owner: string,
  contactIds: string[],
): Promise<Map<string, { to: PostalAddress; locale: string | null }>> {
  const wanted = new Set(contactIds);
  const map = new Map<string, { to: PostalAddress; locale: string | null }>();
  for (const { id, to, locale } of await eligible(owner)) {
    if (wanted.has(id)) map.set(id, { to, locale });
  }
  return map;
}

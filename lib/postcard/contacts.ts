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
export async function postcardRecipientsFromContacts(owner: string): Promise<PostalAddress[]> {
  const contacts = await listContacts(owner);
  const recipients: PostalAddress[] = [];
  for (const contact of contacts) {
    const postal = contact.postalAddress;
    if (contact.status !== "active" || !contact.wantsPostcard || !postal || !isPostable(postal)) {
      continue;
    }
    recipients.push({
      // The name on the envelope first, falling back to the contact's own
      // name and then their address — the same order the admin panel and the
      // guest forms use for "who is this for".
      name: postal.name || contact.name || contact.email,
      line1: postal.line1,
      line2: postal.line2 || undefined,
      postcode: postal.postcode,
      city: postal.city,
      country: postal.country || undefined,
    });
  }
  return recipients;
}

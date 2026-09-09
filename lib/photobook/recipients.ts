import "server-only";
import { eligible } from "../postcard/contacts.ts";
import type { PostalAddress } from "../postcard/render.ts";
import { getUser } from "../users.ts";

/**
 * Who a printed photobook may be posted to — the same shape as
 * `lib/postcard/contacts.ts`'s recipients, sharing its eligibility gate, with
 * one deliberate difference: `wantsPostcard` is consent to *postcards*, not
 * to a book, so it is not asked for here. `status === "active"` and
 * `isPostable` still both apply — an address still has to exist and be
 * postable, and the owner still has to have actually let the contact in.
 */
export async function bookRecipients(owner: string): Promise<BookRecipient[]> {
  // B1093. Which row is the owner themselves, so the order page can preselect
  // them — a book is most often posted to the person whose journal it is, and
  // the alternative default is "whichever contact sorted first", which is a
  // guess dressed as a decision. Matched on the address in `config.json`
  // rather than on `created_via`, because an owner who arrived as a contact
  // some other way is still the owner.
  const ownerEmail = getUser(owner)?.owner.email?.trim().toLowerCase() ?? "";
  return (await eligible(owner, false)).map(({ id, email, to }) => ({
    id,
    name: to.name,
    city: to.city,
    country: to.country ?? "",
    self: ownerEmail !== "" && email.trim().toLowerCase() === ownerEmail,
  }));
}

export type BookRecipient = {
  id: string;
  name: string;
  city: string;
  country: string;
  /** This is the journal's own owner — the default the order page offers. */
  self: boolean;
};

/**
 * Turn a chosen recipient back into a full address, server-side only. An
 * agent chooses a `bookRecipients` id and never sees this; only the send
 * path calls it.
 */
export async function bookAddressFor(owner: string, contactId: string): Promise<PostalAddress | null> {
  for (const { id, to } of await eligible(owner, false)) {
    if (id === contactId) return to;
  }
  return null;
}

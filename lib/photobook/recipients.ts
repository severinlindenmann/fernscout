import "server-only";
import { eligible } from "../postcard/contacts.ts";
import type { PostalAddress } from "../postcard/render.ts";

/**
 * Who a printed photobook may be posted to — the same shape as
 * `lib/postcard/contacts.ts`'s recipients, sharing its eligibility gate, with
 * one deliberate difference: `wantsPostcard` is consent to *postcards*, not
 * to a book, so it is not asked for here. `status === "active"` and
 * `isPostable` still both apply — an address still has to exist and be
 * postable, and the owner still has to have actually let the contact in.
 */
export async function bookRecipients(
  owner: string,
): Promise<{ id: string; name: string; city: string; country: string }[]> {
  return (await eligible(owner, false)).map(({ id, to }) => ({
    id,
    name: to.name,
    city: to.city,
    country: to.country ?? "",
  }));
}

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

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

/**
 * The same people, with the envelope attached — B1145, B1157.
 *
 * **For the owner's own pages only.** `bookRecipients` above is the shape an
 * agent receives and must stay a name and a town; this is what somebody about
 * to pay for a delivery needs to see before they press. Both pages that call
 * it — the order page and the photobook wizard — 404 for anybody who is not
 * the owner.
 *
 * Sorted with the owner first, because they are the default and a list whose
 * first row is not the selected one reads as though the choice were made by an
 * ordering the reader cannot see. Anybody whose address will not resolve is
 * dropped rather than offered: a book cannot be posted to them.
 */
export async function bookRecipientsWithAddress(
  owner: string,
): Promise<(BookRecipient & { address: PostalAddress })[]> {
  const listed = await bookRecipients(owner);
  const withAddress = await Promise.all(
    listed.map(async (r) => {
      const address = await bookAddressFor(owner, r.id);
      return address ? { ...r, address } : null;
    }),
  );
  return withAddress
    .filter((r) => r !== null)
    .sort((a, b) => Number(b.self) - Number(a.self));
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

/**
 * A recipient as the photobook composer needs them: the agent-safe row, plus
 * the address the owner is posting to — B1145, moved here from
 * `components/PhotobookPrintPanel.tsx` when B1468 emptied that file.
 *
 * The address is added *here* rather than in `bookRecipients`, which stays a
 * name and a town: that shape is what an agent proposing a book receives, and
 * a street must not join it.
 */
export type PanelRecipient = BookRecipient & { address: PostalAddress };

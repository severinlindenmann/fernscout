import "server-only";
import { listContacts, normaliseEmail } from "@/lib/contacts";
import { listInvitesWithLinks } from "@/lib/contacts/invites";
import { serverSite } from "@/lib/site";
import { getUser } from "@/lib/users";
import { splitReaders } from "./split";

/**
 * Every reader of one journal, by whose turn it is — B2133. The readers page,
 * the hub's chip (`lib/studio/hub.ts`) and the invite section all read this,
 * so they cannot disagree about a person or a count. `asking` is
 * `waitingOnYou.length`: only a confirmed request is the owner's to answer.
 */
export async function readersModel(username: string) {
  const ownEmail = getUser(username)?.owner.email;
  const own = ownEmail ? normaliseEmail(ownEmail) : null;
  const all = await listContacts(username);
  const split = splitReaders(all, own);
  return {
    asking: split.waitingOnYou.length,
    ...split,
    /** The owner's own row (B621), apart from the readers. */
    own: all.find((c) => own !== null && c.email === own) ?? null,
    invitations: await listInvitesWithLinks(username, serverSite().url),
  };
}

import "server-only";
import { listContacts, unsubscribeUrlFor, manageTokenFor } from "../contacts";
import { getUsernames } from "../users";
import { serverSite } from "../site";
import { toE164 } from "./phone";
import { whatsappCountryCode } from "./settings";

/**
 * "STOP", said by somebody the number does not recognise as its owner —
 * B1062, superseding B386.
 *
 * **Trimmed, case-folded, exact.** Not a substring match: a message that
 * merely contains the word is not the word, the same discipline
 * `lib/whatsapp/acknowledge.ts` holds "yes" to. Hungarian's is flagged in the
 * run report for a native reader's confirmation before it is relied on.
 */
const STOP_WORDS = new Set(["stop", "stopp", "abbestellen", "leiratkozás"]);

export function isStopWord(text: string): boolean {
  return STOP_WORDS.has(text.trim().toLowerCase());
}

/**
 * Which journal's contact this number belongs to, if any — B1062.
 *
 * **A keyword-gated linear scan of every journal's contacts**, on purpose:
 * there is no phone-to-contact index anywhere in this codebase (`postalAddress`
 * is encrypted per contact, not queryable), and building one for a word that
 * arrives rarely is exactly the kind of thing worth not building until the
 * scan is a measured problem rather than a guessed one.
 *
 * ponytail: `O(journals × contacts)` per STOP, held safe by the caller only
 * ever reaching this for an inbound message matching `isStopWord` — an
 * instance-wide phone index is the upgrade path if that scan is ever the
 * thing actually costing time.
 */
export async function contactFor(
  tel: string,
): Promise<{ username: string; contactId: string; locale: string } | null> {
  const wanted = toE164(tel, whatsappCountryCode());
  if (!wanted) return null;
  for (const username of getUsernames()) {
    const contacts = await listContacts(username);
    for (const contact of contacts) {
      const contactTel = contact.postalAddress?.tel;
      if (!contactTel) continue;
      if (toE164(contactTel, whatsappCountryCode()) === wanted) {
        return { username, contactId: contact.id, locale: contact.locale ?? "en" };
      }
    }
  }
  return null;
}

/** The link that actually unsubscribes them — the same mechanism a mail
 *  footer's `List-Unsubscribe` points at, reached from a second door. */
export function stopReplyFor(username: string, contactId: string): string {
  const token = manageTokenFor(username, contactId);
  return unsubscribeUrlFor(serverSite().url, username, token);
}

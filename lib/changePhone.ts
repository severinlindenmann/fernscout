import "server-only";
import { revokeBrowserSessionsOfSubject } from "./auth";
import { movePersonPhone } from "./contacts";
import { journalsOwnedBy } from "./journals";
import { getOwnerTel, setOwnerTel } from "./ownerTel";
import { linkedEmail, linkedPhones, replaceLink } from "./people";
import { phoneSubject, toE164 } from "./phone";
import { journalForNumber, lockTel } from "./registry";

export type ChangePhoneResult = { ok: true } | { ok: false; reason: "taken" };

/**
 * A person replaces their number — B-3010. The caller has proved the new
 * number with a code, from a browser signed in by the address.
 *
 * Everything that is checked is checked before anything is written: the new
 * number belongs to nobody else, and no other journal holds it (the owner's
 * number lock, the rule `.../owner/tel/verify/redeem` follows). Then the new
 * number becomes the link, the owner's own number where it was the old one,
 * and the number on every contact row where the person proved the old one;
 * last, every sign-in by an old number ends, so it signs in as nobody.
 */
export async function changePersonPhone(email: string, newDigits: string): Promise<ChangePhoneResult> {
  const address = email.trim().toLowerCase();
  const holder = await linkedEmail(newDigits);
  if (holder && holder !== address) return { ok: false, reason: "taken" };
  const old = (await linkedPhones(address)).filter((digits) => digits !== newDigits);

  const ownerJournals: string[] = [];
  for (const username of journalsOwnedBy(address)) {
    const tel = await getOwnerTel(username);
    const digits = tel?.provenAt ? toE164(tel.tel) : null;
    if (digits && old.includes(digits)) ownerJournals.push(username);
  }
  for (const username of ownerJournals) {
    const lockedBy = journalForNumber(newDigits);
    if (lockedBy && lockedBy !== username) return { ok: false, reason: "taken" };
  }
  // ponytail: a lock taken here stays if a later write fails, the same as the
  // studio route; the operator's /admin frees a number.
  for (const username of ownerJournals) if (!lockTel(username, newDigits)) return { ok: false, reason: "taken" };

  await replaceLink(address, newDigits);
  for (const username of ownerJournals) await setOwnerTel(username, newDigits, "sms");
  for (const digits of old) await movePersonPhone(digits, newDigits);
  for (const digits of old) await revokeBrowserSessionsOfSubject(phoneSubject(digits));
  return { ok: true };
}

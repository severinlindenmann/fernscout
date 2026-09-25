import "server-only";
import crypto from "node:crypto";
import { hashSecret, isEmail, resolveSession, revokeSession, verifyCode } from "../auth";
import { getDatabase, newId, nowIso } from "../db";
import { grantIsLive } from "../grants";
import type { Locale } from "../types";
import {
  addressAad,
  contactsKey,
  decryptAddress,
  decryptString,
  EMPTY_ADDRESS,
  encryptAddress,
  encryptString,
  hasAnyDetail,
  hasContactsKey,
  isPostable,
  normaliseAddress,
  phoneAad,
  phoneKey,
  subjectLookup,
  type PostalAddress,
} from "./crypto";

import { countInviteUse, preapprovedEmailFor } from "./invites";
import { approveTripPlaces, claimTripPlace, revokeTripPlaces } from "../tripPeople";
import { parseLocale, pickLocale } from "./locale";
import { isMessageable, phoneSubject, subjectPhone, toE164 } from "../phone";
import { getUser } from "../users";
import { whatsappCountryCode } from "../contactNumber";

/**
 * One contact record — ROADMAP §3.1.
 *
 * The same person used to be asked for the same details three times: an email
 * to be approved as a guest, a channel preference, and a postal address for
 * printing. They are one row here, and everything downstream — the digest
 * (W11), push (W12), the postcard renderer (W13) — reads it.
 *
 * ## The four states, and why "confirmed" is not "approved"
 *
 * ```
 *   (form)          (six-digit code)          (owner)
 *  ──────►  pending ──────────────►  pending  ──────►  active
 *           confirmed_at: null      confirmed          approved_at set
 *                                       │ (owner)
 *                                       └──────────►  blocked
 * ```
 *
 * Confirming proves an address belongs to whoever filled the form. It does not
 * let them in. That separation is decision 19: an invite link may be forwarded
 * around a family group chat freely, because reaching the form is not access —
 * every person who fills it in becomes their own pending row and waits for the
 * owner. What B37 changed is only who is shown the form at all: an invite the
 * owner issued is now required to reach it and to submit it, because a journal
 * should not advertise a way in its owner never offered.
 *
 * ## What is never in the clear
 *
 * The postal address (AES-256-GCM, `./crypto.ts`) and the self-serve manage
 * token (sha-256). Neither is ever logged, and the address is never returned to
 * anyone but the owner and the person it belongs to.
 */

type ContactStatus = "pending" | "active" | "blocked";

/** The owner's view of somebody. Includes the address: they need it to post. */
export type ContactRecord = {
  id: string;
  name: string | null;
  email: string;
  locale: Locale | null;
  status: ContactStatus;
  wantsEmailDigest: boolean;
  wantsPostcard: boolean;
  /** B365. A separate consent from the digest, and gated on there being a
   * number to reach — see migration 015 and `isMessageable`. */
  wantsWhatsapp: boolean;
  hasPostalAddress: boolean;
  /** Includes `tel`, which since B2294 is stored in its own column and
   * merged back here, so every reader of `postalAddress.tel` is unchanged. */
  postalAddress: PostalAddress | null;
  /** B2294. The mobile number as typed, or null — the same value as
   * `postalAddress.tel`, stated where a phone-only contact can find it. */
  phone: string | null;
  /** When an SMS code proved `phone`. Null while it is only what was typed. */
  phoneProvenAt: string | null;
  /** B2292. New days by SMS — its own consent, gated on a number like
   * `wantsWhatsapp`. */
  wantsSms: boolean;
  /** B2292. The last channel the owner chose to tell this person on
   * (`email` | `whatsapp` | `sms` | `self`), and when. Null until then. */
  invitedVia: string | null;
  invitedAt: string | null;
  /** B2292. When their welcome link (`/w/<code>`) was first opened. */
  welcomeOpenedAt: string | null;
  createdVia: string | null;
  createdAt: string;
  confirmedAt: string | null;
  approvedAt: string | null;
  lastSeenAt: string | null;
};

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

function toBool(value: number | null | undefined): boolean {
  return value === 1;
}

function toStatus(value: string): ContactStatus {
  return value === "active" || value === "blocked" ? value : "pending";
}

/**
 * `fs_manage_…`, the credential in every mail footer.
 *
 * **Derived, not random.** An HMAC of the contact id under
 * `CONTACTS_ENCRYPTION_KEY`, so any later mail — a digest six months from now,
 * an approval notice written by a different process — can put the right
 * unsubscribe link in its footer without a plaintext token having been kept
 * anywhere. Only its sha-256 is stored, which is what the lookup uses.
 *
 * A random token would have had to be either stored in the clear or rotated on
 * every send, and rotating an unsubscribe link means the footer of last week's
 * email stops working. That is the one link that must never stop working.
 */
export function manageTokenFor(owner: string, contactId: string): string {
  const mac = crypto
    .createHmac("sha256", contactsKey())
    .update(`manage:${owner}:${contactId}`)
    .digest("base64url");
  return `fs_manage_${mac}`;
}

/** Exactly the row `selectAll()` returns, so a `{ ...row, … }` literal still
 * satisfies it — object literals are checked for excess properties, and a
 * narrower shape here would fail the moment a caller freshened one field. */
type ContactRow = {
  id: string;
  owner_id: string;
  name: string | null;
  email: string;
  email_key: string;
  locale: string | null;
  status: string;
  notes: string | null;
  wants_email_digest: number;
  wants_postcard: number;
  wants_whatsapp: number;
  postal_cipher: string | null;
  created_via: string | null;
  created_at: string;
  updated_at: string;
  confirmed_at: string | null;
  approved_at: string | null;
  last_seen_at: string | null;
  manage_token_hash: string | null;
  notified_at: string | null;
  phone_cipher: string | null;
  phone_key: string | null;
  phone_proven_at: string | null;
  wants_sms: number;
  welcome_code_hash: string | null;
  welcome_code_cipher: string | null;
  invited_via: string | null;
  invited_at: string | null;
  welcome_opened_at: string | null;
};

function toRecord(owner: string, row: ContactRow): ContactRecord {
  const postal = decryptAddress(row.postal_cipher, addressAad(owner, row.id));
  // The phone column first; a `tel` still inside the blob is a row that
  // `038-contact-phone` could not move (no key at the time) and is read as-is.
  const tel = decryptString(row.phone_cipher, phoneAad(owner, row.id), "phone") ?? postal?.tel ?? "";
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    locale: parseLocale(row.locale),
    status: toStatus(row.status),
    wantsEmailDigest: toBool(row.wants_email_digest),
    wantsPostcard: toBool(row.wants_postcard),
    wantsWhatsapp: toBool(row.wants_whatsapp),
    hasPostalAddress: row.postal_cipher !== null || row.phone_cipher !== null,
    postalAddress: postal || tel ? { ...(postal ?? EMPTY_ADDRESS), tel } : null,
    phone: tel || null,
    phoneProvenAt: row.phone_proven_at,
    wantsSms: toBool(row.wants_sms),
    invitedVia: row.invited_via,
    invitedAt: row.invited_at,
    welcomeOpenedAt: row.welcome_opened_at,
    createdVia: row.created_via,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at,
    approvedAt: row.approved_at,
    lastSeenAt: row.last_seen_at,
  };
}

/**
 * Where a contact's mobile number is stored — B2294.
 *
 * The number leaves the postal blob for columns of its own (`038-contact-
 * phone`): a ciphertext, and an HMAC of its E.164 digits that sign-in looks
 * up by. **The lookup key is the credential**, so who may set it is the whole
 * security question, and this is the one place it is answered:
 *
 * - `self` — typed into a self-service or anonymous door (the join form,
 *   the manage link, a guestbook). Stored for the card and for postcards,
 *   **never** a way in: the key stays null. And such a door never replaces or
 *   clears a number that already signs in — it is ignored instead.
 * - `owner` — the journal's owner typed a **new** number (owner-cookie doors
 *   only). Takes the key from a contact that holds it unproven, never from
 *   one that proved it.
 * - `proven` — an SMS code to this number was just redeemed for this
 *   contact. Takes the key the same way, and stamps it proven.
 *
 * Whatever the trust, the number that is already stored, re-sent unchanged,
 * keeps exactly the state it had: a form re-sending a whole address is
 * nobody vouching for its number anew.
 *
 * `phone_proven_at` survives only while the number is the one proved.
 */
type PhoneTrust = "self" | "owner" | "proven";

async function phoneColumns(
  owner: string,
  id: string,
  tel: string,
  trust: PhoneTrust,
  /** False for a row about to be inserted: nothing stored to compare with. */
  exists = true,
): Promise<Pick<ContactRow, "phone_cipher" | "phone_key" | "phone_proven_at">> {
  const typed = tel.trim();
  const digits = typed ? toE164(typed, whatsappCountryCode()) : null;
  const { db } = await getDatabase();
  const current = exists
    ? await db
        .selectFrom("contacts")
        .select(["phone_cipher", "phone_key", "phone_proven_at", "postal_cipher"])
        .where("owner_id", "=", owner)
        .where("id", "=", id)
        .executeTakeFirst()
    : undefined;
  const kept = {
    phone_cipher: current?.phone_cipher ?? null,
    phone_key: current?.phone_key ?? null,
    phone_proven_at: current?.phone_proven_at ?? null,
  };
  // A row `038-contact-phone` could not move still has its number in the blob.
  const stored = current
    ? (decryptString(current.phone_cipher, phoneAad(owner, id), "phone") ??
      (decryptAddress(current.postal_cipher, addressAad(owner, id))?.tel || null))
    : null;
  const storedDigits = stored ? toE164(stored, whatsappCountryCode()) : null;

  // The same number again leaves it exactly as it was, keyed or not — a form
  // that re-sends the whole address (the owner fixing a street, a reader
  // re-saving their page) is not anybody vouching for the number anew.
  // Without this, an owner's postcard edit would key a number a stranger
  // planted through the join form (B2294 re-review, NEW-B).
  const same = typed === "" ? stored === null : digits ? digits === storedDigits : typed === stored;
  // (A proof is the exception: it is exactly what keys an unkeyed number.)
  if (current && same && trust !== "proven") return kept;
  // A self-service or anonymous door never replaces or clears a number that
  // signs in (NEW-A): whoever knows a reader's address could otherwise take
  // their SMS sign-in away. Changing it is the signed-in proof (`./guestCode`
  // `confirmPhoneProof`) or the owner's.
  if (trust === "self" && kept.phone_key) return kept;
  if (typed === "") return { phone_cipher: null, phone_key: null, phone_proven_at: null };

  const key = digits ? phoneKey(digits) : null;
  const holder = key ? await phoneKeyHolder(owner, key) : null;
  // Never from a contact that proved the number — only from nobody, or from
  // a holder whose key was owner-typed and never proved (LOW-7).
  const takes = key !== null && trust !== "self" && (!holder || !holder.phone_proven_at);
  if (takes && holder && holder.id !== id) {
    await db
      .updateTable("contacts")
      .set({ phone_key: null, phone_proven_at: null, updated_at: nowIso() })
      .where("id", "=", holder.id)
      .execute();
  }
  return {
    phone_cipher: encryptString(typed, phoneAad(owner, id)),
    phone_key: takes ? key : null,
    phone_proven_at: takes && trust === "proven" ? nowIso() : null,
  };
}

async function phoneKeyHolder(owner: string, key: string) {
  const { db } = await getDatabase();
  return db
    .selectFrom("contacts")
    .select(["id", "phone_proven_at"])
    .where("owner_id", "=", owner)
    .where("phone_key", "=", key)
    .executeTakeFirst();
}

/** The postal blob without the number, which lives in its own column — null
 * when the number was all there was. */
function postalCipherFor(owner: string, id: string, address: PostalAddress): string | null {
  const rest = { ...address, tel: "" };
  return hasAnyDetail(rest) ? encryptAddress(rest, addressAad(owner, id)) : null;
}

/** Both halves of an address write, for the three writers below. */
async function addressColumns(
  owner: string,
  id: string,
  address: PostalAddress | null,
  trust: PhoneTrust,
  exists = true,
) {
  return {
    postal_cipher: address ? postalCipherFor(owner, id, address) : null,
    ...(await phoneColumns(owner, id, address?.tel ?? "", trust, exists)),
  };
}

export type ContactRequestInput = {
  name: string;
  email: string;
  locale: Locale;
  /**
   * What to store as their postal address.
   *
   * Three values, and they are three different instructions. An **object** is
   * "this is their address now". **`null`** is "they were asked and gave
   * nothing", which erases what was there. **`undefined`** is "they were not
   * asked", and leaves the stored address and the postcard consent exactly as
   * they are — the same distinction `updateContactSelf` draws, for the same
   * reason: a form that never showed somebody their address must not be able
   * to delete it. B33's redemption is the caller that needs `undefined` most:
   * for a reader already known to this journal it asks for nothing beyond a
   * name and an address to reach. Since B273 it is also a caller of the
   * **object** form — a brand-new reader, never asked before, is offered a
   * postal address and a phone number on the same screen the guestbook uses,
   * because there is no existing choice for that screen to overwrite.
   */
  address?: Partial<PostalAddress> | null;
  wantsEmailDigest: boolean;
  wantsPostcard: boolean;
  /**
   * Optional where its two neighbours are required, and that asymmetry is
   * deliberate: **absence is the absence of consent.** A caller that has
   * never heard of this field cannot accidentally opt somebody in, which is
   * the only failure mode here that reaches a stranger's phone. The other two
   * are required because a form that forgot them silently *unsubscribes*
   * somebody — the opposite risk, needing the opposite default.
   */
  wantsWhatsapp?: boolean;
  /** `invite:<id>` | `owner` — and `open` on rows written before B37 removed
   * the open guestbook. Those are left as they are: they record how somebody
   * actually arrived. */
  createdVia: string;
  /** The invite whose use should be counted, if any. */
  inviteId?: string | null;
};

export type ContactRequestResult =
  | { outcome: "created" | "updated"; contactId: string }
  /** A blocked address that asked again. Answered exactly like a success
   * everywhere above this line, so the form is not a way of discovering that
   * somebody was shown the door. */
  | { outcome: "ignored"; contactId: null };

/**
 * Somebody filled in the form.
 *
 * Keyed on the address, case-folded: filling the form twice corrects the first
 * answer rather than making a second person. Nothing here grants anything, and
 * an existing `active` contact is never demoted by a resubmission — otherwise
 * anyone who knew a reader's address could revoke their access by typing it in.
 */
export async function requestContact(
  owner: string,
  input: ContactRequestInput,
): Promise<ContactRequestResult> {
  const email = normaliseEmail(input.email);
  // Keyed on an address, so only ever an address — B2294's review: a signed-in
  // phone subject (`+41…`) passed through as the "email" would otherwise
  // become a row whose address is a phone number.
  if (!isEmail(email)) return { outcome: "ignored", contactId: null };
  const { db } = await getDatabase();
  const now = nowIso();
  const name = input.name.trim().slice(0, 120);

  // "Not asked" — see the field's own note. Nothing below it may run for such
  // a call, because every line of it decides what to *write* over an address
  // that was never shown to anybody.
  const untouched = input.address === undefined;
  const address = normaliseAddress(input.address);

  const existing = await db
    .selectFrom("contacts")
    .selectAll()
    .where("owner_id", "=", owner)
    .where("email_key", "=", email)
    .executeTakeFirst();

  if (existing && toStatus(existing.status) === "blocked") {
    return { outcome: "ignored", contactId: null };
  }

  const id = existing?.id ?? newId();

  // Two different rules for two different forms, and they are opposites.
  // `updateContactSelf` reads a submitted-but-empty `tel` as a deliberate
  // clear, because that form *prefills*: the guest sees the number before
  // choosing to remove it. This one — the public join form — never prefills;
  // a returning guest always sees a blank phone box, whatever is on file. So
  // an empty `tel` here can never mean "delete it", only "I did not say",
  // and the stored number is carried forward. (The join form always sends a
  // `tel` key, so presence can't carry the distinction the way it does in
  // `updateContactSelf` — only the value, trimmed, can.) Clearing a number is
  // done where it can be seen: the manage page, or `deleteContactSelf`.
  const existingAddress = existing ? toRecord(owner, existing).postalAddress : null;
  const mergedAddress =
    existingAddress && address.tel.trim() === "" ? { ...address, tel: existingAddress.tel } : address;

  // A postcard needs somewhere to send it, and a caller that did not ask about
  // the address cannot have changed the answer either way.
  const wantsPostcard = untouched
    ? (toBool(existing?.wants_postcard) && input.wantsPostcard)
    : input.wantsPostcard && isPostable(address);

  // The same shape as `wantsPostcard` directly above, and for the same
  // reason: a consent whose channel has no address is not a preference, it is
  // a typo. `mergedAddress` rather than `address`, because a caller that did
  // not re-ask for the number still has the one already on file.
  const wantsWhatsapp = untouched
    ? (toBool(existing?.wants_whatsapp) && input.wantsWhatsapp === true)
    : input.wantsWhatsapp === true && isMessageable(mergedAddress.tel, whatsappCountryCode());

  // Nothing at all given — not even a phone number — writes nulls: unticking
  // the postcard box and clearing every field is a deletion, not a no-op. The
  // phone number does not follow that rule (see the merge above), but with no
  // existing tel to carry forward there is truly nothing left to store.
  const stored = untouched
    ? null
    : await addressColumns(owner, id, hasAnyDetail(mergedAddress) ? mergedAddress : null, "self", Boolean(existing));

  if (existing) {
    await db
      .updateTable("contacts")
      .set({
        name: name || existing.name,
        email,
        locale: input.locale,
        ...stored,
        wants_email_digest: input.wantsEmailDigest ? 1 : 0,
        wants_postcard: wantsPostcard ? 1 : 0,
        wants_whatsapp: wantsWhatsapp ? 1 : 0,
        updated_at: now,
      })
      .where("id", "=", existing.id)
      .execute();
  } else {
    await db
      .insertInto("contacts")
      .values({
        id,
        owner_id: owner,
        email,
        email_key: email,
        name: name || null,
        locale: input.locale,
        status: "pending",
        notes: null,
        created_at: now,
        updated_at: now,
        ...(stored ?? { postal_cipher: null, phone_cipher: null, phone_key: null, phone_proven_at: null }),
        wants_email_digest: input.wantsEmailDigest ? 1 : 0,
        wants_postcard: wantsPostcard ? 1 : 0,
        wants_whatsapp: wantsWhatsapp ? 1 : 0,
        created_via: input.createdVia,
        confirmed_at: null,
        approved_at: null,
        last_seen_at: null,
        // Known from the moment the row exists, and told to nobody until the
        // address has been confirmed — or, for a row the owner imported
        // (B2055), in the one mail asking whether they want anything at all,
        // so the person can decline everything without proving anything.
        manage_token_hash: hashSecret(manageTokenFor(owner, id)),
      })
      .execute();
  }

  if (input.inviteId) await countInviteUse(owner, input.inviteId);

  return { outcome: existing ? "updated" : "created", contactId: id };
}

export type ConfirmResult =
  | {
      ok: true;
      contact: ContactRecord;
      manageToken: string;
      firstConfirmation: boolean;
      /** Whether the owner still needs telling — `notified_at === null`.
       * True on a first confirmation, and also true on a re-confirmation
       * whose earlier notification mail failed (B272): distinct from
       * `firstConfirmation`, which stays about the address, not the mail. */
      needsOwnerNotice: boolean;
      /**
       * The guest session `verifyCode` minted for this address — set only
       * when this confirmation is a **pre-approved** one (B350, see
       * `preapprovedEmailFor`): the address has nothing left to prove, so the
       * caller sets it as the reader's cookie rather than sending them to
       * their inbox for a second link. Every other confirmation revokes the
       * session on the spot, exactly as this function always did — proving an
       * address is still not, on its own, a reason to sign somebody in.
       */
      sessionToken?: string;
      sessionExpiresAt?: string;
    }
  | { ok: false };

/**
 * Double opt-in (C12), on W08's code path.
 *
 * The one-time code machinery is not reimplemented here — `verifyCode` is the
 * same function the sign-in route uses, which is why "the code is single use",
 * "five wrong guesses burn it" and the code window are true here for free.
 *
 * The session it mints is revoked on the spot, unless this confirmation is a
 * pre-approved one — see `sessionToken` on `ConfirmResult`. Confirming an
 * address is not signing in; being pre-approved by the owner and then proving
 * it, in this call, is the one exception (B350).
 */
export async function confirmContact(
  owner: string,
  email: string,
  code: string,
): Promise<ConfirmResult> {
  const address = normaliseEmail(email);
  const verified = await verifyCode(owner, address, code, "guest");
  if (!verified.ok) return { ok: false };

  const { db } = await getDatabase();
  const row = await db
    .selectFrom("contacts")
    .selectAll()
    .where("owner_id", "=", owner)
    .where("email_key", "=", address)
    .executeTakeFirst();

  // A valid code with no contact behind it means somebody signed in through
  // the auth route and then posted here. Nothing to confirm — and nothing to
  // keep a session open for.
  if (!row || toStatus(row.status) === "blocked") {
    const session = await resolveSession(verified.token, "guest");
    if (session) await revokeSession(session.id);
    return { ok: false };
  }

  // B319/B350: does the invite that brought this address here name *this
  // exact address* as one the owner pre-approved? If not, this is the
  // ordinary path and the session is revoked below exactly as before.
  const preapproved =
    (await preapprovedEmailFor(owner, row.created_via, toStatus(row.status))) === row.email;
  if (!preapproved) {
    const session = await resolveSession(verified.token, "guest");
    if (session) await revokeSession(session.id);
  }

  const manageToken = manageTokenFor(owner, row.id);
  const now = nowIso();
  const firstConfirmation = row.confirmed_at === null;
  const needsOwnerNotice = row.notified_at === null;

  await db
    .updateTable("contacts")
    .set({
      confirmed_at: row.confirmed_at ?? now,
      manage_token_hash: hashSecret(manageToken),
      last_seen_at: now,
      updated_at: now,
    })
    .where("id", "=", row.id)
    .execute();

  const fresh = { ...row, confirmed_at: row.confirmed_at ?? now, last_seen_at: now };
  return {
    ok: true,
    contact: toRecord(owner, fresh),
    manageToken,
    firstConfirmation,
    needsOwnerNotice,
    ...(preapproved ? { sessionToken: verified.token, sessionExpiresAt: verified.expiresAt } : {}),
  };
}

/**
 * Confirming without a code, because a session already is one — B33.
 *
 * Somebody redeeming an invite link in a browser they are already signed into
 * has proved this exact address to this exact journal: the cookie was minted
 * by `verifyCode`, against a six-digit code mailed to it, and `resolveSession`
 * refuses it for any other journal. Mailing them a second code to type would
 * be asking them to prove the same thing twice — which is the friction the
 * personal link exists to remove, and the people this is for are the ones who
 * give up at it.
 *
 * **The caller must have resolved the session itself**, and must pass the
 * address off that session and never one out of a request body. Called with a
 * submitted address this would confirm anybody who typed one in, which is the
 * whole of the double opt-in.
 *
 * Everything else is `confirmContact`'s behaviour, including refusing a
 * blocked row and leaving an existing `confirmed_at` alone.
 */
export async function confirmContactFromSession(
  owner: string,
  sessionEmail: string,
): Promise<ConfirmResult> {
  // `confirmed_at` is the *email* double opt-in that `mayMailContact` trusts.
  // A session that proved a mobile number has proved nothing about an
  // address, so it confirms nothing here (B2294's review) — its proof is
  // `phone_proven_at`, written where the SMS code was redeemed.
  if (subjectPhone(sessionEmail)) return { ok: false };
  const lookup = subjectLookup(sessionEmail);
  if (!lookup) return { ok: false };
  const { db } = await getDatabase();
  const row = await db
    .selectFrom("contacts")
    .selectAll()
    .where("owner_id", "=", owner)
    .where(lookup[0], "=", lookup[1])
    .executeTakeFirst();

  if (!row) return { ok: false };
  if (toStatus(row.status) === "blocked") return { ok: false };

  const manageToken = manageTokenFor(owner, row.id);
  const now = nowIso();
  const firstConfirmation = row.confirmed_at === null;
  const needsOwnerNotice = row.notified_at === null;

  await db
    .updateTable("contacts")
    .set({
      confirmed_at: row.confirmed_at ?? now,
      manage_token_hash: hashSecret(manageToken),
      last_seen_at: now,
      updated_at: now,
    })
    .where("id", "=", row.id)
    .execute();

  const fresh = { ...row, confirmed_at: row.confirmed_at ?? now, last_seen_at: now };
  return { ok: true, contact: toRecord(owner, fresh), manageToken, firstConfirmation, needsOwnerNotice };
}

/**
 * The owner has now actually been told about this confirmation — B272.
 *
 * A write of its own, separate from `confirmContact`'s, so it only happens
 * once `notifyOwnerOfRequest` has returned success. That is what makes a
 * failed send recoverable instead of silent: the column stays null, and the
 * next time this address confirms — a fresh code, or the same signed-in
 * session — `needsOwnerNotice` is true again and the caller retries, without
 * a second request ever appearing in front of the owner.
 */
export async function markOwnerNotified(owner: string, contactId: string): Promise<void> {
  const { db } = await getDatabase();
  await db
    .updateTable("contacts")
    .set({ notified_at: nowIso() })
    .where("id", "=", contactId)
    .where("owner_id", "=", owner)
    .execute();
}

/**
 * The self-serve page's key (C13).
 *
 * A token in a URL, no password, no login — because the person it is for is
 * seventy-eight and the alternative is that they never unsubscribe and mark the
 * mail as spam instead. It is scoped to one row and can do nothing but read,
 * edit and delete that row.
 */
export async function resolveManageToken(
  owner: string,
  token: string,
): Promise<ContactRecord | null> {
  if (!token) return null;
  const { db } = await getDatabase();
  const row = await db
    .selectFrom("contacts")
    .selectAll()
    .where("owner_id", "=", owner)
    .where("manage_token_hash", "=", hashSecret(token))
    .executeTakeFirst();

  if (!row) return null;

  const now = nowIso();
  await db
    .updateTable("contacts")
    .set({ last_seen_at: now })
    .where("id", "=", row.id)
    .execute();

  return toRecord(owner, { ...row, last_seen_at: now });
}

export type SelfUpdate = {
  name?: string;
  locale?: string;
  address?: Partial<PostalAddress> | null;
  wantsEmailDigest?: boolean;
  wantsPostcard?: boolean;
  wantsWhatsapp?: boolean;
  wantsSms?: boolean;
};

/** Change language, change address, change your mind. */
export async function updateContactSelf(
  owner: string,
  token: string,
  patch: SelfUpdate,
): Promise<ContactRecord | null> {
  const current = await resolveManageToken(owner, token);
  if (!current) return null;

  const { db } = await getDatabase();
  const submittedAddress =
    patch.address === undefined
      ? undefined
      : normaliseAddress(patch.address);
  // `ContactManage.tsx` now has its own `tel` field (task 10), and posts the
  // whole address on every save — including a `tel` key holding `""` when
  // the guest has deliberately cleared it. An *older* client, or one that
  // never had the field, sends no `tel` key at all. Those two must not read
  // the same: distinguish on whether the key was present in what was
  // actually submitted, not on whether the value is empty, so a genuine
  // clear takes effect while an old client's silent omission still falls
  // back to the number already on file.
  // `patch.address === null` (an explicit "no address" rather than
  // `undefined`, "the caller didn't send this field") has no `tel` key
  // either, by the same test — a null address behaves like an old client
  // with none, carrying the existing tel forward rather than erasing it.
  // `deleteContactSelf` remains the real "erase everything" path.
  const telSubmitted =
    patch.address !== undefined &&
    patch.address !== null &&
    typeof patch.address === "object" &&
    "tel" in patch.address;
  const address =
    submittedAddress === undefined
      ? undefined
      : {
          ...submittedAddress,
          tel: telSubmitted ? submittedAddress.tel : (current.postalAddress?.tel ?? ""),
        };

  const wantsPostcard = patch.wantsPostcard ?? current.wantsPostcard;
  const wantsWhatsapp = patch.wantsWhatsapp ?? current.wantsWhatsapp;
  const wantsSms = patch.wantsSms ?? current.wantsSms;
  // `isPostable` is the wrong gate for whether to keep the blob at all — a
  // record holding only a phone number is worth keeping, same as
  // `requestContact` and `updateContactByOwner`.
  const keepAddress =
    address === undefined
      ? current.postalAddress
      : hasAnyDetail(address)
        ? address
        : null;

  const stored = await addressColumns(owner, current.id, keepAddress, "self");
  await db
    .updateTable("contacts")
    .set({
      name: patch.name?.trim() ? patch.name.trim().slice(0, 120) : current.name,
      locale: parseLocale(patch.locale) ?? current.locale,
      wants_email_digest: (patch.wantsEmailDigest ?? current.wantsEmailDigest) ? 1 : 0,
      // Asking for a postcard without a *postable* address on file is not a
      // preference, it is a typo. `keepAddress` may now hold a tel-only blob,
      // so the gate is `isPostable`, not merely "there is a blob at all".
      wants_postcard: wantsPostcard && keepAddress !== null && isPostable(keepAddress) ? 1 : 0,
      // Same gate, different channel: consent with no number to reach is not
      // a state worth storing.
      wants_whatsapp:
        wantsWhatsapp && keepAddress !== null && isMessageable(keepAddress.tel, whatsappCountryCode())
          ? 1
          : 0,
      // B2292 — the same gate for the SMS channel.
      wants_sms:
        wantsSms && keepAddress !== null && isMessageable(keepAddress.tel, whatsappCountryCode()) ? 1 : 0,
      ...stored,
      updated_at: nowIso(),
    })
    .where("id", "=", current.id)
    .execute();

  return resolveManageToken(owner, token);
}

/** "Stop these emails" — one click from a mail footer, no login (C13). */
export async function unsubscribeContact(owner: string, token: string): Promise<boolean> {
  const current = await resolveManageToken(owner, token);
  if (!current) return false;
  const { db } = await getDatabase();
  await db
    .updateTable("contacts")
    .set({ wants_email_digest: 0, wants_postcard: 0, wants_whatsapp: 0, wants_sms: 0, updated_at: nowIso() })
    .where("id", "=", current.id)
    .execute();
  return true;
}

/**
 * "Delete me" — the GDPR/DSG path (ROADMAP L5), and it means it.
 *
 * The row goes, and with it the address, the consents and every access grant
 * (the foreign key cascades). Any push subscription is orphaned rather than
 * deleted, because it belongs to a browser rather than to a person.
 */
export async function deleteContactSelf(owner: string, token: string): Promise<boolean> {
  const current = await resolveManageToken(owner, token);
  if (!current) return false;
  return deleteContact(owner, current.id);
}

export async function deleteContact(owner: string, id: string): Promise<boolean> {
  const { db } = await getDatabase();
  const result = await db
    .deleteFrom("contacts")
    .where("owner_id", "=", owner)
    .where("id", "=", id)
    .executeTakeFirst();
  // `numDeletedRows` is a bigint on both drivers; the build targets ES2017,
  // where a `0n` literal is a syntax error.
  return Number(result.numDeletedRows ?? 0) > 0;
}

/** Everyone, for the owner's admin surface (C6). Never crosses an owner. */
export async function listContacts(owner: string): Promise<ContactRecord[]> {
  const { db } = await getDatabase();
  const rows = await db
    .selectFrom("contacts")
    .selectAll()
    .where("owner_id", "=", owner)
    .orderBy("created_at", "desc")
    .execute();
  return rows.map((row) => toRecord(owner, row));
}

/**
 * How many of this journal's contacts would receive each channel, journal-wide
 * — B367's "up to N" on `/<user>/me`, not one trip's.
 *
 * The predicate — `status: "active"` and the channel's own opt-in — is
 * `lib/digest/dayLetter.ts`'s `recipientsFor` restated without a trip to ask
 * `mayMailTrip` about. It is therefore the count for the *most permissive*
 * trip a send could go to: `mayMailTrip` returns `true` unconditionally for a
 * `public` trip (`isOpenToLink`), so a public trip's own recipient count
 * matches this exactly, and a `private` or `guest` one reaches fewer once
 * that gate starts filtering per recipient. That gap is why the page says
 * "up to N" rather than a number a `private` trip's own send would not match
 * — never a second, diverging definition of "opted in" to keep in step with
 * the first.
 */
export function optedInCounts(
  contacts: ContactRecord[],
  /**
   * The journal owner's own address and number, when they have them.
   *
   * Both are **exclusions**, not additions — B614. `recipientsFor` on either
   * channel adds the owner's own copy of a day and it is free, so what this
   * counts is everybody else: a contact sitting at the owner's own address,
   * or on the owner's own phone, is folded into that free copy by the same
   * `seen` set the send path uses, and counting them here would quote a
   * credit the charge is never going to ask for.
   *
   * It used to be the other way round for email — contacts-minus-the-owner
   * **plus one** — because the owner's letter was billed like anybody else's.
   * That was arithmetic about the right list and the wrong price: a credit is
   * what it costs to reach somebody else, and on a journal with no guests at
   * all the whole quoted bill was the author being charged to read their own
   * writing.
   *
   * `tel` must arrive already normalised to E.164 (it is, on `Owner.tel`), so
   * it can be compared with `toE164` of a contact's number without this
   * function needing to know the operator's default country code.
   */
  owner?: { email?: string | null; tel?: string | null },
): { email: number; whatsapp: number } {
  const isActive = (c: ContactRecord) => c.status === "active";
  const ownerEmail = owner?.email ? normaliseEmail(owner.email) : null;
  const ownerTel = owner?.tel ?? null;
  const countryCode = whatsappCountryCode();
  return {
    email: contacts.filter(
      (c) => isActive(c) && c.wantsEmailDigest && normaliseEmail(c.email) !== ownerEmail,
    ).length,
    whatsapp: contacts.filter((c) => {
      if (!isActive(c) || !c.wantsWhatsapp) return false;
      // The owner's own row — B619. Their message is free whichever door it
      // arrives by, so counting it would quote a credit nothing will charge.
      if (normaliseEmail(c.email) === ownerEmail) return false;
      const tel = c.postalAddress?.tel;
      // No number is no message, the same as in `recipientsFor` — and a
      // number that is the owner's own is their free copy.
      if (!tel) return false;
      const to = toE164(tel, countryCode);
      return to !== null && to !== ownerTel;
    }).length,
  };
}

/**
 * One contact, by the address on their session cookie.
 *
 * Indexed on `email_key`, and one row rather than the whole book: this is
 * asked during a page render — `journalReader` in `./session.ts` calls it for
 * every gated trip a signed-in reader opens — and `listContacts` decrypts a
 * postal address per row, which is a lot of scrypt to do in order to answer a
 * yes/no question about one person.
 */
export async function getContactByEmail(
  owner: string,
  email: string,
): Promise<ContactRecord | null> {
  const lookup = subjectLookup(email);
  if (!lookup) return null;
  const { db } = await getDatabase();
  const row = await db
    .selectFrom("contacts")
    .selectAll()
    .where("owner_id", "=", owner)
    .where(lookup[0], "=", lookup[1])
    .executeTakeFirst();
  return row ? toRecord(owner, row) : null;
}


export async function getContact(owner: string, id: string): Promise<ContactRecord | null> {
  const { db } = await getDatabase();
  const row = await db
    .selectFrom("contacts")
    .selectAll()
    .where("owner_id", "=", owner)
    .where("id", "=", id)
    .executeTakeFirst();
  return row ? toRecord(owner, row) : null;
}

/**
 * Wave somebody in.
 *
 * Approval is the only thing that creates an `access_grants` row, and it is
 * refused for an address that has not been confirmed — otherwise the owner
 * could be talked into approving an address nobody has proved they can read.
 *
 * **One approval, two effects, since B33.** It writes the journal-wide read
 * grant it always has, *and* it turns any outstanding buddy-link request from
 * this person into a place on the trip they asked to join. Deliberately one
 * click rather than two: the owner is deciding about a person, and a second
 * button they could forget would leave somebody who followed a buddy link
 * approved as a reader and silently still not on the trip.
 *
 * The cost is stated rather than hidden: approving somebody who came through a
 * **buddy** link therefore also lets them read every `guest` trip in the
 * journal. That is why a buddy link is documented everywhere as the stronger
 * of the two and not the one to paste into a group chat. `private` is still
 * the way to hold a trip back from everyone who is otherwise let in.
 *
 * **Approving a blocked contact undoes a revocation in full** — B213. It
 * always did on this table (the grant below is written back from scratch, so
 * the journal returns), and since B213 it does on `trip_people` too: a place
 * `revokeContact` marked comes back rather than staying shut with the response
 * still saying `ok`. The owner pressing approve on somebody they blocked is
 * the whole of what it takes, and the whole of what can do it — the blocked
 * person's own routes back all refuse before they reach here.
 *
 * **Says which trips it opened, since B244.** The ids come back from
 * `approveTripPlaces` in `tripsOpened`, empty when the approval opened
 * nothing (a journal-wide read grant only, or a re-approval that opened
 * nothing new) — never omitted, so a caller can tell "opened nothing" from
 * "didn't ask". `contact` is still null on the same two refusals as before
 * (`getContact` finds nothing, or the address is unconfirmed); the wrapper
 * only appears on success, so `approveContact(...)` staying `null` on
 * refusal is unchanged for every caller that only checks that.
 */
export async function approveContact(
  owner: string,
  id: string,
  /**
   * B2292 — which trip places this approval opens. Absent: every place the
   * contact asked for (the owner approving a request). `{ onlyTrip: null }`:
   * none — "Add a person" as a reader must never turn an old buddy request
   * or a revoked place into write access. `{ onlyTrip: id }`: that one trip.
   */
  places?: { onlyTrip: string | null },
): Promise<{ contact: ContactRecord; tripsOpened: string[] } | null> {
  const contact = await getContact(owner, id);
  if (!contact) return null;
  // Either channel proved counts (B2294): an address confirmed by its code, or
  // a number proved by SMS. Neither alone is access — this click is.
  if (!contact.confirmedAt && !contact.phoneProvenAt) return null;

  const { db } = await getDatabase();
  const now = nowIso();
  await db
    .updateTable("contacts")
    .set({ status: "active", approved_at: contact.approvedAt ?? now, updated_at: now })
    .where("owner_id", "=", owner)
    .where("id", "=", id)
    .execute();

  // **A row is not a grant; a live row is** — B130. Asking only whether the
  // row exists is the test `lib/push.ts` carried until B82, in the other
  // direction: a grant whose `expires_at` has passed is refused by every
  // reader, but it is still a row, so guarding the insert on existence alone
  // means the owner clicks approve, the contact goes `active`, and the person
  // is still shut out — with the UI reporting success. `grantIsLive` is the
  // one place that decides, so this writer asks it too.
  const grant = await db
    .selectFrom("access_grants")
    .select(["id", "expires_at"])
    .where("owner_id", "=", owner)
    .where("contact_id", "=", id)
    .where("scope", "=", "read")
    .executeTakeFirst();

  if (!grant) {
    await db
      .insertInto("access_grants")
      .values({
        id: newId(),
        owner_id: owner,
        contact_id: id,
        // The whole journal. There is no narrower grant to write — see
        // `AccessGrantsTable` — so this is simply "they may read this
        // journal's `guest` trips". Never its `private` ones: that is the one
        // thing being let into a journal does not widen.
        scope: "read",
        granted_at: now,
        granted_by: owner,
        expires_at: null,
      })
      .execute();
  } else if (!grantIsLive(grant.expires_at, new Date(now))) {
    // Approving is the owner saying *let them in now*, so the lapsed row is
    // revived rather than left standing: the expiry is cleared and the stamps
    // are rewritten, because this is a fresh decision and the old
    // `granted_at` describes a grant that has since run out. Writing a new
    // expiry instead would need a caller that supplies one, and nothing
    // issues time-limited grants yet — that is the feature this waits for,
    // not this fix.
    await db
      .updateTable("access_grants")
      .set({ granted_at: now, granted_by: owner, expires_at: null })
      .where("id", "=", grant.id)
      .execute();
  }

  // Every trip they asked to join, opened by the same click. Returns the ids
  // rather than nothing so a caller can say which trips were opened.
  const tripsOpened = !places
    ? await approveTripPlaces(owner, id)
    : places.onlyTrip
      ? await approveTripPlaces(owner, id, places.onlyTrip)
      : [];

  const updated = await getContact(owner, id);
  // Cannot actually be null — the row was read at the top of this function
  // and only ever updated above, never deleted — but the type of
  // `getContact` is honest about every caller, so this one states the
  // invariant rather than asserting past it.
  if (!updated) return null;
  return { contact: updated, tripsOpened };
}

/**
 * D11 — the owner vouching for an address directly, with no code and no
 * session to prove it.
 *
 * Every other door to `confirmed_at` proves the *address itself* answered:
 * a six-digit code (`confirmContact`) or a session already minted against
 * that exact address (`confirmContactFromSession`). Neither applies here —
 * the owner is naming somebody else's address from inside their own studio,
 * and D11's whole point is that this no longer waits on the recipient to
 * prove anything back. `approveContact` still refuses an unconfirmed row, so
 * this is the one write that lets a caller past that refusal *without* a
 * proof, and it is deliberately narrow: it only ever moves a fresh, never
 * confirmed row (the `where confirmed_at is null` guard), so it can never
 * silently overwrite the timestamp of an address that genuinely did prove
 * itself through the ordinary door first.
 */
export async function confirmContactByOwner(owner: string, contactId: string): Promise<void> {
  const { db } = await getDatabase();
  await db
    .updateTable("contacts")
    .set({ confirmed_at: nowIso(), updated_at: nowIso() })
    .where("owner_id", "=", owner)
    .where("id", "=", contactId)
    .where("confirmed_at", "is", null)
    .execute();
}

export type GrantAccessResult =
  | { ok: true; contact: ContactRecord }
  | { ok: false; error: "blocked_contact" };

/**
 * D11 — "an owner grants a named address direct access" (spec §8, and see
 * `AGENTS.md`'s own amended sentence). The address can read the journal the
 * moment this call returns. The route that used to mail this event
 * (`sendGrantedMail`, `/api/helper/[user]/reader/grant`) is gone since B2295
 * (one door for readers, B2291/B2292): `/<user>/studio/readers`'s own "add a
 * person" flow is the one door now, and it sends its own mail
 * (`sendWelcomeMail`) at the moment the owner presses a channel, not here.
 *
 * **What does not change.** A *link* still grants nothing — this writes a
 * real `access_grants` row from the server, never from a token somebody
 * could forward. `requestContact` → `confirmContactByOwner` →
 * `approveContact` is the same three calls `addSelfContact` already chains
 * for the owner's own row; this is that shape, for an address that is not
 * the owner's.
 */
export async function grantContactAccess(
  owner: string,
  input: { name: string; email: string; locale: Locale },
): Promise<GrantAccessResult> {
  const result = await requestContact(owner, {
    name: input.name,
    email: input.email,
    locale: input.locale,
    wantsEmailDigest: false,
    wantsPostcard: false,
    wantsWhatsapp: false,
    createdVia: "owner-grant",
  });
  if (result.outcome === "ignored" || !result.contactId) {
    return { ok: false, error: "blocked_contact" };
  }
  await confirmContactByOwner(owner, result.contactId);
  const approved = await approveContact(owner, result.contactId);
  if (!approved) return { ok: false, error: "blocked_contact" };
  return { ok: true, contact: approved.contact };
}

export type AddSelfResult =
  | { ok: true; contact: ContactRecord }
  | { ok: false; error: "no_owner_email" | "blocked_contact" | "not_confirmed" };

/**
 * The owner, added as their own contact — B1393.
 *
 * Extracted from `app/api/contacts/admin/route.ts`'s `"self"` action so the
 * helper's `add_contact` tool can press the same button rather than a second
 * one beside it. **The name and address come from this journal's own
 * `config.json`, never from an argument** — the caller (the admin route's own
 * `isOwner` guard, or the helper's `isHelperOwner`) has already proved the
 * request is the owner; what they may add is themselves and nobody else.
 *
 * No mail here: `confirmContactFromSession` is confirming an address this
 * journal already knows is the owner's, not one a request is merely
 * asserting, so the row goes straight to `active` — with `EMPTY_ADDRESS` and
 * every consent off. That is not "a recipient" by any of `eligible()`'s three
 * tests (B1399); it is somewhere for the owner to fill in an address and tick
 * the postcard box on their own page.
 */
export async function addSelfContact(owner: string): Promise<AddSelfResult> {
  const user = getUser(owner);
  const email = user?.owner.email;
  if (!user || !email) return { ok: false, error: "no_owner_email" };

  const normalised = normaliseEmail(email);
  const existing = (await listContacts(owner)).find((c) => c.email === normalised);
  if (existing) return { ok: true, contact: existing };

  const result = await requestContact(owner, {
    name: user.owner.nickname || user.owner.name,
    email,
    locale: pickLocale(null, user.defaultLocale),
    address: EMPTY_ADDRESS,
    wantsEmailDigest: false,
    wantsPostcard: false,
    wantsWhatsapp: false,
    createdVia: "owner-self",
  });
  if (result.outcome === "ignored" || !result.contactId) {
    return { ok: false, error: "blocked_contact" };
  }

  const confirmed = await confirmContactFromSession(owner, email);
  if (!confirmed.ok) return { ok: false, error: "not_confirmed" };
  const approved = await approveContact(owner, confirmed.contact.id);
  if (!approved) return { ok: false, error: "not_confirmed" };

  return { ok: true, contact: approved.contact };
}

/**
 * Take it back.
 *
 * The grants go — including every place on a trip, so a buddy loses the trip
 * as well as the journal; the record stays, so they cannot simply re-request
 * their way back in through the form.
 *
 * **Reversible by the owner, and by nobody else** — B213. Approving again puts
 * back both halves: the `access_grants` row is written fresh, and since B213
 * the trip places are un-marked too, so an owner who revoked somebody by
 * mistake has a way back that is not a database edit. The person on the other
 * end still has none — every door they could push on refuses a `blocked`
 * contact before it writes anything.
 */
export async function revokeContact(owner: string, id: string): Promise<ContactRecord | null> {
  const { db } = await getDatabase();
  await db
    .updateTable("contacts")
    .set({ status: "blocked", updated_at: nowIso() })
    .where("owner_id", "=", owner)
    .where("id", "=", id)
    .execute();
  await db
    .deleteFrom("access_grants")
    .where("owner_id", "=", owner)
    .where("contact_id", "=", id)
    .execute();
  await revokeTripPlaces(owner, id);
  return getContact(owner, id);
}

/**
 * The owner correcting somebody's details.
 *
 * Keyed on **id**, not on the address, because the commonest correction is the
 * address itself — `requestContact` would write a second row for the new one
 * and leave the old behind.
 *
 * Deliberately cannot *set* `status` to anything the caller chooses.
 * Approving is `approveContact`, and it refuses an unconfirmed address on
 * purpose; a general-purpose editor that let the caller choose `status`
 * would be a way around that refusal.
 *
 * One exception, and it goes only one direction. Changing the email on an
 * `active`, confirmed row would otherwise leave `status: "active"`,
 * `confirmed_at` set, and the `access_grants` row untouched — an address
 * nobody has proved they can read, sitting behind a `guest`-visibility trip,
 * reached without ever going through `approveContact`'s refusal.
 * `resolveViewer` (`lib/viewer.ts`) looks a contact up by email and grants
 * `guest` the moment `status === "active"`, so that gap is not theoretical:
 * it is the exact escalation `approveContact` exists to block, through a side
 * door. So an email change knocks a previously-active row back to `pending`
 * and clears its confirmation and its grants — the same shape
 * `revokeContact` already writes, because the effect is the same one:
 * whoever holds the new address has to confirm and be approved again, same
 * as anyone else.
 */
/**
 * Thrown by `updateContactByOwner` on a self-authored row — B1395.
 *
 * A row created through `/api/contacts/self` (`created_via` starting
 * `self:`) is a person's own statement about themselves, given by the
 * address it names. Option A of B1395 decided that once such a row exists,
 * it wins: the owner may still see it, revoke it (`revokeContact`) or delete
 * it (`deleteContact`) — neither of those goes through here — but cannot
 * silently rewrite what the person wrote. A postcard proposal stores only a
 * `contactId` and re-reads the address live at send (`paid/postcard/lib/postcard/orders.ts`),
 * so an owner overwrite would otherwise change what an already-reviewed card
 * prints with nothing on the review page saying the address moved.
 */
export class SelfAuthoredContactError extends Error {}

export async function updateContactByOwner(
  owner: string,
  id: string,
  fields: {
    name?: string;
    email?: string;
    locale?: Locale;
    address?: Partial<PostalAddress> | null;
    wantsEmailDigest?: boolean;
    wantsPostcard?: boolean;
    wantsWhatsapp?: boolean;
  },
): Promise<ContactRecord | null> {
  const { db } = await getDatabase();
  const existing = await db
    .selectFrom("contacts")
    .selectAll()
    .where("owner_id", "=", owner)
    .where("id", "=", id)
    .executeTakeFirst();
  if (!existing) return null;

  // Every field this function can write is a field the person themselves
  // authored on a self-authored row — see `SelfAuthoredContactError`. There
  // is nothing left for the owner to change here once any field is given;
  // `revokeContact` and `deleteContact` are the doors that still work.
  if ((existing.created_via ?? "").startsWith("self:") && Object.keys(fields).length > 0) {
    throw new SelfAuthoredContactError(
      `contact ${id} was written by its own address and cannot be edited by the owner`,
    );
  }

  const patch: Record<string, unknown> = { updated_at: nowIso() };
  let emailChanged = false;
  if (fields.name !== undefined) patch.name = fields.name.trim().slice(0, 120) || null;
  if (fields.email !== undefined) {
    const email = normaliseEmail(fields.email);
    emailChanged = email !== existing.email_key;
    patch.email = email;
    patch.email_key = email;
  }
  if (fields.locale !== undefined) patch.locale = fields.locale;
  if (fields.wantsEmailDigest !== undefined) {
    patch.wants_email_digest = fields.wantsEmailDigest ? 1 : 0;
  }
  if (fields.address !== undefined) {
    const address = normaliseAddress(fields.address);
    // Keep the blob whenever anything is in it, not only when it is postable
    // — a phone-number-only correction must not be silently discarded.
    Object.assign(patch, await addressColumns(owner, id, hasAnyDetail(address) ? address : null, "owner"));
    // Wanting a postcard with nowhere to send it is not a state worth storing.
    if (!isPostable(address)) patch.wants_postcard = 0;
    // And the same for the number: an owner who clears it has ended the
    // WhatsApp consent whether or not they touched its box.
    if (!isMessageable(address.tel, whatsappCountryCode())) patch.wants_whatsapp = 0;
  }
  if (fields.wantsPostcard !== undefined && patch.wants_postcard === undefined) {
    patch.wants_postcard = fields.wantsPostcard ? 1 : 0;
  }
  if (fields.wantsWhatsapp !== undefined && patch.wants_whatsapp === undefined) {
    patch.wants_whatsapp = fields.wantsWhatsapp ? 1 : 0;
  }

  if (emailChanged) {
    // Downgrading is not the escalation `status` is otherwise off-limits for
    // — it serves the same refusal `approveContact` makes, just reached from
    // the other side.
    patch.status = "pending";
    patch.confirmed_at = null;
  }

  // `owner_id` on the write itself, not only on the SELECT above — defence in
  // depth. Safe today only because that SELECT is owner-scoped and `id` is
  // the table's global primary key; this costs nothing and removes the
  // dependency on both of those staying true together.
  await db
    .updateTable("contacts")
    .set(patch)
    .where("id", "=", id)
    .where("owner_id", "=", owner)
    .execute();

  if (emailChanged) {
    await db
      .deleteFrom("access_grants")
      .where("owner_id", "=", owner)
      .where("contact_id", "=", id)
      .execute();
    // And their places on trips, for exactly the same reason: `peopleOf` reads
    // this row's address, so leaving a granted place behind would put a new,
    // unproved address on somebody's trip with write access to it — the
    // escalation this whole branch exists to close, one table along.
    await revokeTripPlaces(owner, id);
  }

  return getContact(owner, id);
}

export type AddContactInput = {
  name: string;
  /** At least one of `email` and `phone`. */
  email?: string | null;
  /** As typed; any country (`toE164`, with the instance's default country
   * code for a national number). */
  phone?: string | null;
  locale: Locale;
  /** `owner` for somebody the owner added, or whichever door brought them. */
  createdVia: string;
};

export type AddContactResult =
  | { ok: true; outcome: "created" | "updated"; contact: ContactRecord }
  | {
      ok: false;
      error: "no_channel" | "invalid_email" | "invalid_phone" | "blocked_contact" | "conflict";
    };

/**
 * A contact with an email address, a mobile number, or both — B2294.
 *
 * `requestContact` is keyed on the address, because every door it serves
 * starts from one. A person the owner knows only by their mobile number has
 * none, so this is keyed on whichever the caller has: an existing contact
 * found by either is updated, one found by neither is created `pending`,
 * nothing is granted, nothing is mailed or sent. Pre-approving is still
 * `confirmContactByOwner` then `approveContact`, as `grantContactAccess` does.
 *
 * Refuses (`conflict`) rather than merges when the address and the number
 * belong to two different contacts, or when the contact found by the number
 * already has a different address — changing an address is
 * `updateContactByOwner`'s, which takes the old one's access away with it.
 *
 * `contacts.email` is `NOT NULL` (see `038-contact-phone`): a phone-only
 * contact stores `""`, and an `email_key` no address can ever equal.
 */
export async function addContact(owner: string, input: AddContactInput): Promise<AddContactResult> {
  return saveContact(owner, input, "owner");
}

export type AddPersonResult =
  | { ok: true; outcome: "created" | "updated"; contact: ContactRecord }
  | { ok: false; error: Exclude<AddContactResult, { ok: true }>["error"] | "not_approved" };

/**
 * "Add a person" — step 1 of B2291's first door, B2292's server half.
 *
 * The owner names somebody (email and/or mobile), and they are **pre-
 * approved**: `addContact` (owner trust — the number becomes a sign-in
 * number), then `confirmContactByOwner` + `approveContact`, the chain
 * `grantContactAccess` has always used. A buddy is asked onto their trip first
 * (`claimTripPlace`) so the same approval opens it, exactly as approving a
 * buddy-link request does.
 *
 * Nothing is sent: telling the person is step 2 (`./welcome` `sendInvite`).
 * An existing contact keeps every consent it had (`addContact` never touches
 * them), and a blocked one is refused — letting somebody back in is the
 * owner's explicit Let-in on their card, never a side effect of typing their
 * address again.
 */
export async function addPersonByOwner(
  owner: string,
  input: Omit<AddContactInput, "createdVia"> & { buddyTripId?: string | null },
): Promise<AddPersonResult> {
  const added = await addContact(owner, { ...input, createdVia: "owner" });
  if (!added.ok) return added;
  if (input.buddyTripId) {
    await claimTripPlace(owner, input.buddyTripId, added.contact.id, null);
  }
  await confirmContactByOwner(owner, added.contact.id);
  // Only the trip named here, never another pending or revoked place (M1).
  const approved = await approveContact(owner, added.contact.id, { onlyTrip: input.buddyTripId ?? null });
  if (!approved) return { ok: false, error: "not_approved" };
  return { ok: true, outcome: added.outcome, contact: approved.contact };
}

/**
 * A brand-new contact whose first channel is a number an SMS code has just
 * proved — B2294 (c), the join link's visitor. Keyed and stamped proven,
 * created `pending`, granted nothing. Only `proveFirstPhone`
 * (`./guestCode.ts`) calls this, after `verifyCode` has succeeded.
 */
export async function addContactWithProvenPhone(
  owner: string,
  input: Omit<AddContactInput, "email"> & { phone: string },
): Promise<AddContactResult> {
  return saveContact(owner, input, "proven");
}

/**
 * A number an SMS code has just proved for an existing contact — B2294 (b),
 * the signed-in reader adding their mobile. Takes the number's key from
 * whoever held it. The caller has redeemed the code (`confirmPhoneProof`).
 */
export async function setProvenPhone(owner: string, contactId: string, tel: string): Promise<void> {
  const { db } = await getDatabase();
  await db
    .updateTable("contacts")
    .set({ ...(await phoneColumns(owner, contactId, tel, "proven")), updated_at: nowIso() })
    .where("owner_id", "=", owner)
    .where("id", "=", contactId)
    .execute();
}

async function saveContact(
  owner: string,
  input: AddContactInput,
  trust: "owner" | "proven",
): Promise<AddContactResult> {
  const email = input.email?.trim() ? normaliseEmail(input.email) : null;
  const tel = input.phone?.trim() ?? "";
  if (!email && !tel) return { ok: false, error: "no_channel" };
  if (email && !isEmail(email)) return { ok: false, error: "invalid_email" };
  const digits = tel ? toE164(tel, whatsappCountryCode()) : null;
  if (tel && !digits) return { ok: false, error: "invalid_phone" };

  const byEmail = email ? await getContactByEmail(owner, email) : null;
  const byPhone = digits ? await getContactByEmail(owner, phoneSubject(digits)) : null;
  if (byEmail && byPhone && byEmail.id !== byPhone.id) return { ok: false, error: "conflict" };
  const existing = byEmail ?? byPhone;
  if (existing?.status === "blocked") return { ok: false, error: "blocked_contact" };
  if (existing && email && existing.email && existing.email !== email) {
    return { ok: false, error: "conflict" };
  }

  const { db } = await getDatabase();
  const id = existing?.id ?? newId();
  const now = nowIso();
  const name = input.name.trim().slice(0, 120) || null;
  const phone = tel ? await phoneColumns(owner, id, tel, trust, Boolean(existing)) : null;

  if (existing) {
    await db
      .updateTable("contacts")
      .set({
        name: name ?? existing.name,
        locale: input.locale,
        ...(email && !existing.email ? { email, email_key: email } : {}),
        ...(phone ?? {}),
        updated_at: now,
      })
      .where("owner_id", "=", owner)
      .where("id", "=", id)
      .execute();
  } else {
    await db
      .insertInto("contacts")
      .values({
        id,
        owner_id: owner,
        email: email ?? "",
        email_key: email ?? noEmailKey(id),
        name,
        locale: input.locale,
        status: "pending",
        notes: null,
        created_at: now,
        updated_at: now,
        postal_cipher: null,
        ...(phone ?? { phone_cipher: null, phone_key: null, phone_proven_at: null }),
        wants_email_digest: 0,
        wants_postcard: 0,
        wants_whatsapp: 0,
        created_via: input.createdVia,
        confirmed_at: null,
        approved_at: null,
        last_seen_at: null,
        manage_token_hash: hashSecret(manageTokenFor(owner, id)),
      })
      .execute();
  }

  const contact = await getContact(owner, id);
  if (!contact) return { ok: false, error: "conflict" };
  return { ok: true, outcome: existing ? "updated" : "created", contact };
}

/** The `email_key` of a contact with no address: unique, and never equal to
 * a case-folded address, which always has an `@`. */
function noEmailKey(id: string): string {
  return `no-email:${id}`;
}

/**
 * An SMS code just proved this number — stamp it on the contact it belongs
 * to (B2294). Leaves an earlier stamp alone, like `confirmed_at`.
 */
export async function markContactPhoneProven(owner: string, digits: string): Promise<void> {
  if (!hasContactsKey()) return;
  const { db } = await getDatabase();
  await db
    .updateTable("contacts")
    .set({ phone_proven_at: nowIso(), updated_at: nowIso() })
    .where("owner_id", "=", owner)
    .where("phone_key", "=", phoneKey(digits))
    .where("phone_proven_at", "is", null)
    .execute();
}

/** The self-serve page: change anything, or leave. */
export function manageUrl(base: string, username: string, token: string): string {
  return `${base}/${username}/c/${token}`;
}

/**
 * What goes in `List-Unsubscribe`.
 *
 * A different URL from `manageUrl` because it answers a POST as well as a GET —
 * see `app/[user]/u/[token]/route.ts`. A mail client's own unsubscribe button
 * stops everything at once; a person following the footer link lands on their
 * details page instead of being unsubscribed by a link scanner.
 */
export function unsubscribeUrlFor(base: string, username: string, token: string): string {
  return `${base}/${username}/u/${token}`;
}

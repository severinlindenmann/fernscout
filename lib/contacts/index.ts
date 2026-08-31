import "server-only";
import crypto from "node:crypto";
import { hashSecret, resolveSession, revokeSession, verifyCode } from "../auth";
import { getDatabase, newId, nowIso } from "../db";
import type { Locale } from "../types";
import {
  addressAad,
  contactsKey,
  decryptAddress,
  encryptAddress,
  hasAnyDetail,
  isPostable,
  normaliseAddress,
  type PostalAddress,
} from "./crypto";
import { countInviteUse } from "./invites";
import { parseLocale } from "./locale";

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
 * let them in. That separation is decision 19: a link may be forwarded around a
 * family group chat freely, because reaching the form is not access — every
 * person who fills it in becomes their own pending row and waits for the owner.
 *
 * ## What is never in the clear
 *
 * The postal address (AES-256-GCM, `./crypto.ts`) and the self-serve manage
 * token (sha-256). Neither is ever logged, and the address is never returned to
 * anyone but the owner and the person it belongs to.
 */

export type ContactStatus = "pending" | "active" | "blocked";

/** The owner's view of somebody. Includes the address: they need it to post. */
export type ContactRecord = {
  id: string;
  name: string | null;
  email: string;
  locale: Locale | null;
  status: ContactStatus;
  wantsEmailDigest: boolean;
  wantsPostcard: boolean;
  hasPostalAddress: boolean;
  postalAddress: PostalAddress | null;
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
  postal_cipher: string | null;
  created_via: string | null;
  created_at: string;
  updated_at: string;
  confirmed_at: string | null;
  approved_at: string | null;
  last_seen_at: string | null;
  manage_token_hash: string | null;
};

function toRecord(owner: string, row: ContactRow): ContactRecord {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    locale: parseLocale(row.locale),
    status: toStatus(row.status),
    wantsEmailDigest: toBool(row.wants_email_digest),
    wantsPostcard: toBool(row.wants_postcard),
    hasPostalAddress: row.postal_cipher !== null,
    postalAddress: decryptAddress(row.postal_cipher, addressAad(owner, row.id)),
    createdVia: row.created_via,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at,
    approvedAt: row.approved_at,
    lastSeenAt: row.last_seen_at,
  };
}

export type ContactRequestInput = {
  name: string;
  email: string;
  locale: Locale;
  address?: Partial<PostalAddress> | null;
  wantsEmailDigest: boolean;
  wantsPostcard: boolean;
  /** `invite:<id>` | `open` | `owner`. */
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
  const { db } = await getDatabase();
  const email = normaliseEmail(input.email);
  const now = nowIso();
  const name = input.name.trim().slice(0, 120);

  const address = normaliseAddress(input.address);
  const wantsPostcard = input.wantsPostcard && isPostable(address);

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
  const cipher = hasAnyDetail(address)
    ? encryptAddress(address, addressAad(owner, id))
    : // Nothing at all was given — not even a phone number — so there is
      // nothing to keep. Unticking the postcard box and clearing every field
      // is a deletion, not a no-op: the address stops existing rather than
      // lingering unused. A phone number on its own is not `isPostable`, but
      // it is not nothing either, and must not be discarded here.
      null;

  if (existing) {
    await db
      .updateTable("contacts")
      .set({
        name: name || existing.name,
        email,
        locale: input.locale,
        postal_cipher: cipher,
        wants_email_digest: input.wantsEmailDigest ? 1 : 0,
        wants_postcard: wantsPostcard ? 1 : 0,
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
        postal_cipher: cipher,
        wants_email_digest: input.wantsEmailDigest ? 1 : 0,
        wants_postcard: wantsPostcard ? 1 : 0,
        created_via: input.createdVia,
        confirmed_at: null,
        approved_at: null,
        last_seen_at: null,
        // Known from the moment the row exists, and told to nobody until the
        // address has been confirmed.
        manage_token_hash: hashSecret(manageTokenFor(owner, id)),
      })
      .execute();
  }

  if (input.inviteId) await countInviteUse(owner, input.inviteId);

  return { outcome: existing ? "updated" : "created", contactId: id };
}

export type ConfirmResult =
  | { ok: true; contact: ContactRecord; manageToken: string; firstConfirmation: boolean }
  | { ok: false };

/**
 * Double opt-in (C12), on W08's code path.
 *
 * The one-time code machinery is not reimplemented here — `verifyCode` is the
 * same function the sign-in route uses, which is why "the code is single use",
 * "five wrong guesses burn it" and "ten minutes" are true here for free.
 *
 * The session it mints is revoked on the spot. Confirming an address is not
 * signing in: nobody is handed the token, and leaving a live row behind for a
 * credential that was never issued would be a loose end in the sessions table.
 */
export async function confirmContact(
  owner: string,
  email: string,
  code: string,
): Promise<ConfirmResult> {
  const address = normaliseEmail(email);
  const verified = await verifyCode(owner, address, code, "guest");
  if (!verified.ok) return { ok: false };

  const session = await resolveSession(verified.token, "guest");
  if (session) await revokeSession(session.id);

  const { db } = await getDatabase();
  const row = await db
    .selectFrom("contacts")
    .selectAll()
    .where("owner_id", "=", owner)
    .where("email_key", "=", address)
    .executeTakeFirst();

  // A valid code with no contact behind it means somebody signed in through
  // the auth route and then posted here. Nothing to confirm.
  if (!row) return { ok: false };
  if (toStatus(row.status) === "blocked") return { ok: false };

  const manageToken = manageTokenFor(owner, row.id);
  const now = nowIso();
  const firstConfirmation = row.confirmed_at === null;

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
  return { ok: true, contact: toRecord(owner, fresh), manageToken, firstConfirmation };
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
  // The guest's own manage form (`ContactManage.tsx`) has no `tel` field, so
  // every save resends the address it knows about with `tel` empty — even a
  // save that only touched a preference checkbox, because the form posts the
  // whole address on every submit. Carry the existing number forward unless
  // the caller actually supplied a new, non-empty one.
  const address =
    submittedAddress === undefined
      ? undefined
      : {
          ...submittedAddress,
          tel:
            submittedAddress.tel.trim() !== ""
              ? submittedAddress.tel
              : (current.postalAddress?.tel ?? ""),
        };

  const wantsPostcard = patch.wantsPostcard ?? current.wantsPostcard;
  // `isPostable` is the wrong gate for whether to keep the blob at all — a
  // record holding only a phone number is worth keeping, same as
  // `requestContact` and `updateContactByOwner`.
  const keepAddress =
    address === undefined
      ? current.postalAddress
      : hasAnyDetail(address)
        ? address
        : null;

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
      postal_cipher: keepAddress
        ? encryptAddress(keepAddress, addressAad(owner, current.id))
        : null,
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
    .set({ wants_email_digest: 0, wants_postcard: 0, updated_at: nowIso() })
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
 */
export async function approveContact(
  owner: string,
  id: string,
): Promise<ContactRecord | null> {
  const contact = await getContact(owner, id);
  if (!contact) return null;
  if (!contact.confirmedAt) return null;

  const { db } = await getDatabase();
  const now = nowIso();
  await db
    .updateTable("contacts")
    .set({ status: "active", approved_at: contact.approvedAt ?? now, updated_at: now })
    .where("id", "=", id)
    .execute();

  const grant = await db
    .selectFrom("access_grants")
    .select(["id"])
    .where("owner_id", "=", owner)
    .where("contact_id", "=", id)
    .where("trip_id", "=", "*")
    .where("scope", "=", "read")
    .executeTakeFirst();

  if (!grant) {
    await db
      .insertInto("access_grants")
      .values({
        id: newId(),
        owner_id: owner,
        contact_id: id,
        // Every trip. Per-trip grants are W09's job; this is the "they may
        // read what is not password-protected" grant.
        trip_id: "*",
        scope: "read",
        granted_at: now,
        granted_by: owner,
        expires_at: null,
      })
      .execute();
  }

  return getContact(owner, id);
}

/** Take it back. The grants go; the record stays, so they cannot simply
 * re-request their way back in through the form. */
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
    patch.postal_cipher = hasAnyDetail(address)
      ? encryptAddress(address, addressAad(owner, id))
      : null;
    // Wanting a postcard with nowhere to send it is not a state worth storing.
    if (!isPostable(address)) patch.wants_postcard = 0;
  }
  if (fields.wantsPostcard !== undefined && patch.wants_postcard === undefined) {
    patch.wants_postcard = fields.wantsPostcard ? 1 : 0;
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
  }

  return getContact(owner, id);
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

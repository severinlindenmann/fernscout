import "server-only";
import crypto from "node:crypto";

/**
 * A contact's private details, encrypted at rest (C14): the postal address —
 * most of what is here — and, alongside it, a telephone number.
 *
 * Fifty named people's home addresses are a different risk class from anything
 * else in this repository. Everything else here is a holiday photograph; this
 * is the list a burglar would want. So it is the one thing that is never
 * stored in a form the database can read.
 *
 * **AES-256-GCM**, key from `CONTACTS_ENCRYPTION_KEY` — environment only, never
 * `content/config.json`, which is a file people commit. GCM rather than CBC
 * because it authenticates as well as hides: a row that has been edited in the
 * database fails to decrypt instead of quietly becoming a different address.
 *
 * The **additional authenticated data** is `<owner>:<contact id>`. That binds a
 * ciphertext to the row it belongs to, so copying one contact's blob into
 * another row — by hand, or through a bug in an importer — produces an
 * unreadable address rather than somebody else's.
 *
 * Nothing in this module logs a plaintext, a ciphertext or a key, and neither
 * may its callers. The one warning it emits names an id and nothing else.
 */

export type PostalAddress = {
  /** Who the envelope is addressed to. Often, but not always, `contact.name`. */
  name: string;
  line1: string;
  line2: string;
  postcode: string;
  city: string;
  country: string;
  /**
   * A telephone number, if they gave one.
   *
   * In here rather than in a column of its own, for the reason
   * `003-contacts.ts` gives about the address: this is the same class of data,
   * and a plaintext column beside an encrypted blob is a way of leaking half of
   * what the blob exists to protect. It is not part of `isPostable` — a number
   * is not somewhere to send a card.
   */
  tel: string;
};

export const EMPTY_ADDRESS: PostalAddress = {
  name: "",
  line1: "",
  line2: "",
  postcode: "",
  city: "",
  country: "",
  tel: "",
};

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
/** The format marker. A second scheme one day gets `v2` and both stay readable. */
const VERSION = "v1";

export class ContactsKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContactsKeyError";
  }
}

/**
 * The key, decoded.
 *
 * Accepts 64 hex characters or 32 bytes of base64 — the two forms `openssl
 * rand` prints — and refuses anything else loudly. A short key silently
 * padded to length is the classic way to end up with encryption that is not.
 *
 * Deliberately not memoised: it is a few microseconds, and tests change the
 * variable between cases.
 */
export function contactsKey(): Buffer {
  const raw = process.env.CONTACTS_ENCRYPTION_KEY;
  if (!raw || raw.trim() === "") {
    throw new ContactsKeyError(
      "CONTACTS_ENCRYPTION_KEY is not set. Generate one with `openssl rand -hex 32`.",
    );
  }
  const trimmed = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return Buffer.from(trimmed, "hex");

  const decoded = Buffer.from(trimmed, "base64");
  if (decoded.length === KEY_BYTES) return decoded;

  throw new ContactsKeyError(
    "CONTACTS_ENCRYPTION_KEY must be 32 bytes: 64 hex characters, or base64. " +
      "Generate one with `openssl rand -hex 32`.",
  );
}

/** Is there a usable key? Used to decide whether to offer the address field. */
export function hasContactsKey(): boolean {
  try {
    contactsKey();
    return true;
  } catch {
    return false;
  }
}

/** What a ciphertext is bound to. Changing this invalidates existing rows. */
export function addressAad(owner: string, contactId: string): string {
  return `${owner}:${contactId}`;
}

/**
 * The same, for an invite link's token — B280.
 *
 * A distinct prefix rather than the bare `<owner>:<id>` an address uses, so
 * that the two namespaces cannot collide: ids come from `newId()` in both
 * tables, and an AAD that happened to match would let a blob move between a
 * contact row and an invite row and still decrypt. It never could in practice;
 * the prefix means it never can in principle.
 */
export function inviteAad(owner: string, inviteId: string): string {
  return `invite:${owner}:${inviteId}`;
}

function b64(buffer: Buffer): string {
  return buffer.toString("base64url");
}

/** True when a postal address has enough in it to put on an envelope. */
export function isPostable(address: PostalAddress): boolean {
  return (
    address.line1.trim() !== "" && address.city.trim() !== "" && address.country.trim() !== ""
  );
}

/**
 * True when there is anything at all worth keeping in the blob — not
 * necessarily enough to post to.
 *
 * A distinct question from `isPostable`, on purpose. A phone number with no
 * street is not somewhere to send a card, but it is not nothing either: a
 * write path that only encrypts and stores the blob when `isPostable(address)`
 * is true silently drops a phone-number-only contact, which is the one thing
 * this field exists for. `isPostable` keeps meaning exactly what it always
 * has — governs the postcard consent, nothing else — and this governs whether
 * the ciphertext is written at all.
 */
export function hasAnyDetail(address: PostalAddress): boolean {
  return (
    address.name.trim() !== "" ||
    address.line1.trim() !== "" ||
    address.line2.trim() !== "" ||
    address.postcode.trim() !== "" ||
    address.city.trim() !== "" ||
    address.country.trim() !== "" ||
    address.tel.trim() !== ""
  );
}

export function normaliseAddress(input: Partial<PostalAddress> | null | undefined): PostalAddress {
  const field = (value: unknown) => (typeof value === "string" ? value.trim().slice(0, 120) : "");
  return {
    name: field(input?.name),
    line1: field(input?.line1),
    line2: field(input?.line2),
    postcode: field(input?.postcode),
    city: field(input?.city),
    country: field(input?.country),
    tel: field(input?.tel),
  };
}

/**
 * Encrypt one address.
 *
 * The stored form is `v1.<iv>.<tag>.<ciphertext>`, each part base64url. Four
 * parts rather than one concatenated blob so that a future change of scheme is
 * a parser branch and not an archaeology exercise.
 */
export function encryptAddress(address: PostalAddress, aad: string): string {
  return encryptString(JSON.stringify(address), aad);
}

/**
 * One string, in the stored form above.
 *
 * Extracted from `encryptAddress` when B280 needed the same scheme for an
 * invite token, which is a string rather than a record. The wire format, the
 * version prefix and the AAD discipline are therefore shared by construction:
 * two copies of this would be two schemes to keep in step, and the day they
 * drifted would be a day of unreadable rows.
 */
export function encryptString(plain: string, aad: string): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, contactsKey(), iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, b64(iv), b64(cipher.getAuthTag()), b64(body)].join(".");
}

/**
 * Decrypt one address, or `null`.
 *
 * Null rather than a throw, because one unreadable row — a key rotated without
 * re-encrypting, a blob edited by hand — must not take the whole guest list
 * offline. The warning carries no data, only the reason.
 */
export function decryptAddress(stored: string | null, aad: string): PostalAddress | null {
  const plain = decryptString(stored, aad, "address");
  if (plain === null) return null;
  try {
    return normaliseAddress(JSON.parse(plain) as Partial<PostalAddress>);
  } catch {
    console.warn("[contacts] a stored address decrypted to something that is not an address");
    return null;
  }
}

/**
 * One string back, or `null`.
 *
 * Null rather than a throw, because one unreadable row — a key rotated without
 * re-encrypting, a blob edited by hand — must not take the whole guest list
 * offline. `what` names the kind of value in the warning so the two callers are
 * distinguishable in a log; it is a constant at every call site and never
 * anything read from a row.
 */
export function decryptString(
  stored: string | null,
  aad: string,
  what: "address" | "invite token",
): string | null {
  if (!stored) return null;
  const parts = stored.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    console.warn(`[contacts] a stored ${what} is not in a format this build understands`);
    return null;
  }
  try {
    const [, iv, tag, body] = parts;
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      contactsKey(),
      Buffer.from(iv, "base64url"),
    );
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(body, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // Wrong key, tampered row, or a ciphertext that belongs to a different
    // row. Never log the value — that would undo the point of the column.
    console.warn(`[contacts] a stored ${what} could not be decrypted with this key`);
    return null;
  }
}

import "server-only";
import { cache } from "react";
import { getDatabaseOrNull, nowIso } from "./db";
import {
  decryptAddress,
  encryptAddress,
  hasContactsKey,
  normaliseAddress,
  type PostalAddress,
} from "./contacts/crypto";
import { phoneSubject, subjectPhone, toE164 } from "./phone";
import { getUser, getUsernames } from "./users";

/**
 * One person across email and phone — B-3007.
 *
 * A sign-in subject is an address or a proved number as `+<digits>`
 * (`phoneSubject`). Two subjects are the same person when one browser proved
 * both (`person_links`), or when the number is a journal owner's own proven
 * number (`owner_tel`, or the journal file before that table) — that number
 * was proved by the owner signed in as the owner's address, which is the same
 * proof a link records.
 *
 * Never a number an owner typed onto a contact: that proves nothing about who
 * holds it.
 *
 * The canonical subject is the address when there is one. A session for a
 * linked number therefore resolves as the address (`lookUpSession`), and the
 * owner and operator checks, which compare addresses, hold for it.
 */

function normalise(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Every owner's proven number, as `{ email, digits }`.
 *
 * Read live rather than copied into `person_links`, so a changed or cleared
 * owner number follows at once. One query over `owner_tel` (a row per journal
 * at most) plus the in-memory journal list; asked only for a phone subject or
 * on a contact lookup that missed, and once per request (`cache`, a pass-through
 * outside one — see `resolveSession`).
 */
const ownerNumbers = cache(readOwnerNumbers);

async function readOwnerNumbers(): Promise<{ email: string; digits: string }[]> {
  const handle = await getDatabaseOrNull();
  const rows = handle
    ? await handle.db.selectFrom("owner_tel").select(["owner_id", "tel", "proven_at"]).execute()
    : [];
  const byJournal = new Map(rows.map((row) => [row.owner_id, row]));
  const out: { email: string; digits: string }[] = [];
  for (const username of getUsernames()) {
    const user = getUser(username);
    const email = user?.owner.email ? normalise(user.owner.email) : "";
    if (!email) continue;
    // A row is authoritative, `tel: null` included (lib/ownerTel.ts).
    const row = byJournal.get(username);
    const tel = row ? row.tel : (user?.owner.tel ?? null);
    const proven = row ? row.proven_at : (user?.owner.telProvenAt ?? null);
    const digits = tel && proven ? toE164(tel) : null;
    if (digits) out.push({ email, digits });
  }
  return out;
}

/** The address a proved number belongs to, or null. Ambiguous owner numbers
 * (one number, two owners' addresses) link to nobody. */
export async function linkedEmail(digits: string): Promise<string | null> {
  const handle = await getDatabaseOrNull();
  if (!handle) return null;
  const row = await handle.db
    .selectFrom("person_links")
    .select("email")
    .where("phone", "=", digits)
    .executeTakeFirst();
  if (row) return row.email;
  const owners = new Set((await ownerNumbers()).filter((o) => o.digits === digits).map((o) => o.email));
  return owners.size === 1 ? [...owners][0] : null;
}

/** Every proved number of an address: its link, and the numbers of the
 * journals it owns. */
export async function linkedPhones(email: string): Promise<string[]> {
  const handle = await getDatabaseOrNull();
  if (!handle) return [];
  const address = normalise(email);
  const row = await handle.db
    .selectFrom("person_links")
    .select("phone")
    .where("email", "=", address)
    .executeTakeFirst();
  const out = new Set<string>(row ? [row.phone] : []);
  for (const owner of await ownerNumbers()) {
    // Only when the number is not somebody else's link, and not shared with
    // another owner — `linkedEmail` has to agree, or the pair is no pair.
    if (owner.email === address && (await linkedEmail(owner.digits)) === address) out.add(owner.digits);
  }
  return [...out];
}

/** The subject a session should act as: the address for a linked number,
 * else the subject unchanged. */
export const canonicalSubject = cache(lookUpCanonical);

async function lookUpCanonical(subject: string): Promise<string> {
  const digits = subjectPhone(subject);
  if (!digits) return subject;
  return (await linkedEmail(digits)) ?? subject;
}

/** Every subject of the person behind one, canonical first. */
export const subjectsOf = cache(lookUpSubjects);

async function lookUpSubjects(subject: string): Promise<string[]> {
  const canonical = await canonicalSubject(subject);
  if (subjectPhone(canonical)) return [canonical];
  return [canonical, ...(await linkedPhones(canonical)).map(phoneSubject)];
}

export type LinkResult = { ok: true } | { ok: false; reason: "taken" };

/**
 * Pair an address with a number — only after one browser proved both.
 *
 * The one caller is `POST /api/auth/codes/redeem` with `link: true`: the
 * identity cookie proved one side, the code just redeemed proved the other.
 * Refused when either side already belongs to somebody else; repeating an
 * existing pair is a no-op.
 */
export async function linkPerson(email: string, digits: string): Promise<LinkResult> {
  const handle = await getDatabaseOrNull();
  if (!handle) return { ok: false, reason: "taken" };
  const address = normalise(email);
  const holder = await linkedEmail(digits);
  if (holder && holder !== address) return { ok: false, reason: "taken" };
  const existing = await handle.db
    .selectFrom("person_links")
    .select(["phone"])
    .where("email", "=", address)
    .executeTakeFirst();
  if (existing) return existing.phone === digits ? { ok: true } : { ok: false, reason: "taken" };
  if (holder === address) return { ok: true };
  await handle.db
    .insertInto("person_links")
    .values({ email: address, phone: digits, method: "code", linked_at: nowIso() })
    .execute();
  return { ok: true };
}

/**
 * Make `digits` the address's one linked number — B-3010. The caller
 * (`changePersonPhone`) has already checked the number is nobody else's.
 */
export async function replaceLink(email: string, digits: string): Promise<void> {
  const handle = await getDatabaseOrNull();
  if (!handle) return;
  const address = normalise(email);
  await handle.db.deleteFrom("person_links").where("email", "=", address).execute();
  await handle.db
    .insertInto("person_links")
    .values({ email: address, phone: digits, method: "code", linked_at: nowIso() })
    .execute();
}

function personAad(subject: string): string {
  return `person:${subject}`;
}

/** The person's own postal address, without `tel` (a number is its own
 * channel), or null when none was saved or there is no contacts key. */
export async function getPersonAddress(subject: string): Promise<PostalAddress | null> {
  const handle = await getDatabaseOrNull();
  if (!handle || !hasContactsKey()) return null;
  const key = await canonicalSubject(subject);
  const row = await handle.db
    .selectFrom("person_addresses")
    .select("cipher")
    .where("subject", "=", key)
    .executeTakeFirst();
  return row ? decryptAddress(row.cipher, personAad(key)) : null;
}

/** Forget the person's saved address. The journals keep what they were
 * given; each is changed or removed there. */
export async function clearPersonAddress(subject: string): Promise<void> {
  const handle = await getDatabaseOrNull();
  if (!handle) return;
  const key = await canonicalSubject(subject);
  await handle.db.deleteFrom("person_addresses").where("subject", "=", key).execute();
}

/**
 * Store the person's address, once for the instance. The caller spreads it
 * into the journals (`spreadPersonAddress` in `lib/contacts`). Returns false
 * when it cannot be stored (no database or no contacts key).
 */
export async function setPersonAddress(subject: string, input: Partial<PostalAddress>): Promise<boolean> {
  const handle = await getDatabaseOrNull();
  if (!handle || !hasContactsKey()) return false;
  const key = await canonicalSubject(subject);
  const address = { ...normaliseAddress(input), tel: "" };
  const cipher = encryptAddress(address, personAad(key));
  const now = nowIso();
  await handle.db
    .insertInto("person_addresses")
    .values({ subject: key, cipher, updated_at: now })
    .onConflict((oc) => oc.column("subject").doUpdateSet({ cipher, updated_at: now }))
    .execute();
  return true;
}

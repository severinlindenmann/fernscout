import "server-only";
import crypto from "node:crypto";
import { hashSecret } from "../auth";
import { decryptString, encryptString, hasContactsKey, inviteAad } from "./crypto";
import { getDatabase, newId, nowIso } from "../db";
import type { Locale } from "../types";
import { parseLocale } from "./locale";

/**
 * The link shapes — decision 19, as amended by B37 and extended by B33.
 *
 * | | personal `/{user}/i/<token>` | guest `/{user}/invite/guest/<t>` | buddy `/{user}/invite/buddy/<t>` |
 * | --- | --- | --- | --- |
 * | one per | person | however many you send it to | the people you travelled with |
 * | carries | a name and a language | the same | the same, plus which trip |
 * | leads to | being let into the journal | the same | being on one trip: writing to it |
 * | grants  | nothing | nothing | nothing |
 *
 * That last row is the important one and it is why this module is so small.
 * **An invite is an invitation to request, not a grant.** It has no email in
 * it, it creates no `access_grants` row, and resolving one only ever returns
 * text to put in two form fields. Forward it to a group chat and the worst
 * that happens is that several people fill in the form — each becoming their
 * own pending contact, each still having to prove their own address, and each
 * still waiting for the owner to approve them by hand.
 *
 * ## What changed, and why (B37)
 *
 * There used to be a second shape: an open link, one per journal, carrying no
 * token and only a language in its query string. It was safe in what it
 * granted — exactly nothing, the same as this one — and that is what the
 * original decision argued. It was wrong in what it *advertised*. Anybody who found a username
 * was shown a form asking for a name, an email and a postal address, and the
 * owner was then left with a decision to make about somebody they had never
 * invited, correctly, every time, for as long as the journal exists. The queue
 * was the leak, not the access.
 *
 * So the open link is gone, its old address answers with a redirect to
 * `/{user}/me` rather than a 404 — people had already sent it to their
 * families — and `POST /api/contacts/request` now requires a live token.
 * Removing the page alone would have been a sign taken down from an open
 * door.
 *
 * `created_via: "open"` survives on rows written before this; they record how
 * somebody actually arrived, and rewriting them to say "invite" would be a
 * lie.
 *
 * ## What B33 added, and what it did not
 *
 * Two more kinds, at two URLs that say in the path what they are for, because
 * a recipient has to be able to tell which one they were sent. Neither changes
 * the row above: **holding a link is still not access.** A guest link and a
 * buddy link both end at a `pending` contact and an owner deciding by hand.
 * What differs is what the owner is deciding *about* — letting somebody read
 * the journal, or putting them on a trip they can then write to — and a buddy
 * link is therefore not the one to paste into a group chat.
 *
 * A buddy link names its trip in `trip_id`. It has to be stored rather than
 * put in the URL: the token is the only thing the recipient holds, and a trip
 * id in the path would be a second thing to get wrong.
 *
 * The token is stored hashed, like every other bearer credential here. Not
 * because guessing one gets you access — it gets you a form, and the owner
 * still has to approve whoever fills it in — but because a name is personal
 * data, and a database dump should not be a list of who was invited.
 */

/** `personal` is decision 19's original; the other two are B33's. */
export type InviteKind = "personal" | "guest" | "buddy";

export type Invite = {
  id: string;
  kind: InviteKind;
  /** The trip a `buddy` link joins. Null for every other kind. */
  tripId: string | null;
  name: string | null;
  locale: Locale | null;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  uses: number;
  /**
   * The address this invite was mailed to, or null for a link the owner
   * copied by hand — B338.
   *
   * This is `email_key`, and `014-invite-preapproval`'s own comment calls
   * that "a lookup key, not the address to show anybody": it is case-folded
   * for comparison, so what a reader sees here is not necessarily the exact
   * capitalisation the owner typed. Storing the address as given as well
   * would fix that at the cost of a migration and a second copy of an email
   * address at rest, for a difference that is cosmetic in the overwhelming
   * case — mail delivery has never been case-sensitive in the local part in
   * practice, and every reader recognises their own address regardless of
   * case. The lazy answer is the honest one here: show the folded form, and
   * say so here rather than pretend it is the original.
   *
   * Whether it is safe to show at all is a separate question — see the
   * doc comment on `RedeemPage` in `app/[user]/invite/redeemPage.tsx`, which
   * is where the decision to prefill only from this field (never from
   * nothing) is actually made.
   */
  email: string | null;
};

/**
 * An unrecognised `kind` reads as `personal`, never as `buddy`.
 *
 * The same rule the trip parser applies to `visibility`, for the same reason:
 * a typo, or a row from a future version restored into an older one, must fall
 * to the weakest of the three rather than the strongest. `personal` and
 * `guest` lead to the same place; only `buddy` leads to write access.
 */
function toKind(value: string | null | undefined): InviteKind {
  return value === "guest" || value === "buddy" ? value : "personal";
}

/**
 * How long a link the owner hands over stays live, by default.
 *
 * Thirty days. Long enough that a family group chat gets round to it, short
 * enough that the message sitting in somebody's inbox two Christmases from now
 * is not still a way of asking to be let in. The caller may say otherwise;
 * `null` — never expires — is deliberately not something this offers, because
 * "both still need an expiry and a revoke" is the point of leaving the shared
 * password behind.
 */
export const INVITE_TTL_DAYS = 30;
export const MAX_INVITE_TTL_DAYS = 365;

/** `days` from now, as the ISO string the column stores. */
export function inviteExpiry(days: number = INVITE_TTL_DAYS): string {
  const clamped = Math.min(Math.max(Math.round(days), 1), MAX_INVITE_TTL_DAYS);
  return new Date(Date.now() + clamped * 86_400_000).toISOString();
}

export function generateInviteToken(): string {
  return `fs_inv_${crypto.randomBytes(18).toString("base64url")}`;
}

/** The URL to send someone. Built here so no caller invents its own shape. */
export function inviteUrl(base: string, username: string, token: string): string {
  return `${base}/${username}/i/${token}`;
}

/**
 * Where a B33 link points.
 *
 * **The kind is in the path on purpose.** The two grant different things, and
 * somebody who is forwarded one has nothing else to go on: `/invite/buddy/…`
 * is legible in a message in a way that a token is not. It is kept off
 * `/{user}/i/…`, which already means the personal link and must keep meaning
 * only that.
 */
export function inviteLinkUrl(
  base: string,
  username: string,
  kind: InviteKind,
  token: string,
): string {
  if (kind === "personal") return inviteUrl(base, username, token);
  return `${base.replace(/\/$/, "")}/${username}/invite/${kind}/${token}`;
}

/**
 * Case-folded, same rule as `normaliseEmail` in `./index` — reimplemented
 * rather than imported, because `./index` already imports `countInviteUse`
 * from this module and the other direction would be a cycle.
 */
function emailKeyOf(email: string): string {
  return email.trim().toLowerCase();
}

export async function createInvite(
  owner: string,
  input: {
    kind?: InviteKind;
    /** Required for a `buddy` link and refused on any other kind — the caller
     * checks the trip exists; this only records which one. */
    tripId?: string | null;
    name?: string;
    locale?: string;
    expiresAt?: string | null;
    /**
     * The address to mail this invite to, if the owner asked for that rather
     * than a link to copy — B319. Recorded case-folded as `email_key`, which
     * is also what pre-approves it: see `preapprovedEmailFor`. The caller
     * validates it is a real address; this only stores what it is given.
     */
    email?: string | null;
  },
): Promise<{ id: string; token: string; expiresAt: string | null }> {
  const { db } = await getDatabase();
  const token = generateInviteToken();
  const id = newId();
  const kind = toKind(input.kind);
  const expiresAt = input.expiresAt ?? null;

  await db
    .insertInto("contact_invites")
    .values({
      id,
      owner_id: owner,
      kind,
      // Only a buddy link has a trip to name. Stored null for the others
      // rather than left to the caller, so a guest link can never be read as
      // a link to join something.
      trip_id: kind === "buddy" ? (input.tripId ?? null) : null,
      token_hash: hashSecret(token),
      // Beside the hash, never instead of it — B280 and
      // `013-invite-token-cipher`. Null when there is no key, which is the
      // same state as every row written before that migration: the link still
      // works, it just cannot be shown again.
      token_cipher: hasContactsKey() ? encryptString(token, inviteAad(owner, id)) : null,
      name: input.name?.trim() ? input.name.trim().slice(0, 120) : null,
      locale: parseLocale(input.locale),
      created_at: nowIso(),
      expires_at: expiresAt,
      revoked_at: null,
      uses: 0,
      email_key: input.email ? emailKeyOf(input.email) : null,
    })
    .execute();

  return { id, token, expiresAt };
}

/**
 * The address this invite was mailed to, pre-approved — B319.
 *
 * `createdVia` is a contact's own record of how it arrived: `invite:<id>` for
 * anything that came through this table. Given that string back, this answers
 * whether *that* invite was mailed to an address rather than handed out as a
 * link, and if so, what it was. The caller compares the answer to the
 * confirming contact's own `email` — never to anything from the request — so
 * a link forwarded to somebody else still lands in the owner's queue: only an
 * exact match skips it.
 *
 * Revocation and expiry are deliberately not checked here. By the time this
 * runs the redemption already happened through `resolveInvite`, which refuses
 * a dead link before anything is written; a row that got this far was live
 * when it mattered, and whether it still is by the time somebody types a code
 * has no bearing on whether the owner vouched for the address.
 */
export async function preapprovedEmailFor(
  owner: string,
  createdVia: string | null,
): Promise<string | null> {
  const prefix = "invite:";
  if (!createdVia?.startsWith(prefix)) return null;
  const id = createdVia.slice(prefix.length);

  const { db } = await getDatabase();
  const row = await db
    .selectFrom("contact_invites")
    .select("email_key")
    .where("owner_id", "=", owner)
    .where("id", "=", id)
    .executeTakeFirst();

  return row?.email_key ?? null;
}

/**
 * Look a token up.
 *
 * Returns prefill, and only prefill. A caller that treats the name it gets
 * back as an identity has misunderstood the feature.
 */
export async function resolveInvite(owner: string, token: string): Promise<Invite | null> {
  if (!token) return null;
  const { db } = await getDatabase();
  const row = await db
    .selectFrom("contact_invites")
    .selectAll()
    .where("owner_id", "=", owner)
    .where("token_hash", "=", hashSecret(token))
    .executeTakeFirst();

  if (!row) return null;
  if (row.revoked_at) return null;
  if (isExpired(row.expires_at)) return null;

  return toInvite(row);
}

/** One row, one shape. Both readers below go through here so a new column
 * cannot reach one of them and not the other. */
function toInvite(row: {
  id: string;
  kind: string;
  trip_id: string | null;
  name: string | null;
  locale: string | null;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  uses: number;
  email_key: string | null;
}): Invite {
  const kind = toKind(row.kind);
  return {
    id: row.id,
    kind,
    tripId: kind === "buddy" ? row.trip_id : null,
    name: row.name,
    locale: parseLocale(row.locale),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    uses: row.uses,
    email: row.email_key,
  };
}

/** Counted on submission rather than on landing: link previews and prefetches
 * would otherwise make the number meaningless. */
export async function countInviteUse(owner: string, id: string): Promise<void> {
  const { db } = await getDatabase();
  await db
    .updateTable("contact_invites")
    .set((eb) => ({ uses: eb("uses", "+", 1) }))
    .where("owner_id", "=", owner)
    .where("id", "=", id)
    .execute();
}

export async function listInvites(owner: string): Promise<Invite[]> {
  const { db } = await getDatabase();
  const rows = await db
    .selectFrom("contact_invites")
    .selectAll()
    .where("owner_id", "=", owner)
    .orderBy("created_at", "desc")
    .execute();

  // The token itself is deliberately not here. B280 made it recoverable, and
  // `listInvitesWithLinks` below is the only reader that recovers it: this one
  // answers `GET /api/v1/<user>/invites`, which an agent token reaches, and an
  // agent that can list invites has no need to be able to re-send them.
  return rows.map(toInvite);
}

/**
 * The same list, with each link the owner can send again — B280.
 *
 * Separate from `listInvites` rather than a flag on it, because the two have
 * different audiences and a boolean argument is how the wrong one gets passed:
 * this is for the owner's own page, server-side, behind `isOwner`, and the
 * plain list is for everything else. Postal addresses are decrypted under
 * exactly this rule (`app/[user]/contacts/page.tsx`), and this follows it.
 *
 * `url` is null for a row with no ciphertext — every row written before the
 * migration, and any row created while `CONTACTS_ENCRYPTION_KEY` was unset —
 * and for one that will not decrypt. The caller renders no copy action rather
 * than an empty one; a link that cannot be shown is not an error, it is the
 * old behaviour.
 */
export async function listInvitesWithLinks(
  owner: string,
  base: string,
): Promise<(Invite & { url: string | null })[]> {
  const { db } = await getDatabase();
  const rows = await db
    .selectFrom("contact_invites")
    .selectAll()
    .where("owner_id", "=", owner)
    .orderBy("created_at", "desc")
    .execute();

  return rows.map((row) => {
    const invite = toInvite(row);
    const token = row.token_cipher
      ? decryptString(row.token_cipher, inviteAad(owner, row.id), "invite token")
      : null;
    return {
      ...invite,
      // A revoked or expired link is shown but not offered: copying it would
      // hand somebody a URL that refuses them, which reads as the journal
      // being broken rather than the link being dead.
      url:
        token && !invite.revokedAt && !isExpired(invite.expiresAt)
          ? inviteLinkUrl(base, owner, invite.kind, token)
          : null,
    };
  });
}

/** Shared by `resolveInvite` and the owner's list, so "still usable" means one
 * thing. */
function isExpired(expiresAt: string | null): boolean {
  return Boolean(expiresAt && new Date(expiresAt).getTime() < Date.now());
}

export async function revokeInvite(owner: string, id: string): Promise<void> {
  const { db } = await getDatabase();
  await db
    .updateTable("contact_invites")
    .set({ revoked_at: nowIso() })
    .where("owner_id", "=", owner)
    .where("id", "=", id)
    .execute();
}

import "server-only";
import crypto from "node:crypto";
import { hashSecret } from "../auth";
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
      name: input.name?.trim() ? input.name.trim().slice(0, 120) : null,
      locale: parseLocale(input.locale),
      created_at: nowIso(),
      expires_at: expiresAt,
      revoked_at: null,
      uses: 0,
    })
    .execute();

  return { id, token, expiresAt };
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
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return null;

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

  // The token itself is not here and cannot be: only its hash was stored, so
  // a link that was lost has to be reissued rather than looked up.
  return rows.map(toInvite);
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

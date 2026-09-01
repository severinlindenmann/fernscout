import "server-only";
import crypto from "node:crypto";
import { hashSecret } from "../auth";
import { getDatabase, newId, nowIso } from "../db";
import type { Locale } from "../types";
import { parseLocale } from "./locale";

/**
 * The one link shape — decision 19, as amended by B37.
 *
 * | | personal `/{user}/i/<token>` |
 * | --- | --- |
 * | one per | person |
 * | carries | a name and a language |
 * | grants  | nothing |
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
 * The token is stored hashed, like every other bearer credential here. Not
 * because guessing one gets you access — it gets you a form, and the owner
 * still has to approve whoever fills it in — but because a name is personal
 * data, and a database dump should not be a list of who was invited.
 */

export type Invite = {
  id: string;
  name: string | null;
  locale: Locale | null;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  uses: number;
};

export function generateInviteToken(): string {
  return `fs_inv_${crypto.randomBytes(18).toString("base64url")}`;
}

/** The URL to send someone. Built here so no caller invents its own shape. */
export function inviteUrl(base: string, username: string, token: string): string {
  return `${base}/${username}/i/${token}`;
}

export async function createInvite(
  owner: string,
  input: { name?: string; locale?: string; expiresAt?: string | null },
): Promise<{ id: string; token: string }> {
  const { db } = await getDatabase();
  const token = generateInviteToken();
  const id = newId();

  await db
    .insertInto("contact_invites")
    .values({
      id,
      owner_id: owner,
      kind: "personal",
      token_hash: hashSecret(token),
      name: input.name?.trim() ? input.name.trim().slice(0, 120) : null,
      locale: parseLocale(input.locale),
      created_at: nowIso(),
      expires_at: input.expiresAt ?? null,
      revoked_at: null,
      uses: 0,
    })
    .execute();

  return { id, token };
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

  return {
    id: row.id,
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
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    locale: parseLocale(row.locale),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    uses: row.uses,
  }));
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

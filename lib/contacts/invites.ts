import "server-only";
import crypto from "node:crypto";
import { hashSecret } from "../auth";
import { getDatabase, newId, nowIso } from "../db";
import type { Locale } from "../types";
import { parseLocale } from "./locale";

/**
 * The two link shapes — decision 19.
 *
 * | | personal `/{user}/i/<token>` | open `/{user}/join?lang=de` |
 * | --- | --- | --- |
 * | one per | person | user |
 * | carries | a name and a language | a language |
 * | grants  | nothing | nothing |
 *
 * That last row is the important one and it is why this module is so small.
 * **An invite is an invitation to request, not a grant.** It has no email in
 * it, it creates no `access_grants` row, and resolving one only ever returns
 * text to put in two form fields. Forward it to a group chat and the worst
 * that happens is that several people fill in the form — each becoming their
 * own pending contact, each still having to prove their own address.
 *
 * The token is stored hashed, like every other bearer credential here. Not
 * because guessing one would achieve much — it would get you a form anyone can
 * reach at `/join` — but because a name is personal data, and a database dump
 * should not be a list of who was invited.
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

/** The link for a group chat: no token, no secret, rate-limited instead. */
export function openInviteUrl(base: string, username: string, locale?: Locale): string {
  return `${base}/${username}/join${locale ? `?lang=${locale}` : ""}`;
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

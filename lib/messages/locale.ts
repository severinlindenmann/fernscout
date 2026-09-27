import "server-only";
import { getDatabaseOrNull } from "../db";
import { pickLocale } from "../contacts/locale";
import type { Locale } from "../types";

/**
 * The one language resolver every message uses — B2439 (W44 D7, "Language").
 * Not a second parser: `pickLocale` (lib/contacts/locale.ts) already is "the
 * first of the candidates that is a language this site speaks, else en" —
 * this file only names, per recipient kind, which candidates in which order.
 */
export function recipientLocale(...candidates: (string | null | undefined)[]): Locale {
  return pickLocale(...candidates);
}

/**
 * The owner chain: `users.locale` of the owner's own address (set on a
 * successful sign-in — see `lib/auth/index.ts`'s `upsertUser`), then the
 * journal's `defaultLocale`, then `en`. Reads with no database as "nothing
 * stored" rather than throwing, the same "cannot tell" discipline every
 * other optional lookup here follows.
 */
export async function ownerLocale(owner: string, ownerEmail: string, defaultLocale?: string | null): Promise<Locale> {
  const stored = await storedUserLocale(owner, ownerEmail);
  return recipientLocale(stored, defaultLocale);
}

async function storedUserLocale(owner: string, email: string): Promise<string | null> {
  const handle = await getDatabaseOrNull();
  if (!handle) return null;
  const row = await handle.db
    .selectFrom("users")
    .select(["locale"])
    .where("owner_id", "=", owner)
    .where("email", "=", email.trim().toLowerCase())
    .executeTakeFirst();
  return row?.locale ?? null;
}

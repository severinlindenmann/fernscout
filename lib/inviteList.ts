import "server-only";
import { loadServerConfig } from "./config";
import { NO_JOURNAL } from "./auth";
import { getDatabaseOrNull, nowIso } from "./db";

/**
 * Who may sign up — B1693.
 *
 * Signup used to be one boolean: this instance takes anybody, or it takes
 * nobody. An operator running a private instance wanted the third state, so
 * `features.signup.enabled` is gone and `features.signup.inviteOnly` is what
 * remains. It defaults to **true**, which is why a fresh clone takes nobody
 * until somebody is named: an instance that opened itself to the whole
 * internet the moment it booted would be the wrong default to pick on
 * somebody else's behalf.
 *
 * **An entry earns the first code and nothing else.** Being on the list does
 * not skip the phone step, does not pre-verify anything and is not a
 * credential — see `035-signup-invites`. The whole control is that an
 * address nobody has named is never sent a signup code by any door.
 *
 * **`allowed()` answers true with no database.** `signup` already requires
 * one (`lib/capabilities.ts`), so a door that got this far has one; the null
 * handle here is the unit-test and static-render case, and refusing there
 * would make the answer depend on which process asked.
 */

/** Is this instance narrowing signup to a named list? Absent means yes. */
export function inviteOnly(): boolean {
  return loadServerConfig().features.signup.inviteOnly !== false;
}

/** The stored form of an address: one spelling per person, so `A@b.com`
 *  cannot be a second entry beside `a@b.com`. */
function normalizeInvite(email: string): string {
  return email.trim().toLowerCase();
}

export type Invite = {
  email: string;
  addedAt: string;
  addedBy: string | null;
  note: string | null;
};

/** May this address be sent a signup code? Open instances say yes to
 *  everybody; invite-only ones say yes to the list. */
export async function signupAllowed(email: string): Promise<boolean> {
  if (!inviteOnly()) return true;
  const handle = await getDatabaseOrNull();
  if (!handle) return true;
  const row = await handle.db
    .selectFrom("signup_invites")
    .select("email")
    .where("email", "=", normalizeInvite(email))
    .executeTakeFirst();
  return row !== undefined;
}

export async function listInvites(): Promise<Invite[]> {
  const handle = await getDatabaseOrNull();
  if (!handle) return [];
  const rows = await handle.db
    .selectFrom("signup_invites")
    .selectAll()
    .orderBy("added_at", "desc")
    .execute();
  return rows.map((row) => ({
    email: row.email,
    addedAt: row.added_at,
    addedBy: row.added_by,
    note: row.note,
  }));
}

/** Add an address, or leave an existing entry exactly as it was — adding
 *  somebody twice must not reset who let them in or when. */
export async function addInvite(
  email: string,
  addedBy: string | null,
  note?: string,
): Promise<void> {
  const handle = await getDatabaseOrNull();
  if (!handle) return;
  await handle.db
    .insertInto("signup_invites")
    .values({
      // Instance state, like an `admin_acks` row — see `035-signup-invites`.
      owner_id: NO_JOURNAL,
      email: normalizeInvite(email),
      added_at: nowIso(),
      added_by: addedBy,
      note: note?.trim() || null,
    })
    .onConflict((c) => c.column("email").doNothing())
    .execute();
}

export async function removeInvite(email: string): Promise<void> {
  const handle = await getDatabaseOrNull();
  if (!handle) return;
  await handle.db
    .deleteFrom("signup_invites")
    .where("email", "=", normalizeInvite(email))
    .execute();
}

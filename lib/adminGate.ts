import "server-only";
import { isAdminEmail } from "./admin";
import { resolveIdentity } from "./auth/handshake";

/**
 * Is the person on this browser the instance operator — B746.
 *
 * **`resolveIdentity`, never `resolveAccess`.** `/admin` is not about a
 * journal, so the question is the instance-wide one, and `lib/auth/handshake.ts`
 * is explicit that a journal's own `fs_session` must not answer it: that
 * cookie proves an address for one journal, and letting it satisfy an
 * instance-wide gate would turn one journal's year-long read cookie into a
 * key to every journal's balance.
 *
 * **A cookie only, never a bearer token.** AGENTS.md: an agent token reaches
 * `/api/…` and never a rendered page. This page shows every journal's balance
 * and every journal's spend, and a seven-day token in a scrollback must not
 * open it.
 *
 * With `FERNSCOUT_ADMIN_EMAIL` unset there is no admin and this is false for
 * everybody, which is what makes `/admin` behave as though it were not there
 * on every instance that is not this one.
 */
export async function isInstanceAdmin(): Promise<boolean> {
  const identity = await resolveIdentity();
  return isAdminEmail(identity?.email ?? null);
}

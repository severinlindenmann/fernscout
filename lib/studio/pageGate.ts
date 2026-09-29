import "server-only";
import { notFound } from "next/navigation";
import { isHelperOwner } from "@/lib/helper/server";
import { resolveAccess } from "@/lib/auth/handshake";
import { getUser } from "@/lib/users";

/**
 * The gate every page under `/@<user>/studio` shares — B1829, the same shape
 * `lib/extract/pageGate.ts` already uses for the four `extract`-capability
 * pages the studio absorbed (`/studio/photos`, `/location`, `/contacts`,
 * `/costs` — B1825).
 *
 * `notFound()` rather than a sign-in redirect: a stranger asking for
 * somebody else's studio learns nothing about whether it exists, matching
 * the family this hub sits beside. Owner pages read the browser cookie
 * (`isHelperOwner`'s own `resolveCookieCaller`), never a bearer token —
 * AGENTS.md's "agent bearer tokens reach `/api/**`, not rendered owner
 * pages."
 *
 * No `isEnabled()` check here: the studio is not itself an optional
 * capability the way `extract`, `contacts` or `postcards` are — it is the
 * front door to whichever of those an owner already has. Each flow it lists
 * carries its own capability check instead (`lib/studio/hub.ts`'s
 * `cannotRun`), which is what lets a switched-off flow show its reason
 * rather than vanish along with the whole hub.
 */
export async function requireStudioOwner(user: string): Promise<void> {
  if (!(await isHelperOwner(user))) notFound();
}

/**
 * Whether the caller's cookie really is the journal's own owner — narrower
 * than `requireStudioOwner`'s "may open this studio" grant, which also
 * admits the operator's own admin address (AGENTS.md: GPS location history
 * is metadata every `gps/` door refuses the admin, B2226 security review).
 * Every page under `/studio/location` reads this in addition to, never
 * instead of, `requireStudioOwner` before it reads the GPS store.
 */
export async function isJournalOwner(user: string): Promise<boolean> {
  return (await resolveAccess(user)).email === getUser(user)?.owner.email;
}

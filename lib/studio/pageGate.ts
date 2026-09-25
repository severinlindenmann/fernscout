import "server-only";
import { notFound } from "next/navigation";
import { isHelperOwner } from "@/lib/helper/server";

/**
 * The gate every page under `/<user>/studio` shares — B1829, the same shape
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

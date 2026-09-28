import "server-only";
import { journalPath, parseJournalPath } from "./journalPath";
import { userExists } from "./users";

/**
 * Where a journal's pre-`@` address now lives: `/anna/trips/x?trip=y` →
 * `/@anna/trips/x?trip=y`, when `anna` is a journal on this instance; null for
 * anything else.
 *
 * Journals moved under `@` (`lib/journalPath.ts`), and links in the old form
 * outlive the move: mail and messages already sent, bookmarks and home-screen
 * icons, links written into a day's text, a feed reader's subscription, and
 * a tab or the app's WebView still running the build from before the move,
 * whose client-side links were compiled with the old shape.
 *
 * Only the root 404 asks (`app/not-found.tsx`), and on purpose: that page
 * renders once nothing the app routes has matched, so an app page can never
 * be taken over by a journal that happens to share its name — the collision
 * the `@` exists to end. `userExists` already leaves out every reserved name,
 * and `journalPath` puts the result under `/@`, so it cannot leave the site.
 */
export function movedJournalPath(pathname: string | null, search: string | null): string | null {
  if (!pathname || parseJournalPath(pathname)) return null;
  const match = /^\/([^/]+)(\/.*)?$/.exec(pathname);
  if (!match || !userExists(match[1])) return null;
  const query = search && search.startsWith("?") ? search : "";
  return journalPath(match[1], `${match[2] ?? ""}${query}`);
}

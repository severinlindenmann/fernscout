import "server-only";
import fs from "node:fs";
import path from "node:path";
import { contentRoot } from "./contentRoot";
import { ConfigError, loadServerConfig, loadUserConfig, type UserConfig } from "./config";
import { isDeletedUsername } from "./tombstones";

/**
 * Users, and the boundary between them.
 *
 * A username is a path segment and a directory name, which makes it a security
 * boundary rather than a label. Everything here treats it as one: the pattern
 * is strict, the reserved list covers everything the app routes, and resolution
 * is always a directory lookup rather than string concatenation.
 */

/** Same shape as a trip id: lowercase, digits, dashes, no leading dash. */
const USERNAME_RE = /^[a-z0-9][a-z0-9-]{1,30}$/;

/**
 * Not people: shared currency rates, shared UI dictionaries.
 *
 * Exported because it is also the list `scripts/sync-shipped-content.sh` is
 * allowed to overwrite on a deploy — the same two names for the same reason,
 * and `test/sync-shipped-content.test.ts` holds the shell copy against this
 * one so a third instance directory cannot be added to only one of them.
 */
export const INSTANCE_DIRS = new Set(["rates", "locales"]);

/**
 * Route segments a username would shadow.
 *
 * Kept in code as well as in server config: a self-hoster editing config.json
 * should not be able to make `/api` resolve to a person by deleting a line.
 * The config list is additive on top of this one.
 */
const ALWAYS_RESERVED = [
  "api",
  "_next",
  "static",
  "media",
  "welcome",
  // The service worker's offline fallback. A journal that shadowed it would
  // make the offline page unreachable exactly when it is needed.
  "offline",
  "documentation.txt",
  "llms.txt",
  "openapi.json",
  "sitemap.xml",
  "robots.txt",
  "manifest.webmanifest",
  "favicon.ico",
  "icon.svg",
  "apple-icon",
  "opengraph-image",
] as const;

export function isValidUsername(username: string): boolean {
  return USERNAME_RE.test(username);
}

export function isReservedUsername(username: string): boolean {
  if ((ALWAYS_RESERVED as readonly string[]).includes(username)) return true;
  // A name that belonged to a deleted journal stays taken. Handing it back
  // would point every old link, QR code and bookmark at somebody else's
  // photographs — see lib/tombstones.ts, and B38's first decision. An operator
  // reclaims it by deleting the tombstone.
  if (isDeletedUsername(username)) return true;
  try {
    return loadServerConfig().users.reserved.includes(username);
  } catch {
    // A broken server config is reported elsewhere; here, fail closed.
    return true;
  }
}

/** A username that may be used, as opposed to one that merely looks valid. */
export function isUsableUsername(username: string): boolean {
  return isValidUsername(username) && !isReservedUsername(username);
}

export function userDir(username: string): string {
  return path.join(contentRoot(), username);
}

const cache = new Map<string, { signature: string; names: string[] }>();

/**
 * The content root as of the last attempt to read it, when that attempt
 * failed. Null means the last read worked.
 *
 * **Why a fault needs a name.** `getUsernames()` cannot throw — a directory
 * listing that fails during a request would take down every page rather than
 * the one journal it concerns — so it returns an empty list, and an empty list
 * is indistinguishable from an instance with no journals on it yet. Everything
 * downstream then draws the wrong conclusion politely: `userExists` says no,
 * `getUser` returns null, `/api/health` reports nothing narrowed, and the site
 * serves 404 for journals that are sitting on disk perfectly intact.
 *
 * B197 is what that cost. The per-journal mail gate asked
 * `isEnabled("mail", username)`, which resolves through here, so an unreadable
 * content root read as *every journal has switched mail off* — silently, with
 * nothing in the log and nothing on the health page. The gate has since been
 * narrowed (`hasSwitchedOff` in lib/capabilities.ts) so that "cannot tell" is
 * no longer read as "no", which is the half that mattered. This is the other
 * half: an I/O fault that suppresses the whole journal directory has to be
 * *sayable*, not merely survivable.
 *
 * Recorded rather than thrown, and read by `/api/health`, because the person
 * who needs it is not in the request — they are looking at a monitor asking
 * why an instance that boots serves nothing.
 */
let rootProblem: { root: string; message: string } | null = null;

/**
 * Why the journal directory could not be read, if it could not.
 *
 * Reflects the most recent call to `getUsernames()`, so call that first — as
 * `/api/health` does — rather than trusting a stale answer. Null is the
 * ordinary state and says nothing about how many journals there are: an
 * instance with none returns null here and an empty list there.
 */
export function contentRootProblem(): string | null {
  return rootProblem?.message ?? null;
}

/**
 * Every user on this instance, in directory order.
 *
 * A directory that is not a usable username is skipped with a warning rather
 * than failing the site — the same discipline `lib/trips.ts` applies to a
 * malformed trip. A stray `.DS_Store` or a half-finished folder must not take
 * everyone else offline.
 *
 * Cached against what the directory currently holds, not until somebody calls
 * `clearUserCache()`. That was the shape until W38, and it made a journal
 * created through the API unreachable in a browser: in a production build Next
 * gives the RSC layer and the route-handler layer separate instances of this
 * module, so `createJournal`'s invalidation cleared the copy the API route was
 * using and left the copy the pages were using stale until the process
 * restarted. `POST /api/v1/journals` answered 201 with a URL that answered 404.
 *
 * `getTrips` and `getAllEntries` already work this way, for the neighbouring
 * reason: a cache that needs a restart to notice `visibility: private` is not
 * a privacy control. A cache that needs one to notice a journal exists is not
 * a journal directory. The readdir happens on every call either way — it is
 * how the list is built — so the signature costs nothing beyond comparing it,
 * and the work it saves is the config load and the reserved-name check per
 * directory.
 */
export function getUsernames(): string[] {
  const root = contentRoot();

  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (error) {
    const message = `${root} could not be read: ${(error as Error).message}`;
    // Once per distinct fault, not once per request: this is on the path of
    // every page, and a line repeated a thousand times a minute is how the
    // warnings that matter stop being read. It is repeated when the message
    // changes, because a fault that turned from ENOENT into EACCES is news.
    if (rootProblem?.message !== message) {
      console.warn(
        `[users] ${message} — no journal resolves until this is fixed, and an empty ` +
          `journal list is not the same as an instance with no journals. /api/health says so.`,
      );
    }
    rootProblem = { root, message };
    cache.set(root, { signature: "", names: [] });
    return [];
  }
  rootProblem = null;

  const signature = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
    .join("|");
  const hit = cache.get(root);
  if (hit && hit.signature === signature) return hit.names;

  const names: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    // Directories under content/ that hold instance data rather than a
    // person. Listed here so they are skipped silently: warning about them on
    // every request is noise, and it trains the reader to ignore the warnings
    // that do matter.
    if (name.startsWith(".") || INSTANCE_DIRS.has(name)) continue;

    if (!isValidUsername(name)) {
      console.warn(
        `[users] content/${name} is not a valid username (a-z, 0-9, dashes) — skipping.`,
      );
      continue;
    }
    if (isReservedUsername(name)) {
      console.warn(`[users] content/${name} shadows a reserved route name — skipping.`);
      continue;
    }
    if (!fs.existsSync(path.join(root, name, "config.json"))) {
      console.warn(`[users] content/${name} has no config.json — skipping.`);
      continue;
    }
    names.push(name);
  }

  names.sort();
  cache.set(root, { signature, names });
  return names;
}

export function userExists(username: string): boolean {
  return getUsernames().includes(username);
}

/**
 * The journals this instance advertises: everything `getUsernames()` returns,
 * minus the ones whose config says `visibility: "private"`.
 *
 * Use this for anything that *hands out* the existence of a journal — the
 * instance documentation, the landing page, the sitemap. Never for resolving a
 * request: a private journal is unlisted, not gone, and `/<user>` must still
 * serve it to somebody who was sent the address. What a stranger with that
 * address can then read is the per-trip gate's business.
 *
 * A journal whose config will not load is absent from both lists, which is the
 * safe direction: `getUser` has already warned about it.
 */
export function listedUsernames(): string[] {
  return getUsernames().filter((username) => getUser(username)?.visibility === "public");
}

/** A user's config, or null when there is no such user. */
export function getUser(username: string): UserConfig | null {
  if (!userExists(username)) return null;
  try {
    return loadUserConfig(username);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.warn(`[users] ${username}/config.json is unusable, skipping:`, err.problems);
      return null;
    }
    throw err;
  }
}

/**
 * The user served at the bare URLs, if any.
 *
 * Forcing `/alex/…` on somebody self-hosting their own blog makes their site
 * worse for no gain, so a single-user instance names a `defaultUser` and gets
 * `/` back. Multi-user instances leave it unset and `/` is the landing page.
 */
export function getDefaultUsername(): string | null {
  const configured = loadServerConfig().site.defaultUser;
  if (!configured) return null;
  if (!userExists(configured)) {
    console.warn(
      `[users] site.defaultUser is "${configured}", but content/${configured} is not a usable user.`,
    );
    return null;
  }
  return configured;
}

/** Test seam — drops the memoised user list, and any recorded read failure
 * with it. A test that mocked `readdirSync` into throwing must not leave the
 * next one reporting an unhealthy content root. */
export function clearUserCache(): void {
  cache.clear();
  rootProblem = null;
}

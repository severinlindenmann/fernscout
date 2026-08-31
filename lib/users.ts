import "server-only";
import fs from "node:fs";
import path from "node:path";
import { contentRoot } from "./contentRoot";
import { ConfigError, loadServerConfig, loadUserConfig, type UserConfig } from "./config";

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

/** Not people: shared currency rates, shared UI dictionaries. */
const INSTANCE_DIRS = new Set(["rates", "locales"]);

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

const cache = new Map<string, string[]>();

/**
 * Every user on this instance, in directory order.
 *
 * A directory that is not a usable username is skipped with a warning rather
 * than failing the site — the same discipline `lib/trips.ts` applies to a
 * malformed trip. A stray `.DS_Store` or a half-finished folder must not take
 * everyone else offline.
 */
export function getUsernames(): string[] {
  const root = contentRoot();
  const hit = cache.get(root);
  if (hit) return hit;

  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    cache.set(root, []);
    return [];
  }

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
  cache.set(root, names);
  return names;
}

export function userExists(username: string): boolean {
  return getUsernames().includes(username);
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

/** Test seam — drops the memoised user list. */
export function clearUserCache(): void {
  cache.clear();
}

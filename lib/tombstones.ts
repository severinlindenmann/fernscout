import fs from "node:fs";
import path from "node:path";
import { contentRoot } from "./contentRoot";

/**
 * What is left behind when a journal or a trip is deleted.
 *
 * Deletion without a record has two failure modes and they are both silent.
 * The name comes free again, so the next person to claim `anna` inherits every
 * link, QR code and bookmark pointing at the old journal — and a family
 * following an address off a Christmas card lands on a stranger's
 * photographs. And the old URLs answer `404`, which tells a crawler to keep
 * trying and tells a person they mistyped something.
 *
 * So a deletion writes one small JSON file:
 *
 * ```
 * content/.deleted/anna.json              the whole journal is gone
 * content/.deleted/anna/japan-2027.json   one of anna's trips is gone
 * ```
 *
 * It is the reason `/anna` can answer `410 Gone` (`proxy.ts`) rather than
 * `404`, and the reason `isReservedUsername` refuses to hand the name out
 * again. Freeing the name is `rm content/.deleted/anna.json` — a thing an
 * operator does on purpose, on their own instance, and can see in a directory
 * listing. That is B38's first decision: reserved, but visibly so.
 *
 * Deliberately *not* `content/config.json`'s `users.reserved`. That file is
 * hand-written by the operator, and a program that rewrites it on every
 * deletion is a program that reformats somebody's configuration and drops
 * their comments. The tombstone is additive on top of that list, lives in a
 * directory that exists for nothing else, and carries the *why* — a name in a
 * `reserved` array says nothing about what happened to it.
 *
 * No `server-only` here, because `proxy.ts` imports it: the proxy runs in the
 * Node.js runtime (Next 16 default) and this is a plain filesystem read, the
 * same shape as `lib/contentRoot.ts`.
 */

/** The directory name and path segment rules, checked here rather than
 * imported: `lib/users.ts` is `server-only` and this module is not. A name
 * that does not match never reaches the filesystem. */
const SAFE_NAME = /^[a-z0-9][a-z0-9-]{1,62}$/;

export type Tombstone = {
  kind: "journal" | "trip";
  username: string;
  /** Only on a trip's. */
  tripId?: string;
  /** What it was called, so the record is readable a year later. */
  title: string;
  /** ISO-8601 UTC. An operator restoring from a backup needs the moment. */
  deletedAt: string;
  /** Who asked. The owner's address at the time. */
  requestedBy: string;
  /** What it held when it went — for the person reading this file later. */
  held: { trips?: number; days?: number; files: number; bytes: number };
  /**
   * The sentence somebody following an old link reads, already translated
   * into the journal's own language.
   *
   * Rendered here, at deletion time, rather than looked up when the 410 is
   * served: `proxy.ts` is the only place that can set a status code before a
   * page renders, and it has no dictionary loader — `lib/locales.ts` is
   * `server-only` and reaches the config. Storing the finished sentence also
   * means a German journal keeps saying it in German for ever, rather than
   * until somebody edits a dictionary.
   */
  notice: { lang: string; title: string; body: string; homeLabel: string; homeHref: string };
};

export function deletedDir(): string {
  return path.join(contentRoot(), ".deleted");
}

function journalPath(username: string): string | null {
  if (!SAFE_NAME.test(username)) return null;
  return path.join(deletedDir(), `${username}.json`);
}

function tripPath(username: string, tripId: string): string | null {
  if (!SAFE_NAME.test(username) || !SAFE_NAME.test(tripId)) return null;
  return path.join(deletedDir(), username, `${tripId}.json`);
}

function read(file: string | null): Tombstone | null {
  if (!file) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Tombstone;
    return typeof parsed?.kind === "string" ? parsed : null;
  } catch {
    // Absent, or unreadable. Either way there is no record to act on, and a
    // broken tombstone must not take a request down.
    return null;
  }
}

/** The record for a journal that used to be here, if there is one. */
export function journalTombstone(username: string): Tombstone | null {
  return read(journalPath(username));
}

/** The record for a trip that used to be here, if there is one. */
export function tripTombstone(username: string, tripId: string): Tombstone | null {
  return read(tripPath(username, tripId));
}

/**
 * Whether this username belonged to a journal that has been deleted.
 *
 * Read from disk on every call rather than memoised. It is one `existsSync`,
 * it is asked while deciding whether somebody may *create* a journal, and a
 * cached "no" that outlives the deletion would hand the name straight back —
 * which is the single thing this file exists to prevent. `lib/users.ts` has
 * the same reasoning written out at greater length for `getUsernames`.
 */
export function isDeletedUsername(username: string): boolean {
  const file = journalPath(username);
  return file !== null && fs.existsSync(file);
}

/** Write the record. The deletion itself is the caller's business. */
export function writeTombstone(stone: Tombstone): void {
  const file =
    stone.kind === "journal"
      ? journalPath(stone.username)
      : tripPath(stone.username, stone.tripId ?? "");
  if (!file) throw new Error("refusing to write a tombstone for an unsafe name");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(stone, null, 2) + "\n", "utf8");
}

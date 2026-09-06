import "server-only";
import { createHash, randomBytes } from "node:crypto";

/**
 * Who a visitor is, for exactly one day — B566.
 *
 * This is the whole privacy design of the analytics feature, so it is worth
 * being precise about what it does and does not know.
 *
 * ```
 * hash = sha256(dailySalt + username + ip + userAgent).slice(0, 16)
 * ```
 *
 * That sixteen-character string is the **only** thing about a visitor that is
 * ever written down. Not the IP, not the user agent, not a cookie, not
 * anything read from the browser — nothing here touches the client at all,
 * because nothing here runs there.
 *
 * **The salt is random, in memory, and thrown away every day.** It is not
 * persisted anywhere: a restart rotates it early, and a UTC date change drops
 * the previous one beyond recovery. Both directions are safe. Losing a salt
 * mid-day counts one returning visitor as two, which reports *more* uniques
 * than there were and is the direction that cannot expose anybody; keeping one
 * would be the actual harm, because a salt that survives is a salt that can be
 * used to re-derive yesterday's hashes from a list of candidate IP addresses.
 * That is the difference between "anonymous" and "pseudonymous with the key in
 * the same building", and it is the sentence `site/legal/*.md` now makes to
 * readers.
 *
 * This is Plausible's and Matomo's method, and it is chosen over a device
 * fingerprint deliberately. A fingerprint would answer "did this person come
 * back on Thursday", and it would be personal data under the GDPR, needing a
 * consent banner on a journal read by somebody's family. The owner asked how
 * many people are reading; that question is answerable without it.
 *
 * What it therefore cannot see, and what the page says out loud:
 *
 * - **Returning visitors.** The same person tomorrow is a new visitor. There
 *   is no cross-day identity and there is deliberately no way to build one.
 * - **Two people behind one address.** A household on one connection with the
 *   same browser is one visitor. Uniques are a floor, not a count.
 *
 * `username` is in the input so that one journal's hashes cannot be compared
 * against another's on a shared instance: the same reader of two journals is
 * two unrelated strings.
 */

/** Sixteen hex characters — 64 bits. Long enough that collisions are not a
 * source of error at any traffic this software will ever see, short enough
 * that the stored value is visibly not a full digest of anything. */
const HASH_LENGTH = 16;

let salt: Buffer | null = null;
let saltDay: string | null = null;

/** The UTC date, as `YYYY-MM-DD`. UTC rather than local so that a server
 * moving timezone does not rotate twice or not at all. */
function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Today's salt, generated on first use and forgotten on the date change.
 *
 * Exported only so a test can prove the rotation actually severs the link;
 * nothing else should need it, and nothing else should ever store it.
 */
export function dailySalt(now: Date = new Date()): Buffer {
  const day = utcDay(now);
  if (!salt || saltDay !== day) {
    salt = randomBytes(32);
    saltDay = day;
  }
  return salt;
}

/** For tests: forget the salt, as a restart or a date change would. */
export function forgetSalt(): void {
  salt = null;
  saltDay = null;
}

export function visitorHash(
  username: string,
  ip: string,
  userAgent: string | null,
  now: Date = new Date(),
): string {
  return createHash("sha256")
    .update(dailySalt(now))
    // Length-prefixed rather than joined by a separator: an IP and a user
    // agent are both attacker-influenced, and `a` + `:b` must not be able to
    // produce the same digest as `a:` + `b`.
    .update(`${username.length}:${username}${ip.length}:${ip}${userAgent ?? ""}`)
    .digest("hex")
    .slice(0, HASH_LENGTH);
}

/**
 * Whether this request is a machine, and therefore not a reader.
 *
 * ponytail: a substring list, not a bot database. It catches the crawlers and
 * link-preview fetchers that would otherwise make a journal nobody read look
 * like a journal somebody did, and it will miss a bot that lies. That is the
 * right trade for a number one person looks at occasionally; swap in a real
 * list only if the figures start looking wrong.
 */
const BOT = /bot|crawl|spider|slurp|preview|curl|wget|python-requests|headless|monitor|fetch|scrap/i;

export function looksLikeBot(userAgent: string | null): boolean {
  // No user agent at all is not a browser. Every real one sends something.
  if (!userAgent) return true;
  return BOT.test(userAgent);
}

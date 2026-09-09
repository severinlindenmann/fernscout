import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { contentRoot } from "./contentRoot";
import { getUsernames } from "./users";

/**
 * B1064 — the lock half of "a journal require a proven telephone number as
 * well as a proven address, and that a pair map to exactly one journal."
 *
 * Two **independent** locks, not a constraint on the pair: one journal per
 * proven address, one per proven number. `createJournal()` used to find out
 * whether an address already owned a journal by reading every journal's
 * `config.json` off disk (`journalsOwnedBy`), which is a scan
 * rather than a constraint — two concurrent creates for the same address both
 * pass the check before either directory exists.
 *
 * Modelled on `lib/tombstones.ts` rather than on a database table: this is a
 * per-instance lock, not a journal's own content, and `fs.writeFileSync`
 * with the `wx` flag (`O_CREAT | O_EXCL`) is an **atomic** exclusive create
 * at the OS level — the same guarantee a unique database index gives,
 * without asking every deployment (including one with no `DATABASE_URL` at
 * all — `signup`'s own capability requires a database, but this module does
 * not need to inherit that requirement) to have one. Disk (`config.json`)
 * stays the truth; this is a lock rebuildable from it, and
 * `npm run registry -- reconcile` does exactly that.
 */

function registryDir(kind: "email" | "tel"): string {
  return path.join(contentRoot(), ".registry", kind);
}

/** Emails contain characters a filename should not — `/`, spaces, the whole
 * of Unicode. A number is already E.164 digits (`toE164`) and safe as-is;
 * hashing it too would only mean two ways to spell the same file name. */
function emailFile(email: string): string {
  const hash = crypto.createHash("sha256").update(email).digest("hex");
  return path.join(registryDir("email"), `${hash}.json`);
}

function telFile(tel: string): string {
  return path.join(registryDir("tel"), `${tel}.json`);
}

type LockRow = { username: string; value: string; createdAt: string };

function readLock(file: string): LockRow | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as LockRow;
  } catch {
    return null;
  }
}

/** Whether this exact username already holds this exact lock — the one case
 * where "the file exists" is not a conflict, since `reserve` is called again
 * whenever a journal is re-read from disk by `reconcile`. */
function ownedByUs(file: string, username: string): boolean {
  return readLock(file)?.username === username;
}

export type ReserveResult = { ok: true } | { ok: false; conflict: "email" | "tel" };

/** One lock, taken atomically. `true` on success — including "already ours",
 * which is what lets `reconcile` re-run idempotently — `false` on a genuine
 * conflict with somebody else's username. */
function tryLock(file: string, username: string, value: string): boolean {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const row: LockRow = { username, value, createdAt: new Date().toISOString() };
  try {
    fs.writeFileSync(file, JSON.stringify(row, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    return ownedByUs(file, username);
  }
}

/**
 * Reserve a username against a proven email and, optionally, a proven number.
 *
 * The email lock is taken first; if the number is already somebody else's,
 * the email lock is released again, so a failed reservation leaves nothing
 * behind for `createJournal` to have to clean up. Call this **before**
 * writing `config.json`.
 */
export function reserve(username: string, email: string, tel: string | null): ReserveResult {
  const emailPath = emailFile(email);
  if (!tryLock(emailPath, username, email)) return { ok: false, conflict: "email" };

  if (tel) {
    const telPath = telFile(tel);
    if (!tryLock(telPath, username, tel)) {
      // Undo the email lock we just took — this attempt did not succeed.
      unlinkIfOurs(emailPath, username);
      return { ok: false, conflict: "tel" };
    }
  }

  return { ok: true };
}

/** Free a username's locks — B1064's "deleting a journal frees its address
 * and its number." Takes the email/tel rather than re-reading them, since a
 * caller deleting a journal has already read its config and this file must
 * not touch content it does not need to. */
export function release(username: string, email: string | null, tel: string | null): void {
  if (email) unlinkIfOurs(emailFile(email), username);
  if (tel) unlinkIfOurs(telFile(tel), username);
}

function unlinkIfOurs(file: string, username: string): void {
  if (!ownedByUs(file, username)) return;
  try {
    fs.unlinkSync(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

/**
 * Rebuild the registry from `content/` — "the registry can be thrown away and
 * rebuilt from `content/` with the same result." Every journal contributes
 * its `owner.email`; only a journal whose `owner.telProvenAt` is set
 * contributes its `owner.tel` — an unproven number (today's ordinary
 * destination-only field) is not this registry's business.
 *
 * A journal whose config cannot be read, or whose email/tel collides with one
 * already reconciled, is reported and skipped rather than allowed to break
 * the whole run — the same "somebody else's problem" reasoning
 * `journalsOwnedBy` already uses for an unreadable config.
 */
export function reconcile(): { journals: number; emails: number; tels: number; problems: string[] } {
  fs.rmSync(path.join(contentRoot(), ".registry"), { recursive: true, force: true });
  const problems: string[] = [];
  let emails = 0;
  let tels = 0;
  const usernames = getUsernames();
  for (const username of usernames) {
    let raw: { owner?: { email?: unknown; tel?: unknown; telProvenAt?: unknown } };
    try {
      raw = JSON.parse(fs.readFileSync(path.join(contentRoot(), username, "config.json"), "utf8"));
    } catch (err) {
      problems.push(`${username}: could not read config.json (${(err as Error).message})`);
      continue;
    }
    const email = typeof raw.owner?.email === "string" ? raw.owner.email.trim().toLowerCase() : null;
    const tel = typeof raw.owner?.tel === "string" ? raw.owner.tel : null;
    const provenAt = typeof raw.owner?.telProvenAt === "string" ? raw.owner.telProvenAt : null;
    // A journal with no owner.email at all is read-only (Owner.email's own
    // doc) and has nothing to lock — see lib/config.ts.
    if (email && !tryLock(emailFile(email), username, email)) {
      problems.push(`${username}: email is already claimed by another journal`);
      continue;
    }
    if (email) emails++;
    if (tel && provenAt) {
      if (!tryLock(telFile(tel), username, tel)) {
        problems.push(`${username}: tel is already claimed by another journal`);
        continue;
      }
      tels++;
    }
  }
  return { journals: usernames.length, emails, tels, problems };
}

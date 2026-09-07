import "server-only";
import fs from "node:fs";
import path from "node:path";

import { countSpends } from "./credits";
import { loadUserConfig, serverMediaCeiling } from "./config";
import { mediaOriginalsRoot } from "./media";
import { getUser, userDir } from "./users";
import { getTrips, tripDir } from "./trips";
import { EXTRA_STORAGE_BYTES } from "./credits/pricing";
import { sendTransactional } from "./mail";
import { renderMail } from "./mail/template";
import { pickLocale } from "./contacts/locale";
import { translateIn } from "./locales";
import { rateLimitFor } from "./rateLimit";
import { serverSite } from "./site";

/**
 * How much disk one journal is using, and how much it is allowed — B661.
 *
 * **The folder is the unit, not the media directory.** `lib/api/media.ts` used
 * to count `media/` and `originals/` for every trip and call that the
 * journal's size, which left photobook PDFs (tens to hundreds of megabytes
 * each), generated postcards and markdown outside the ceiling entirely. What
 * somebody pays for is `content/<username>/`, so that is what is counted —
 * plus their subtree of `MEDIA_ORIGINALS_DIR` where an instance has moved
 * originals to another disk, because those bytes are still theirs.
 *
 * **Walked, never tracked.** The same argument `lib/statusReport.ts` and
 * `lib/api/media.ts` already made for their own walks, and the reason this
 * file has no counter column: a stored total is a second source of truth that
 * drifts the first time somebody deletes a file by hand, on a system whose
 * whole premise is that the content is a folder they own. A walk costs a stat
 * per file and runs on writes, not on reads.
 */

/** The fraction of the allowance above which the owner is warned. */
const WARN_FRACTION = 0.9;

export type StorageUsage = {
  usedBytes: number;
  /** Config ceiling plus everything bought, or `null` when the instance has
   * switched the ceiling off entirely. */
  limitBytes: number | null;
  /** Bytes added by purchases — `null` limit means these are moot. */
  purchasedBytes: number;
  /** Never negative: a journal already over its ceiling has none left, not a
   * negative amount of room. */
  remainingBytes: number | null;
};

/** Every byte under a directory. Missing is zero, not an error. */
export function dirBytes(at: string): number {
  let total = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(at, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(at, entry.name);
    if (entry.isDirectory()) total += dirBytes(full);
    else if (entry.isFile())
      try {
        total += fs.statSync(full).size;
      } catch {
        // Vanished between readdir and stat. Not our byte to count.
      }
  }
  return total;
}

/** Everything this journal holds, wherever this instance keeps it. */
export function journalBytes(username: string): number {
  const originals = mediaOriginalsRoot();
  return (
    dirBytes(userDir(username)) + (originals ? dirBytes(path.join(originals, username)) : 0)
  );
}

/** Bytes, at the precision an operator reads rather than the one a disk has. */
export function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(0)} MB`;
  return `${(n / 1024).toFixed(0)} KB`;
}

/**
 * What this journal has bought, counted from the ledger it was charged on.
 *
 * No table and no column of its own: `credit_ledger` is append-only and is
 * already the record of every purchase, so counting `storage` rows is reading
 * the receipt rather than keeping a tally beside it — the same reasoning as
 * the walk above. A refund does not reverse one; extensions are sold as
 * lifetime and there is no route that unsells them.
 */
async function purchasedBytes(username: string): Promise<number> {
  return (await countSpends(username, "storage")) * EXTRA_STORAGE_BYTES;
}

/**
 * What is actually taking the space — B664.
 *
 * One row per thing an owner could act on: each trip by name, the inbox, the
 * generated photobooks and postcards, and whatever is left. The rows sum to
 * `journalBytes` exactly, and `other` is what makes that true — a breakdown
 * that quietly loses a few megabytes is one nobody can reason from, and
 * `config.json` and anything somebody dropped in by hand are real bytes.
 *
 * Walked, like everything else here. It is a directory read per trip, on a
 * page one person opens.
 */
export type StorageRow = { key: string; label: string; bytes: number };

export function storageBreakdown(username: string): StorageRow[] {
  const originals = mediaOriginalsRoot();
  const rows: StorageRow[] = [];

  for (const trip of getTrips(username)) {
    const bytes =
      dirBytes(tripDir(trip.ref)) +
      // Where an instance keeps originals on another disk they are still this
      // trip's bytes, and still the owner's.
      (originals ? dirBytes(path.join(originals, username, trip.id)) : 0);
    rows.push({ key: `trip:${trip.id}`, label: trip.title, bytes });
  }

  const dir = userDir(username);
  rows.push({ key: "inbox", label: "Staged files", bytes: dirBytes(path.join(dir, "inbox")) });
  rows.push({ key: "photobooks", label: "Photobooks", bytes: dirBytes(path.join(dir, "photobooks")) });
  rows.push({ key: "postcards", label: "Postcards", bytes: dirBytes(path.join(dir, "postcards")) });

  const counted = rows.reduce((n, row) => n + row.bytes, 0);
  rows.push({ key: "other", label: "Everything else", bytes: Math.max(0, journalBytes(username) - counted) });

  return rows;
}

/**
 * This journal's own ceiling, or the instance's where it has none to read.
 *
 * A journal whose `config.json` is missing or malformed still occupies disk,
 * and the answer to "how much may it hold" is then the instance's own number
 * rather than an exception out of an upload. Same tolerance, and the same
 * reasoning, as `serverMediaCeiling` has for a missing server config.
 */
function configuredLimit(username: string): number | null {
  try {
    return loadUserConfig(username).media.perUserBytes;
  } catch {
    return serverMediaCeiling().perUserBytes;
  }
}

/** Where this journal stands. One walk, one query. */
export async function storageFor(username: string): Promise<StorageUsage> {
  const usedBytes = journalBytes(username);
  const purchased = await purchasedBytes(username);
  const configured = configuredLimit(username);
  const limitBytes = configured === null ? null : configured + purchased;
  return {
    usedBytes,
    limitBytes,
    purchasedBytes: purchased,
    remainingBytes: limitBytes === null ? null : Math.max(0, limitBytes - usedBytes),
  };
}

/**
 * Why a write of `incomingBytes` cannot happen, or null.
 *
 * The one guard, called by every path that puts real bytes into a journal —
 * `storeUploads` in `lib/api/media.ts` and the photobook order route. Markdown
 * writes are deliberately *not* gated: a day is kilobytes, and a journal that
 * could not correct a typo because its photographs filled the disk would be
 * held hostage by the thing it is being asked to fix.
 *
 * Warning the owner is part of the same call rather than a caller's
 * responsibility, because a check that mails only where somebody remembered to
 * is a check that goes quiet exactly on the path nobody reviewed.
 */
export async function storageRefusal(
  username: string,
  incomingBytes: number,
): Promise<string | null> {
  const usage = await storageFor(username);
  if (usage.limitBytes === null) return null;

  const after = usage.usedBytes + incomingBytes;
  if (after > usage.limitBytes) {
    await warnOwner(username, usage, "full");
    return (
      `this journal holds ${formatBytes(usage.usedBytes)} of its ${formatBytes(usage.limitBytes)}, ` +
      `and this write would take it to ${formatBytes(after)}. Delete something, or buy more room ` +
      `from the journal's own page.`
    );
  }

  if (after >= usage.limitBytes * WARN_FRACTION) {
    await warnOwner(username, { ...usage, usedBytes: after }, "low");
  }
  return null;
}

/**
 * Tell the owner, at most once a day per journal and level.
 *
 * The person uploading is often not the person who can do anything about it —
 * a trip-scoped agent's refusal is an API error nobody else ever sees — so the
 * notice goes to the address in the journal's own `config.json` and nowhere
 * else. Transactional: it is about their own account, and a journal must not
 * be unable to say it is full because it is out of credits.
 *
 * ponytail: the once-a-day is the in-memory rate limiter, so a restart lets
 * one more notice through. That is the right way round — the failure is a
 * duplicate mail rather than a silence — and a table for it can come the day
 * somebody complains.
 */
async function warnOwner(
  username: string,
  usage: StorageUsage,
  level: "low" | "full",
): Promise<void> {
  const journal = getUser(username);
  const to = journal?.owner.email;
  if (!to) return;
  if (!rateLimitFor(`storage-${level}`, username, { max: 1, windowMs: 24 * 60 * 60 * 1000 }).ok) {
    return;
  }

  // Written in the owner's own language — B857. This goes to one address, the
  // one in the journal's own `config.json`, so the journal's `defaultLocale`
  // is the whole answer; there is no request to fall back to.
  const locale = pickLocale(journal.defaultLocale);
  const t = (key: Parameters<typeof translateIn>[1], vars?: Record<string, string>) =>
    translateIn(locale, key, vars);

  const limit = usage.limitBytes === null ? "" : formatBytes(usage.limitBytes);
  const full = level === "full";
  const vars = { user: username, used: formatBytes(usage.usedBytes), limit };

  await sendTransactional(
    renderMail(
      to,
      t(full ? "mail.storageFullSubject" : "mail.storageLowSubject", vars),
      {
        preheader: t("mail.storagePreheader", vars),
        title: t(full ? "mail.storageFullTitle" : "mail.storageLowTitle"),
        blocks: [
          {
            kind: "paragraph",
            text: t(full ? "mail.storageFullBody" : "mail.storageLowBody", vars),
          },
          { kind: "paragraph", text: t("mail.storageAdvice") },
          {
            kind: "button",
            text: t("mail.storageOpen"),
            href: `${serverSite().url}/${username}/me`,
          },
        ],
        footer: t("mail.storageFooter", vars),
      },
      username,
    ),
    `storage ${level}`,
  );
}

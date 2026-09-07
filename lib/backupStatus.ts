import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./dataDir";

/**
 * When the backup last worked — read from two stamp files under `$DATA_DIR`,
 * so the question "are backups running?" is answerable from off the box.
 *
 * Nothing in the app takes a backup. What the app can do is *report* one, and
 * that is the gap B64 was about: `scripts/backup.sh` failed three nights in a
 * row on the live server and the only reason anybody knew is that a person
 * happened to be watching `journalctl`. `systemctl list-timers` — the check
 * both the timer and the runbook recommended — reports the schedule and never
 * the result, so a healthy-looking timer sat above a backup that had not
 * completed since March.
 *
 * The two files, both written by shell so they survive the app being down:
 *
 *   `.backup-last-success`  one ISO-8601 line, written by `scripts/backup.sh`
 *                           on the way out of a run that finished.
 *   `.backup-last-failure`  one ISO-8601 line, then free-text detail, written
 *                           by `scripts/alert.sh` from the unit's `OnFailure=`.
 *
 * Deliberately *not* a capability: there is nothing to switch on, and an
 * instance with no backups at all must read as `unknown`, not as absent. That
 * distinction is the whole point — B65 is an instance that ran for months with
 * no backup and nothing anywhere said so.
 *
 * **A third file, since B659, for the off-site copy.** `RESTIC_REPOSITORY_SECONDARY`
 * is optional — an instance with one destination is unchanged — so
 * `.backup-last-success-secondary` simply never exists there, and `secondary`
 * below reads `unknown` exactly the way the whole block would on an instance
 * with no backup at all. There is deliberately no failure stamp for it: B659
 * (following B655's reasoning) does not wire an alert channel for the
 * secondary, only a stale reading here — a copy destination nobody has earned
 * trust in yet must not be able to page anyone, and must never turn the
 * primary's own `state` red. `scripts/backup.sh` writes the stamp only after
 * `restic copy` **and** the secondary `restic forget --prune` both succeed;
 * either failing there logs a warning and leaves the previous stamp in place,
 * which is what makes an old stamp here mean "stale" rather than "lying".
 */

export const DEFAULT_MAX_AGE_HOURS = 36;

export type BackupState = "ok" | "stale" | "failing" | "unknown";

export type SecondaryBackupStatus = {
  /** `ok` recent success; `stale` too old; `unknown` never configured, or
   *  never copied successfully yet. Never `failing` — a secondary destination
   *  cannot turn the primary's own `state` red (B659, following B655). */
  state: "ok" | "stale" | "unknown";
  lastSuccessAt: string | null;
  ageHours: number | null;
  reason?: string;
  maxAgeHours: number;
};

export type BackupStatus = {
  /** `ok` recent success; `stale` too old; `failing` a failure since the last
   *  success; `unknown` nothing has ever been recorded here. */
  state: BackupState;
  lastSuccessAt: string | null;
  /** Hours since the last success, one decimal. Null when there is none. */
  ageHours: number | null;
  lastFailureAt: string | null;
  /** The first detail line of the failure stamp, when there is one. */
  lastFailure?: string;
  /** Why the state is what it is, in the same voice as the capability reasons
   *  next to it — this is read at 2am by somebody who did not write it. */
  reason?: string;
  maxAgeHours: number;
  /** The off-site copy `restic copy --from-repo` pushes on to, when
   *  `RESTIC_REPOSITORY_SECONDARY` is set — see the module comment. */
  secondary: SecondaryBackupStatus;
};

function maxAgeHours(): number {
  const raw = process.env.BACKUP_MAX_AGE_HOURS;
  if (raw === undefined || raw.trim() === "") return DEFAULT_MAX_AGE_HOURS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_AGE_HOURS;
}

/** First line of a stamp file as a Date, or null — a truncated write, an empty
 * file or a stamp somebody edited by hand must read as "no stamp", never throw
 * and never take the health endpoint down with it. */
function readStamp(file: string): { at: Date; detail?: string } | null {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const lines = raw.split("\n");
  const at = new Date((lines[0] ?? "").trim());
  if (Number.isNaN(at.getTime())) return null;
  const detail = lines.slice(1).find((line) => line.trim() !== "");
  return detail === undefined ? { at } : { at, detail: detail.trim() };
}

export function successStampPath(dir = dataDir()): string {
  return path.join(dir, ".backup-last-success");
}

export function failureStampPath(dir = dataDir()): string {
  return path.join(dir, ".backup-last-failure");
}

export function secondarySuccessStampPath(dir = dataDir()): string {
  return path.join(dir, ".backup-last-success-secondary");
}

function readSecondaryStatus(dir: string, now: Date, limit: number): SecondaryBackupStatus {
  const success = readStamp(secondarySuccessStampPath(dir));
  const lastSuccessAt = success ? success.at.toISOString() : null;
  const ageHours = success ? Math.round(((now.getTime() - success.at.getTime()) / 3_600_000) * 10) / 10 : null;

  if (!success) {
    return {
      state: "unknown",
      lastSuccessAt,
      ageHours,
      reason:
        "no off-site copy has ever recorded a success in DATA_DIR — either RESTIC_REPOSITORY_SECONDARY is not " +
        "set (this instance has one destination) or it has never copied successfully yet",
      maxAgeHours: limit,
    };
  }
  if (ageHours !== null && ageHours > limit) {
    return {
      state: "stale",
      lastSuccessAt,
      ageHours,
      reason: `the last successful off-site copy was ${ageHours}h ago, more than the ${limit}h a nightly run allows for`,
      maxAgeHours: limit,
    };
  }
  return { state: "ok", lastSuccessAt, ageHours, maxAgeHours: limit };
}

export function readBackupStatus(now: Date = new Date()): BackupStatus {
  const dir = dataDir();
  const limit = maxAgeHours();
  const success = readStamp(successStampPath(dir));
  const failure = readStamp(failureStampPath(dir));

  const lastSuccessAt = success ? success.at.toISOString() : null;
  const lastFailureAt = failure ? failure.at.toISOString() : null;
  const ageHours = success ? Math.round(((now.getTime() - success.at.getTime()) / 3_600_000) * 10) / 10 : null;

  const base = {
    lastSuccessAt,
    ageHours,
    lastFailureAt,
    ...(failure?.detail ? { lastFailure: failure.detail } : {}),
    maxAgeHours: limit,
    secondary: readSecondaryStatus(dir, now, limit),
  };

  // A failure newer than the last success outranks the age check: a run that
  // failed an hour ago is "failing", not "ok because Tuesday worked".
  if (failure && (!success || failure.at.getTime() > success.at.getTime())) {
    return {
      ...base,
      state: "failing",
      reason: `the last backup run failed at ${lastFailureAt}${
        lastSuccessAt ? `; the last one that finished was ${lastSuccessAt}` : " and none has ever succeeded here"
      }`,
    };
  }

  if (!success) {
    return {
      ...base,
      state: "unknown",
      reason:
        "no backup has ever recorded a success in DATA_DIR — either none is installed (see docs/runbook.md §Backups) or this DATA_DIR is not the one it writes to",
    };
  }

  if (ageHours !== null && ageHours > limit) {
    return {
      ...base,
      state: "stale",
      reason: `the last successful backup was ${ageHours}h ago, more than the ${limit}h a nightly run allows for`,
    };
  }

  return { ...base, state: "ok" };
}

import "server-only";
import { ledgerFor } from "../credits";
import { pickLocale } from "../contacts/locale";
import { translateIn } from "../locales";
import { sendMail } from "../mail";
import { renderMail } from "../mail/template";
import type { MailBlock } from "../mail/template";
import { getUser, getUsernames } from "../users";
import type { UserConfig } from "../config";
import { listRuns, writeManifest, type RunManifest } from "./manifest";

/** How old a run has to be before the notice goes out. */
export const WARN_AFTER_MS = 24 * 60 * 60 * 1000;
/** What the notice promises, and therefore what it pins. */
export const WARNED_GRACE_MS = 24 * 60 * 60 * 1000;
/** What continuing buys, once. */
export const EXTENSION_MS = 48 * 60 * 60 * 1000;

/** What a nightly pass should do with one run. Pure, so it can be tested
 *  without a mailer, a clock or a filesystem. */
export type ExpiryAction =
  | { do: "nothing" }
  | { do: "warn"; expiresAt: string; hoursLeft: number; canExtend: boolean }
  | { do: "final-notice"; expiresAt: string };

/**
 * What tonight's pass should do with one run.
 *
 * **The warning pins the deadline, and that is the whole point of this
 * function.** The sweep runs nightly, so "24 hours old" is in practice
 * anywhere from 24 to 48 hours old — and a mail that says "24 hours left"
 * against a fixed `createdAt + 48h` would be telling somebody who uploaded at
 * four in the morning that they had a day when they had an hour. Writing
 * `expiresAt = warnedAt + 24h` makes the sentence true by construction. The
 * cost is an effective TTL between 48 and 72 hours, which is the right way
 * round: the promise is to a person, the jitter is ours.
 *
 * Pure on purpose — no clock, no mailer, no filesystem — because every rule
 * worth arguing about lives in here and a test should be able to reach it
 * without standing up any of that.
 */
export function expiryActionFor(run: RunManifest, now: Date): ExpiryAction {
  const ms = now.getTime();
  if (run.state === "committed") return { do: "nothing" };

  if (!run.warnedAt) {
    if (ms - Date.parse(run.createdAt) < WARN_AFTER_MS) return { do: "nothing" };
    return {
      do: "warn",
      expiresAt: new Date(ms + WARNED_GRACE_MS).toISOString(),
      hoursLeft: WARNED_GRACE_MS / 3_600_000,
      canExtend: true,
    };
  }

  // Warned, extended, and now inside the last day of the extension: one final
  // notice, with nothing to offer. Ending in silence after somebody was told
  // they would be warned reads as a bug.
  if (run.extendedAt && !run.finalNoticeAt && Date.parse(run.expiresAt) - ms <= WARNED_GRACE_MS) {
    return { do: "final-notice", expiresAt: run.expiresAt };
  }

  return { do: "nothing" };
}

/**
 * Continuing a run is the extension — there is no button.
 *
 * Any authenticated touch calls this: opening the run, answering a question,
 * uploading more. Before the warning it does nothing, because the original 48
 * hours are still running and extending an unwarned run would quietly make the
 * TTL unbounded for anybody who kept the tab open. After the warning, once.
 *
 * Returns `null` when nothing changed, so the caller can skip the write rather
 * than rewriting the manifest on every request.
 */
export function extendOnTouch(run: RunManifest, now: Date): RunManifest | null {
  if (!run.warnedAt || run.extendedAt) return null;
  return {
    ...run,
    extendedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + EXTENSION_MS).toISOString(),
  };
}

/** What one night's pass over every journal's staged runs did — for the
 *  script's own log line and for `--dry-run`, which fills these in without
 *  sending or stamping anything. */
export type ExpirySweepResult = { warned: string[]; finalNotices: string[] };

/** Every credit this run has actually cost, read from the ledger by its own
 *  `extract:<runId>` ref — never a number carried on the manifest, because
 *  the ledger is the one place that can't drift from what was really spent. */
async function spentOnRun(owner: string, runId: string): Promise<number> {
  const ref = `extract:${runId}`;
  const rows = await ledgerFor(owner, 1000);
  return rows
    .filter((row) => row.ref === ref && row.delta < 0)
    .reduce((sum, row) => sum - row.delta, 0);
}

/** A photo counts as "used" once it belongs to a day this run has already
 *  committed — the same day that stays when the run itself goes, so its
 *  photographs are not part of what the notice threatens. */
function unusedPhotoCount(run: RunManifest): number {
  const committedDates = new Set(run.days.filter((d) => d.committed).map((d) => d.date));
  return run.photos.filter((p) => !p.dropped && !(p.date && committedDates.has(p.date))).length;
}

/** Never throws — one bad send must not take the rest of the night's sweep
 *  down with it, the same discipline `sendReminder` (`lib/digest/reminder.ts`)
 *  follows for the evening nudge. */
async function sendExpiryMail(username: string, user: UserConfig, run: RunManifest): Promise<boolean> {
  if (!user.owner.email) return false;
  const locale = pickLocale(user.defaultLocale);
  const daysLeftToTell = run.days.filter((d) => !d.committed).length;
  const blocks: MailBlock[] = [
    {
      kind: "paragraph",
      text: translateIn(locale, "extract.expiry.warn.body", {
        count: String(run.photos.length),
        started: run.createdAt.slice(0, 10),
        days: String(daysLeftToTell),
      }),
    },
  ];
  const spent = await spentOnRun(run.owner, run.runId);
  if (spent > 0) {
    blocks.push({
      kind: "paragraph",
      text: translateIn(locale, "extract.expiry.spent", { credits: String(spent) }),
    });
  }
  try {
    const subject = translateIn(locale, "extract.expiry.warn.subject");
    const result = await sendMail(
      renderMail(
        user.owner.email,
        subject,
        {
          preheader: subject,
          title: subject,
          blocks,
          footer: translateIn(locale, "contact.mailFooter", { site: user.title }),
        },
        username,
      ),
    );
    return result !== null;
  } catch (err) {
    console.error(`[extract-remind] could not mail ${username} about run ${run.runId}:`, err);
    return false;
  }
}

/** Same shape as {@link sendExpiryMail}, for the one notice that follows an
 *  extension. */
async function sendFinalNoticeMail(username: string, user: UserConfig, run: RunManifest): Promise<boolean> {
  if (!user.owner.email) return false;
  const locale = pickLocale(user.defaultLocale);
  const blocks: MailBlock[] = [
    {
      kind: "paragraph",
      text: translateIn(locale, "extract.expiry.final.body", { count: String(unusedPhotoCount(run)) }),
    },
  ];
  const spent = await spentOnRun(run.owner, run.runId);
  if (spent > 0) {
    blocks.push({
      kind: "paragraph",
      text: translateIn(locale, "extract.expiry.spent", { credits: String(spent) }),
    });
  }
  try {
    const subject = translateIn(locale, "extract.expiry.final.subject");
    const result = await sendMail(
      renderMail(
        user.owner.email,
        subject,
        {
          preheader: subject,
          title: subject,
          blocks,
          footer: translateIn(locale, "contact.mailFooter", { site: user.title }),
        },
        username,
      ),
    );
    return result !== null;
  } catch (err) {
    console.error(`[extract-remind] could not mail ${username} about run ${run.runId}:`, err);
    return false;
  }
}

/**
 * The nightly pass over every journal's staged runs — `scripts/extract-remind.mts`'s
 * whole job, pulled out so it can be tested without a process to run.
 *
 * Mail only: an import run has no trip, so there is no `trip.reminder.channel`
 * to read the way `lib/digest/reminder.ts` does for the evening nudge — this
 * always sends by mail, when the owner has one on file.
 *
 * `dryRun` sends nothing and stamps nothing, so running it again afterwards —
 * dry or not — behaves exactly as if the dry run had never happened, the same
 * contract `sweepReminders`, `scripts/notify.mts` and `rates-refresh.mts`
 * already keep. Stamping only after a real send also means a failed mail
 * (owner has no address, provider down) is retried every night rather than
 * silently marked done — and `sweepStaging`'s own `expiresAt` fallback still
 * deletes the run on schedule even if the warning never manages to send.
 */
export async function sweepExpiryWarnings(
  now: Date,
  opts: { dryRun: boolean },
): Promise<ExpirySweepResult> {
  const warned: string[] = [];
  const finalNotices: string[] = [];

  for (const username of getUsernames()) {
    const user = getUser(username);
    if (!user) continue;

    for (const run of listRuns(username)) {
      const action = expiryActionFor(run, now);
      if (action.do === "nothing") continue;

      if (opts.dryRun) {
        (action.do === "warn" ? warned : finalNotices).push(run.runId);
        continue;
      }

      if (action.do === "warn") {
        const sent = await sendExpiryMail(username, user, run);
        if (!sent) continue;
        writeManifest(username, { ...run, warnedAt: now.toISOString(), expiresAt: action.expiresAt });
        warned.push(run.runId);
      } else {
        const sent = await sendFinalNoticeMail(username, user, run);
        if (!sent) continue;
        writeManifest(username, { ...run, finalNoticeAt: now.toISOString() });
        finalNotices.push(run.runId);
      }
    }
  }

  return { warned, finalNotices };
}

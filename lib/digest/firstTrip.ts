import "server-only";
import { recordFirstTripNudge } from "../journals";
import { ownerLocale } from "../messages/locale";
import { sendMail } from "../mail";
import { renderMail } from "../mail/template";
import { translateIn } from "../locales";
import type { StoredSubscription } from "../push";
import { sendPush } from "../push/send";
import { serverSite } from "../site";
import { earliestTodayISO } from "../tripTime";
import { getTrips } from "../trips";
import { getUser, getUsernames } from "../users";
import type { OwnerTips, UserConfig } from "../config";

/**
 * The first-trip nudge — B2447 (W44 D5) and B2448 item 4's push branch.
 *
 * A journal that opted into getting-started tips at signup and never adds a
 * trip hears about it once, ever: a push at day 2 if the owner's own device
 * is subscribed, otherwise a mail at day 3, and — after a push — a mail at
 * day 5 too. `scripts/first-trip.mts` is the only caller, run nightly next
 * to `reminders:send` (see `scripts/backup.sh`); this is a library so the
 * logic can be exercised without shelling out, the same split
 * `lib/digest/reminder.ts` uses.
 *
 * **Never invents content.** The message says only that the journal has no
 * trip yet — there is nothing else here to describe.
 */

const PUSH_AFTER_DAYS = 2;
const MAIL_AFTER_DAYS = 3;
const MAIL_AFTER_PUSH_DAYS = 5;

function daysSince(iso: string, today: string): number {
  const start = Date.parse(iso.slice(0, 10));
  const now = Date.parse(today);
  if (Number.isNaN(start) || Number.isNaN(now)) return 0;
  return Math.floor((now - start) / 86_400_000);
}

/**
 * Whether the owner's own device is subscribed to push — the check
 * `nudge.first.push` needs before it can ever fire.
 *
 * ponytail: not yet answerable, so this always answers `null` and the flow
 * below always takes the mail-only path. `StoredSubscription`
 * (lib/repos/types.ts) ties a subscription to a *reader* contact
 * (`contactId`, set by `findActiveContactId` in
 * app/api/push/subscribe/route.ts, which matches an *active contact* row) —
 * an owner is not a contact of their own journal, so a subscription made
 * from the owner's own browser (`/<user>/me`'s `PushOptIn`) is stored with
 * `contactId: null`, identical to a stranger's anonymous subscription to
 * the same public trip. There is nothing on `StoredSubscription` that means
 * "this browser is the owner's". Upgrade path: teach `saveSubscription` to
 * record that (a boolean, set from `resolveAccess`'s own owner check) and
 * read it here — until then this deliberately returns `null` rather than
 * guessing from the journal's subscriber list, which would otherwise risk
 * pushing an owner-only nudge to every reader who ever subscribed.
 */
function ownerPushSubscription(_username: string): StoredSubscription | null {
  return null;
}

export type FirstTripCandidate = { username: string; user: UserConfig; tips: OwnerTips; ageDays: number };

/** Every journal that opted into tips, has no trip yet, and has not already
 *  had its once-per-account nudge sent — ordered by `getUsernames()`. */
export function firstTripCandidates(today: string = earliestTodayISO()): FirstTripCandidate[] {
  const out: FirstTripCandidate[] = [];
  for (const username of getUsernames()) {
    const user = getUser(username);
    const tips = user?.owner.tips;
    if (!user || !tips?.optIn || tips.sentAt) continue;
    if (getTrips(username).length > 0) continue;
    out.push({ username, user, tips, ageDays: daysSince(tips.at, today) });
  }
  return out;
}

type NudgeAction = { kind: "push" } | { kind: "mail" } | { kind: "none" };

/** What today's sweep does for one candidate — pulled out so the decision
 *  itself needs no journal on disk to test. */
export function decideNudge(candidate: Pick<FirstTripCandidate, "tips" | "ageDays">, hasPush: boolean): NudgeAction {
  const { tips, ageDays } = candidate;
  if (hasPush) {
    if (!tips.pushedAt) return ageDays >= PUSH_AFTER_DAYS ? { kind: "push" } : { kind: "none" };
    return ageDays >= MAIL_AFTER_PUSH_DAYS ? { kind: "mail" } : { kind: "none" };
  }
  return ageDays >= MAIL_AFTER_DAYS ? { kind: "mail" } : { kind: "none" };
}

async function sendFirstTripPush(username: string, sub: StoredSubscription, locale: string): Promise<boolean> {
  const url = `${serverSite().url}/${encodeURIComponent(username)}/studio/trip/new`;
  const outcome = await sendPush({
    template: "nudge.first.push",
    subscriptions: sub,
    title: translateIn(locale, "push.firstTrip.title"),
    body: translateIn(locale, "push.firstTrip.body"),
    url,
    tag: "first-trip",
    locale,
  });
  return outcome.sent > 0;
}

async function sendFirstTripMail(username: string, user: UserConfig, locale: string): Promise<boolean> {
  if (!user.owner.email) return false;
  const subject = translateIn(locale, "mail.firstTripSubject", { journal: user.title });
  try {
    const result = await sendMail(
      renderMail(
        user.owner.email,
        subject,
        {
          template: "nudge.first.mail",
          preheader: subject,
          title: subject,
          blocks: [
            { kind: "paragraph", text: translateIn(locale, "mail.firstTripBody1", { journal: user.title }) },
            { kind: "paragraph", text: translateIn(locale, "mail.firstTripBody2") },
            {
              kind: "button",
              text: translateIn(locale, "mail.firstTripButton"),
              href: `${serverSite().url}/${encodeURIComponent(username)}/studio/trip/new`,
            },
          ],
          why: translateIn(locale, "mail.firstTripWhy", { journal: user.title }),
          manage: {
            text: translateIn(locale, "mail.firstTripManage"),
            href: `${serverSite().url}/${encodeURIComponent(username)}/studio/journal`,
          },
        },
        username,
      ),
    );
    return Boolean(result);
  } catch (err) {
    console.error(`[first-trip] could not mail ${username}:`, err);
    return false;
  }
}

export type FirstTripSweepResult = {
  checked: number;
  pushed: number;
  mailed: number;
  /** `[username, action]` for every nudge actually sent (or, dry-run, that
   *  would be) — what `--dry-run` prints and what a real run reports. */
  acted: [string, "push" | "mail"][];
};

/**
 * One nightly pass — `scripts/first-trip.mts`'s whole job.
 *
 * `dryRun` never sends and never records a stage, so running it twice in
 * the same night, or once for real after a dry run, behaves exactly as if
 * the dry run had not happened — the same contract `sweepReminders` and
 * `notify.mts --dry-run` keep.
 */
export async function sweepFirstTrip({ dryRun }: { dryRun: boolean }): Promise<FirstTripSweepResult> {
  const today = earliestTodayISO();
  const result: FirstTripSweepResult = { checked: 0, pushed: 0, mailed: 0, acted: [] };

  for (const candidate of firstTripCandidates(today)) {
    result.checked++;
    const { username, user } = candidate;
    const sub = ownerPushSubscription(username);
    const action = decideNudge(candidate, sub !== null);
    if (action.kind === "none") continue;

    const locale = await ownerLocale(username, user.owner.email ?? "", user.defaultLocale);

    if (dryRun) {
      result.acted.push([username, action.kind]);
      continue;
    }

    if (action.kind === "push" && sub) {
      const sent = await sendFirstTripPush(username, sub, locale);
      if (sent) {
        recordFirstTripNudge(username, "pushed");
        result.pushed++;
        result.acted.push([username, "push"]);
      }
    } else if (action.kind === "mail") {
      const sent = await sendFirstTripMail(username, user, locale);
      if (sent) {
        recordFirstTripNudge(username, "sent");
        result.mailed++;
        result.acted.push([username, "mail"]);
      }
    }
  }

  return result;
}

import "server-only";
import { recordFirstTripNudge } from "../journals";
import { ownerLocale } from "../messages/locale";
import { sendMail } from "../mail";
import { renderMail } from "../mail/template";
import type { Composition, PreviewLocale } from "../messages/previews/types";

/** `nudge.first.mail` is always mail — see `dayLetter.ts`'s `MailComposition`. */
type MailComposition = Extract<Composition, { channel: "mail" }>;
import { translateIn } from "../locales";
import { listSubscriptions, type StoredSubscription } from "../push";
import { sendPush } from "../push/send";
import { serverSite } from "../site";
import { earliestTodayISO } from "../tripTime";
import { getTrips } from "../trips";
import { getUser, getUsernames } from "../users";
import { tipsActive, type OwnerTips, type UserConfig } from "../config";

import { journalPath } from "../journalPath";
/**
 * The first-trip nudge — B2447 (W44 D5) and B2448 item 4's push branch.
 *
 * A new journal that never adds a trip hears about it once, ever (B2809):
 * a service message about the account just opened, no checkbox — one push
 * at day 2 if the owner's own device is subscribed, otherwise one mail at
 * day 3; a push is the whole reminder, no mail follows it. The owner can stop
 * it ("Stop these" in the mail, or the studio journal settings). `scripts/first-trip.mts` is the only caller, run nightly next
 * to `reminders:send` (see `scripts/backup.sh`); this is a library so the
 * logic can be exercised without shelling out, the same split
 * `lib/digest/reminder.ts` uses.
 *
 * **Never invents content.** The message says only that the journal has no
 * trip yet — there is nothing else here to describe.
 */

const PUSH_AFTER_DAYS = 2;
const MAIL_AFTER_DAYS = 3;

function daysSince(iso: string, today: string): number {
  const start = Date.parse(iso.slice(0, 10));
  const now = Date.parse(today);
  if (Number.isNaN(start) || Number.isNaN(now)) return 0;
  return Math.floor((now - start) / 86_400_000);
}

/**
 * The owner's own live push subscription(s) — the check `nudge.first.push`
 * needs before it can ever fire, newest first.
 *
 * `StoredSubscription.isOwner` (lib/repos/types.ts) is what makes this
 * answerable at all — B2448 item 4's follow-up. It is set once, at subscribe
 * time (`app/api/push/subscribe/route.ts`), from the same owner-cookie check
 * every other owner-only door uses, and re-decided fresh on every resubscribe
 * rather than trusted from a stale row, so a device that stops being the
 * owner's (a different browser, signed out) is not still counted here.
 * Never derived from the journal's whole subscriber list undifferentiated —
 * that would risk sending an owner-only nudge to every reader who ever
 * subscribed to a trip.
 */
async function ownerPushSubscription(username: string): Promise<StoredSubscription[]> {
  const subs = await listSubscriptions(username);
  return subs.filter((sub) => sub.isOwner).sort((a, b) => (a.created < b.created ? 1 : -1));
}

export type FirstTripCandidate = { username: string; user: UserConfig; tips: OwnerTips; ageDays: number };

/** Every journal whose owner has not stopped the reminder, has no trip yet,
 *  and has not already had its once-per-account nudge sent — ordered by `getUsernames()`. */
export function firstTripCandidates(today: string = earliestTodayISO()): FirstTripCandidate[] {
  const out: FirstTripCandidate[] = [];
  for (const username of getUsernames()) {
    const user = getUser(username);
    const tips = user?.owner.tips;
    if (!user || !tips || !tipsActive(tips) || tips.sentAt || tips.pushedAt) continue;
    if (getTrips(username).length > 0) continue;
    out.push({ username, user, tips, ageDays: daysSince(tips.at, today) });
  }
  return out;
}

type NudgeAction = { kind: "push" } | { kind: "mail" } | { kind: "none" };

/** What today's sweep does for one candidate — pulled out so the decision
 *  itself needs no journal on disk to test. */
function decideNudge(candidate: Pick<FirstTripCandidate, "ageDays">, hasPush: boolean): NudgeAction {
  const { ageDays } = candidate;
  if (hasPush) return ageDays >= PUSH_AFTER_DAYS ? { kind: "push" } : { kind: "none" };
  return ageDays >= MAIL_AFTER_DAYS ? { kind: "mail" } : { kind: "none" };
}

/**
 * The first-trip push's composition — pure, B2493. `username` only decides
 * the "add a trip" link, never a fact stated about anybody.
 */
export function composeFirstTripPush(
  input: { username: string; journalTitle: string },
  locale: PreviewLocale,
): Composition {
  return {
    channel: "push",
    title: translateIn(locale, "push.firstTrip.title", { journal: input.journalTitle }),
    text: translateIn(locale, "push.firstTrip.body", { journal: input.journalTitle }),
  };
}

/** The first-trip mail's composition — pure, same reasoning. */
export function composeFirstTripMail(
  input: { username: string; journalTitle: string },
  locale: PreviewLocale,
): MailComposition {
  const subject = translateIn(locale, "mail.firstTripSubject", { journal: input.journalTitle });
  return {
    channel: "mail",
    subject,
    content: {
      template: "nudge.first.mail",
      preheader: subject,
      title: subject,
      blocks: [
        { kind: "paragraph", text: translateIn(locale, "mail.firstTripBody1", { journal: input.journalTitle }) },
        { kind: "paragraph", text: translateIn(locale, "mail.firstTripBody2") },
        {
          kind: "button",
          text: translateIn(locale, "mail.firstTripButton"),
          href: `${serverSite().url}${journalPath(encodeURIComponent(input.username))}/studio/trip/new`,
        },
      ],
      why: translateIn(locale, "mail.firstTripWhy", { journal: input.journalTitle }),
      manage: {
        text: translateIn(locale, "mail.firstTripManage"),
        href: `${serverSite().url}${journalPath(encodeURIComponent(input.username))}/studio/journal`,
      },
      locale,
    },
  };
}

async function sendFirstTripPush(username: string, journal: string, subs: StoredSubscription[], locale: string): Promise<boolean> {
  const url = `${serverSite().url}${journalPath(encodeURIComponent(username))}/studio/trip/new`;
  const composed = composeFirstTripPush({ username, journalTitle: journal }, locale as PreviewLocale);
  const outcome = await sendPush({
    template: "nudge.first.push",
    subscriptions: subs,
    title: "title" in composed ? composed.title ?? "" : "",
    body: "text" in composed ? composed.text : "",
    url,
    tag: "first-trip",
    locale,
  });
  return outcome.sent > 0;
}

async function sendFirstTripMail(username: string, user: UserConfig, locale: string): Promise<boolean> {
  if (!user.owner.email) return false;
  const composed = composeFirstTripMail({ username, journalTitle: user.title }, locale as PreviewLocale);
  try {
    const result = await sendMail(renderMail(user.owner.email, composed.subject, composed.content, username));
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
    const subs = await ownerPushSubscription(username);
    const action = decideNudge(candidate, subs.length > 0);
    if (action.kind === "none") continue;

    const locale = await ownerLocale(username, user.owner.email ?? "", user.defaultLocale);

    if (dryRun) {
      result.acted.push([username, action.kind]);
      continue;
    }

    if (action.kind === "push" && subs.length > 0) {
      const sent = await sendFirstTripPush(username, user.title, subs, locale);
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

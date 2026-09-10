import "server-only";
import fs from "node:fs";
import path from "node:path";
import { AS_AUTHOR, getDays } from "../entries";
import { translateIn } from "../locales";
import { pickLocale } from "../contacts/locale";
import { sendMail } from "../mail";
import { renderMail } from "../mail/template";
import { serverSite } from "../site";
import { earliestTodayISO } from "../tripTime";
import { getTrips, type TripRef } from "../trips";
import type { ReminderChannel, Trip } from "../types";
import { getUser, getUsernames, userDir } from "../users";
import type { UserConfig } from "../config";
import { sendWhatsapp } from "../whatsapp";
import { reminderTemplate } from "../whatsapp/settings";

/**
 * The evening nudge itself — B1219, D46, and B673's open question answered.
 *
 * Everything about *whether a trip wants one* lives in `trip.md` and is read
 * through `lib/trips.ts`; this module only decides, each night, which of
 * those trips are actually due, and sends the one nudge that goes with it.
 * `scripts/reminders.mts` is the only caller — this is a library so the logic
 * can be exercised without shelling out.
 *
 * **Never invents content.** The message says only that nothing has been
 * written yet — the same restraint every other letter in `lib/digest/`
 * follows, one level earlier: there is no day here to describe at all.
 */

/** Whether `trip`'s own dates cover `today` — the literal reading of "only
 *  during the trip's date range", rather than the author's own `status:`,
 *  which can be stale the way `hasBegun`/`isOver` exist to correct for
 *  elsewhere. A reminder has nothing to correct for: it only ever needs
 *  today's date against the two the trip was written with. */
function isRunning(trip: Trip, today: string): boolean {
  return trip.start <= today && today <= trip.end;
}

/** Whether *anything* — draft included — has been written for this calendar
 *  day. A draft still means the author sat down and wrote; the reminder is
 *  about the day going by with nothing at all. */
function hasWrittenToday(ref: TripRef, today: string): boolean {
  return getDays(ref, AS_AUTHOR).some((day) => day.date === today);
}

/** Every trip in this journal that wants a reminder tonight — opted in,
 *  running today, and with nothing written for today yet. Ordered the way
 *  `getTrips` already orders them (current first), so the first entry is the
 *  one journal's own single nudge, if more than one trip somehow qualifies. */
export function dueTrips(username: string, today: string = earliestTodayISO()): Trip[] {
  return getTrips(username).filter(
    (trip) => trip.reminder && isRunning(trip, today) && !hasWrittenToday(trip.ref, today),
  );
}

/** Where this journal's own "already nudged today" fact lives — a marker
 *  file beside `content/<user>/whatsapp/.greeted/`'s own shape, because it is
 *  a fact about a send having happened rather than content of the journal
 *  itself, and it needs no database to be reliable across whichever backend
 *  a deployment runs. `content/<user>/.reminder-sent.json`. */
function markerFile(username: string): string {
  return path.join(userDir(username), ".reminder-sent.json");
}

/** At most one nudge per journal per day, whichever trip it was about — the
 *  ticket's own limit, read literally: a journal running two trips at once
 *  still gets one evening, not one per trip. */
function alreadySentToday(username: string, today: string): boolean {
  try {
    const raw = JSON.parse(fs.readFileSync(markerFile(username), "utf8")) as { lastSentDate?: unknown };
    return raw.lastSentDate === today;
  } catch {
    return false;
  }
}

function markSentToday(username: string, today: string): void {
  const file = markerFile(username);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ lastSentDate: today }, null, 2)}\n`, "utf8");
}

type ReminderOutcome =
  | { sent: true; channel: ReminderChannel }
  | { sent: false; reason: string };

/** Send tonight's one nudge for this trip, on the channel its own `trip.md`
 *  names. Never throws: a reminder that fails must not take the rest of the
 *  night's sweep down with it, the same reasoning `recordUsage` follows. */
async function sendReminder(username: string, user: UserConfig, trip: Trip): Promise<ReminderOutcome> {
  const channel = trip.reminder?.channel;
  if (!channel) return { sent: false, reason: "not_enabled" };
  const locale = pickLocale(user.defaultLocale);

  if (channel === "mail") {
    if (!user.owner.email) return { sent: false, reason: "no_owner_email" };
    try {
      const result = await sendMail(
        renderMail(
          user.owner.email,
          translateIn(locale, "mail.reminderSubject", { trip: trip.title }),
          {
            preheader: translateIn(locale, "mail.reminderBody", { trip: trip.title }),
            title: translateIn(locale, "mail.reminderTitle"),
            blocks: [
              { kind: "paragraph", text: translateIn(locale, "mail.reminderBody", { trip: trip.title }) },
              {
                kind: "button",
                text: translateIn(locale, "mail.reminderButton"),
                href: `${serverSite().url}/agent`,
              },
            ],
            footer: translateIn(locale, "contact.mailFooter", { site: user.title }),
          },
          username,
        ),
      );
      return result ? { sent: true, channel: "mail" } : { sent: false, reason: "mail_off" };
    } catch (err) {
      console.error(`[reminders] could not mail ${username} about ${trip.ref}:`, err);
      return { sent: false, reason: "mail_failed" };
    }
  }

  // whatsapp — refused at write time (`lib/api/tripReminder.ts`) unless a
  // template and a proven number were both already on file, so a trip
  // carrying this channel should always be able to send; checked again here
  // rather than trusted, since either can have been withdrawn since.
  const template = reminderTemplate();
  if (!template || !user.owner.tel) return { sent: false, reason: "whatsapp_unavailable" };
  try {
    const result = await sendWhatsapp({
      to: user.owner.tel,
      template: template.name,
      language: template.language,
      body: [trip.title],
      username,
    });
    return result ? { sent: true, channel: "whatsapp" } : { sent: false, reason: "whatsapp_off" };
  } catch (err) {
    console.error(`[reminders] could not WhatsApp ${username} about ${trip.ref}:`, err);
    return { sent: false, reason: "whatsapp_failed" };
  }
}

export type SweepResult = {
  checked: number;
  sent: number;
  /** `[username, trip ref, channel]` for every nudge actually sent — what
   *  `--dry-run` prints instead of sending, and what the real run logs. */
  notified: [string, string, ReminderChannel][];
};

/**
 * One pass over every journal on this instance — `scripts/reminders.mts`'s
 * whole job, pulled out so it can be tested without a process to run.
 *
 * `dryRun` never sends and never marks a journal as nudged, so running it
 * twice in the same night, or once for real after a dry run, behaves exactly
 * as if the dry run had not happened — the same contract `rates-refresh.mts`
 * and `notify.mts --dry-run` already keep.
 */
export async function sweepReminders({ dryRun }: { dryRun: boolean }): Promise<SweepResult> {
  const today = earliestTodayISO();
  const result: SweepResult = { checked: 0, sent: 0, notified: [] };

  for (const username of getUsernames()) {
    const user = getUser(username);
    if (!user) continue;

    const due = dueTrips(username, today);
    result.checked += due.length;
    if (due.length === 0) continue;
    if (alreadySentToday(username, today)) continue;

    const trip = due[0];
    if (dryRun) {
      result.notified.push([username, trip.ref, trip.reminder!.channel]);
      continue;
    }

    const outcome = await sendReminder(username, user, trip);
    if (outcome.sent) {
      markSentToday(username, today);
      result.sent++;
      result.notified.push([username, trip.ref, outcome.channel]);
    }
  }

  return result;
}

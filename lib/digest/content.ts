import { monthNames } from "../i18n";
import type { Locale } from "../types";

/**
 * The two pieces of a letter's presentation that outlived the weekly digest.
 *
 * This file was ROADMAP D2's "3 new days since you last looked" — the
 * watermark arithmetic that worked out what was new for one reader, dropped
 * `test: true` days without advancing the cursor over them, and capped the
 * listing at six days so a mail stayed readable on a phone. B387 deleted the
 * weekly digest, and all of that went with it: nothing computes "what is new
 * since last time" any more, because nothing sends on a schedule.
 *
 * What is left is what `dayLetter.ts` still asks for — a date in the reader's
 * language, and a durable link to one day. Both are presentation, both are
 * pure, and neither has anything to do with the digest beyond having lived
 * here.
 *
 * The interesting reasoning that went with the deleted half — why "new" meant
 * a day's *date* rather than a file mtime, and why a test day had to leave the
 * watermark where it stood — is in the git history rather than restated here.
 * A future scheduled sender should read it before rebuilding the same thing
 * differently.
 */

/** `26 August` / `26. August` / `augusztus 26.` — the same shapes the site uses. */
export function formatDigestDate(locale: Locale, iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  const day = date.getUTCDate();
  const month = monthNames(locale)[date.getUTCMonth()];
  if (locale === "de") return `${day}. ${month}`;
  if (locale === "hu") return `${month} ${day}.`;
  return `${day} ${month}`;
}

/**
 * The URL of one day, fully qualified.
 *
 * Always the `/trips/<id>/` form, never the bare `/day/<slug>` shortcut the
 * current trip also answers on: the shortcut moves when the next trip starts,
 * and a link in an email has to still work in a year.
 */
export function dayUrl(base: string, username: string, tripId: string, slug: string): string {
  return `${base}/${username}/trips/${tripId}/day/${slug}`;
}

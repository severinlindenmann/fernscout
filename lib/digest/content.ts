import { monthNames } from "../i18n";
import type { Locale, Trip } from "../types";
import { getDays } from "../entries";

/**
 * What is new for one reader, per trip — the "3 new days since you last
 * looked" of ROADMAP D2, worked out rather than announced.
 *
 * ## What "new" means here
 *
 * A day is new when its **date** is after the reader's watermark. Not its file
 * modification time, not a `published_at` column that does not exist: the site
 * already tells a returning reader "N new days since your last visit" by
 * comparing `day.date` to their last visit (see `app/TripStory.tsx`), and the
 * mail saying something different from the page it links to would be worse than
 * either answer being imperfect.
 *
 * The imperfection is worth naming: an entry written today about a day three
 * weeks ago is not "new" by this rule and will not be mailed. That is the right
 * trade for a travel journal, where filling in a missed day is routine and a
 * digest that re-announces last month every time somebody edits a typo is not.
 */

/** How many days one mail lists before it stops being readable on a phone. */
export const MAX_DAYS_LISTED = 6;

export type DigestDay = {
  date: string;
  slug: string;
  title: string;
  location: string;
  /** Absolute, because it is going into an email. */
  url: string;
};

export type DigestTripSummary = {
  ref: string;
  tripId: string;
  title: string;
  url: string;
  /** The days listed in the mail, oldest first. */
  days: DigestDay[];
  /** How many are new in total — `days.length` plus whatever was trimmed. */
  newDays: number;
};

export type DigestContent = {
  trips: DigestTripSummary[];
  /** New days across every trip this reader may see. */
  dayCount: number;
  /** The newest day date covered: the watermark to store afterwards. */
  cursor: string;
};

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

/** An entry's title in the reader's language, falling back to what was
 * written. `en` is the language entries are authored in, so it never has an
 * override — same rule as `LocaleProvider.localized`. */
function localizedEntryTitle(
  locale: Locale,
  entry: { title: string; translations?: Partial<Record<"de" | "hu", { title?: string }>> },
): string {
  if (locale === "en") return entry.title;
  return entry.translations?.[locale]?.title ?? entry.title;
}

function localizedTripTitle(locale: Locale, trip: Trip): string {
  if (locale === "en") return trip.title;
  return trip.translations?.[locale]?.title ?? trip.title;
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

export function tripUrl(base: string, username: string, tripId: string): string {
  return `${base}/${username}/trips/${tripId}`;
}

/**
 * What to tell one reader about one set of trips.
 *
 * `since` is a `YYYY-MM-DD` watermark, or null for a reader who has never been
 * written to — in which case the caller decides what "since" means (usually the
 * day they were approved), because "everything ever" is not a digest.
 *
 * `today` is the far end, and it is not decoration: a journal written a day
 * ahead (or a trip whose plan carries dated entries) must not have tomorrow
 * announced tonight, and the cursor must not jump past days nobody has read.
 */
export function buildDigestContent(options: {
  username: string;
  trips: Trip[];
  since: string | null;
  /**
   * Whether `since` itself counts as new.
   *
   * True on a reader's **first** digest, where `since` is the day they were
   * let in rather than the last day they were sent. Days are dated by day, so
   * an exclusive comparison there meant somebody approved in the morning never
   * received the day written that evening — not late, never. False afterwards,
   * where `since` is the newest day already sent and re-sending it would be a
   * duplicate.
   */
  includeSince?: boolean;
  /** `YYYY-MM-DD`. Days after it are not new yet. */
  today: string;
  locale: Locale;
  /** Origin, no trailing slash. */
  base: string;
}): DigestContent | null {
  const { username, trips, since, includeSince = false, today, locale, base } = options;
  const summaries: DigestTripSummary[] = [];
  let cursor = since ?? "";
  let dayCount = 0;

  for (const trip of trips) {
    const fresh = getDays(trip.ref).filter(
      (day) =>
        day.date <= today &&
        (since === null || (includeSince ? day.date >= since : day.date > since)),
    );
    if (fresh.length === 0) continue;

    dayCount += fresh.length;
    for (const day of fresh) if (day.date > cursor) cursor = day.date;

    // Trimmed from the front: the most recent days are the ones a reader
    // wants, and the older ones are still one tap away behind the button.
    const listed = fresh.slice(-MAX_DAYS_LISTED);
    summaries.push({
      ref: trip.ref,
      tripId: trip.id,
      title: localizedTripTitle(locale, trip),
      url: tripUrl(base, username, trip.id),
      newDays: fresh.length,
      days: listed.map((day) => ({
        date: day.date,
        slug: day.lead.slug,
        title: localizedEntryTitle(locale, day.lead),
        location: day.lead.location,
        url: dayUrl(base, username, trip.id, day.lead.slug),
      })),
    });
  }

  if (dayCount === 0 || cursor === "") return null;
  return { trips: summaries, dayCount, cursor };
}

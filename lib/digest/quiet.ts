import type { Locale } from "../types";

/**
 * The quiet rules — ROADMAP D8: never more than one digest a day, and never in
 * the reader's night.
 *
 * ## The timezone problem, and what this file does about it
 *
 * A contact record has a language. It does not have a timezone, and this
 * package deliberately does not add one, because a field nobody fills in is
 * worse than no field at all: it would sit at whatever the form defaulted to
 * and then be trusted, which is how you end up authorising a 3am email with a
 * straight face. The honest options were:
 *
 * 1. **Ask each reader for their timezone.** Correct, and unusable — the
 *    audience is ~20–50 people, many in their seventies, and the preferences
 *    page (D6) already asks them for a language and a postal address. A
 *    timezone dropdown is the field that makes them close the tab.
 * 2. **Guess from the language.** Wrong in general, and *right for this
 *    audience*: `de` and `hu` speakers are, to a very good approximation, in
 *    CET/CEST — Zurich and Budapest are the same offset all year, so for two of
 *    the three languages this journal speaks the guess is exact.
 * 3. **Use one zone for everybody**, the journal's own.
 *
 * What is implemented is 2 falling back to 3. `en` gets no band, because
 * English readers are genuinely everywhere and pretending otherwise would be
 * the dishonest kind of guess; they fall back to `DIGEST_TIMEZONE` (default
 * `Europe/Zurich`), which is where the person running the journal is and
 * therefore where most of their readers are too.
 *
 * The consequence is stated rather than hidden: a Hungarian-speaking reader who
 * has moved to Auckland can be written to at a bad hour. The fix, when somebody
 * actually says so, is a `timezone` column filled in from the preferences page —
 * one migration and one `<select>`, and every guess here becomes a fallback.
 * Building that column now, for nobody, would only mean shipping a field full
 * of confident wrong answers.
 *
 * Everything here is pure and takes `now` as an argument, so the rules can be
 * tested at 3am in Budapest without waiting until 3am in Budapest.
 */

/** Where the journal lives, when nothing better is known. */
export const DEFAULT_TIMEZONE = "Europe/Zurich";

/**
 * Language → the timezone band its readers are overwhelmingly in.
 *
 * Only for languages where that sentence is true. `en` is absent on purpose.
 */
const LOCALE_ZONE: Partial<Record<Locale, string>> = {
  de: "Europe/Zurich",
  hu: "Europe/Budapest",
};

/** Local hours a digest may be sent in: 08:00 up to but not including 21:00. */
export type QuietWindow = { from: number; to: number };

export const DEFAULT_WINDOW: QuietWindow = { from: 8, to: 21 };

function isUsableZone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** The instance's own zone: `DIGEST_TIMEZONE`, or Zurich. */
export function journalTimezone(): string {
  const configured = process.env.DIGEST_TIMEZONE;
  if (configured && isUsableZone(configured)) return configured;
  if (configured) {
    console.warn(`[digest] DIGEST_TIMEZONE "${configured}" is not a zone — using UTC.`);
    return "UTC";
  }
  return DEFAULT_TIMEZONE;
}

/** The zone a reader is assumed to be in. See the note at the top of the file. */
export function timezoneFor(locale: Locale | null, fallback?: string): string {
  const band = locale ? LOCALE_ZONE[locale] : undefined;
  return band ?? fallback ?? journalTimezone();
}

/**
 * The wall-clock hour in `timezone`, 0–23.
 *
 * `Intl` rather than an offset table: the offset of `Europe/Zurich` is not a
 * constant, and a digest sent at what the code thinks is 08:00 and the reader's
 * clock says is 07:00 is exactly the bug D8 exists to prevent.
 */
export function localHour(now: Date, timezone: string): number {
  const hour = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    hour12: false,
  }).format(now);
  // "24" is how some ICU versions spell midnight in this format.
  return Number(hour) % 24;
}

/** The calendar date in `timezone`, as `YYYY-MM-DD`. */
export function localDate(now: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Is it a decent hour where this reader is? */
export function isAwake(now: Date, timezone: string, window: QuietWindow = DEFAULT_WINDOW): boolean {
  const hour = localHour(now, timezone);
  return hour >= window.from && hour < window.to;
}

/**
 * "Never more than one a day", counted in the reader's own calendar.
 *
 * Calendar days rather than "24 hours since the last one": a job that runs at
 * 09:00 every morning drifts by a few seconds, and a strict 24-hour rule turns
 * that into a digest every *other* day, which is a maddening bug to diagnose.
 */
export function alreadySentToday(
  lastAttemptAt: string | null | undefined,
  now: Date,
  timezone: string,
): boolean {
  if (!lastAttemptAt) return false;
  const last = new Date(lastAttemptAt);
  if (Number.isNaN(last.getTime())) return false;
  return localDate(last, timezone) === localDate(now, timezone);
}

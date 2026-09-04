/**
 * The journal's own timezone, and nothing else any more.
 *
 * This file was the quiet rules — ROADMAP D8: never more than one digest a day,
 * never in the reader's night, with a careful argument about guessing a
 * reader's zone from their language because a contact record has no timezone
 * field. All of that belonged to the weekly digest, and B387 deleted it: the
 * digest was never scheduled on this instance and the owner did not want it.
 *
 * What survives is the one function the **day letter** uses. `sendDayLetter`
 * states the journal's zone plainly in a letter's meta line — "timezone:
 * Europe/Zurich" — and deliberately computes no clock from it, so a day
 * published three weeks late does not announce a confidently wrong "it is 9pm
 * there". That is the whole of the requirement now.
 *
 * The per-reader guessing (`timezoneFor`, `localHour`, `isAwake`,
 * `alreadySentToday`) went with the digest, because nothing sends on a
 * schedule any more and a quiet window only means something to a sender that
 * chooses its own moment. A day letter goes when a person publishes a day,
 * which is a person deciding, at an hour they picked. If a scheduled sender
 * ever returns it will need those rules again — and it should reread D8's
 * reasoning rather than restore this code, because the argument is the
 * valuable part and it is in the git history either way.
 */

/** Where the journal lives, when nothing better is known. */
const DEFAULT_TIMEZONE = "Europe/Zurich";

function isUsableZone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The instance's own zone: `DIGEST_TIMEZONE`, or Zurich.
 *
 * The environment variable keeps its name. Renaming it would be a silent
 * behaviour change on every deployment that sets it — the letter would quietly
 * fall back to Zurich — and this is a rename that has to happen in a runbook
 * and a `.env` at the same time as the code, not in a deletion.
 */
export function journalTimezone(): string {
  const configured = process.env.DIGEST_TIMEZONE;
  if (configured && isUsableZone(configured)) return configured;
  if (configured) {
    console.warn(`[mail] DIGEST_TIMEZONE "${configured}" is not a zone — using UTC.`);
    return "UTC";
  }
  return DEFAULT_TIMEZONE;
}

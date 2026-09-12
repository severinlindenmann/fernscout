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

/**
 * A fixed offset, in every spelling ECMA-402 grew.
 *
 * `+02:00`, `+0200`, `+02` and `-05:00` are all accepted by
 * `Intl.DateTimeFormat` as time zones now, and so is `\u221202:00` — the
 * Unicode minus, which is not the ASCII hyphen and would slip a naive check.
 * Anchored on the sign, because that is the one thing every offset form has
 * and no IANA region name has.
 */
const OFFSET_ZONE = /^[+\-\u2212]/;

/**
 * Exported since B42: the same "is this a real IANA name" check an entry's
 * own `timezone` field is validated with (`lib/validate/entry.ts`), rather
 * than a second copy of the same `try/catch Intl.DateTimeFormat`.
 *
 * **`Intl` alone stopped being enough, and nothing here changed to cause it**
 * — B1579. ECMA-402 added offset time zones, so the platform this delegates to
 * began accepting `+02:00` as readily as `Europe/Zurich`, and the refusal a
 * caller reads still said *"an IANA zone name — not an offset"*. It was true
 * when it was written and had quietly stopped being true.
 *
 * An offset is refused because it is **not a zone**: it carries no daylight
 * saving. Zurich is `+02:00` in July and `+01:00` in January, and
 * `Europe/Zurich` knows that while `+02:00` does not — so a day stamped with
 * an offset renders its local time an hour out for half the year, on whichever
 * side of the change it was not written. Deciding what a reader's "their time"
 * is computed against is the whole reason the field exists (B42), and it is
 * exactly the computation an offset gets wrong.
 *
 * `Etc/GMT+5` stays accepted. It is a real IANA name with no daylight saving
 * of its own, which is a deliberate choice somebody can make rather than a
 * value that arrived because a phone reported its offset.
 *
 * An allow-list was the other candidate — `Intl.supportedValuesOf("timeZone")`
 * — and is worse: it is case-sensitive where `Intl` is not, so `europe/zurich`
 * would start being refused, and it holds only canonical names, so whether an
 * alias like `Asia/Calcutta` survives depends on the runtime's version of the
 * database rather than on anything this project decided.
 */
export function isUsableZone(timezone: string): boolean {
  if (OFFSET_ZONE.test(timezone.trim())) return false;
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

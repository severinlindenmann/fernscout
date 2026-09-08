/**
 * What speech costs, and which language it is transcribed in — B686.
 *
 * Pure and client-safe (no `server-only`), for the same reason
 * `./credits.ts` is: the record button has to say the price before the hold,
 * from the seconds it is counting, and the route that actually spends has to
 * compute the identical number. One function, so the two cannot drift.
 *
 * **The language is the whole design of this ticket, and it is not detected.**
 * Deepgram's automatic detection (`language=multi`) covers ten languages;
 * Swiss German and Hungarian are not among them, and both exist as explicit
 * codes on Nova-3. Detection is therefore the one choice that fails silently
 * for two of the four languages this exists for: a Swiss German speaker comes
 * back as standard German, a Hungarian speaker comes back as nothing usable,
 * and no error is raised, because detection *succeeded*. So the language is
 * taken from the journal, passed explicitly, and a person whose voice is not
 * their journal's language overrides it on the button.
 */

/**
 * The languages this instance will transcribe, as Deepgram's own codes.
 *
 * The four B686 names. Adding one is adding a row here and a label in
 * `site/locales/`; nothing else reads this list.
 */
export const SPEECH_LANGUAGES = ["en", "de", "de-CH", "hu"] as const;
export type SpeechLanguage = (typeof SPEECH_LANGUAGES)[number];

/**
 * One credit per five **started** minutes, and the number lives here only —
 * the same shape `PHOTOS_PER_CREDIT` has in `./credits.ts`, so the button and
 * the route cannot disagree about the price.
 *
 * It was a credit a minute until the owner priced it on 2026-09-07: Deepgram
 * Nova-3 pre-recorded is $0.0043 a minute, so a credit (CHF 0.20) a minute was
 * a ~45x markup and made speech the expensive way into this product — which is
 * backwards, since talking is the thing it exists to make easy. At five
 * minutes to the credit the markup is still roughly 9x, and describing three
 * minutes of your day costs one credit.
 *
 * Whole numbers only: `lib/credits.ts` throws on a fractional spend.
 */
const SECONDS_PER_CREDIT = 300;

/** How long one hold may be. Longer than the five-minute video cap (B670)
 *  because the price ladder above expects recordings past five minutes; past
 *  this somebody is dictating a book rather than talking about a day. */
export const MAX_SPEECH_SECONDS = 900;

/**
 * How long a *spoken search* may run — B1006.
 *
 * Ten seconds, and it is a different number from the one above because it is
 * a different thing: fifteen minutes is a person dictating a day, and this is
 * a person saying a sentence. A search box whose microphone can be left open
 * for a quarter of an hour is a search box that can quietly spend somebody's
 * credits on the sound of an empty room.
 *
 * The server's ceiling does not move — this is the browser stopping itself,
 * and `MAX_SPEECH_SECONDS` is still what the route refuses past.
 */
export const SEARCH_SPEECH_SECONDS = 10;

/** A ceiling on the bytes, independent of the seconds claimed: an upload is a
 *  thing a caller controls and the duration is a thing a caller *says*. Five
 *  minutes of Opus at 32 kbit/s is about 1.2 MB, so this is generous. */
export const MAX_AUDIO_BYTES = 16 * 1024 * 1024;

/**
 * What a recording of this many seconds costs, in credits — B987.
 *
 * **By the second, rounded up to the hundredth**, which is the smallest thing
 * this product can charge for. Five minutes still costs exactly one credit
 * (the price did not change); what changed is that a six-second question now
 * costs two hundredths rather than the same whole credit as five minutes of
 * dictation. The provider meters by the second and so, now, does this.
 *
 * The floor is one hundredth, so a recording of any length at all costs
 * something: a charge of nothing is a charge nobody can audit.
 */
export function creditsForSeconds(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0.01;
  return Math.max(1, Math.ceil((seconds * 100) / SECONDS_PER_CREDIT)) / 100;
}

/** The price to print on the button before the hold, in minutes. */
export const MINUTES_PER_CREDIT = SECONDS_PER_CREDIT / 60;

/**
 * One language tag, narrowed to a code the transcriber actually supports.
 *
 * Exact first, and that ordering is the point: `de-CH` is in the list, so a
 * Swiss journal matches it outright and is never widened to `de`. The regional
 * fallback below only ever fires for a tag that is *not* supported exactly —
 * `de-DE` and `de-AT` become `de`, which is the same language — so nothing
 * this function does can quietly send somebody's Swiss German to the German
 * model.
 */
function supported(tag: string | null | undefined): SpeechLanguage | null {
  const wanted = (tag ?? "").trim();
  if (wanted === "") return null;
  const exact = SPEECH_LANGUAGES.find((code) => code.toLowerCase() === wanted.toLowerCase());
  if (exact) return exact;
  const base = wanted.split("-")[0].toLowerCase();
  return SPEECH_LANGUAGES.find((code) => code.toLowerCase() === base) ?? null;
}

/**
 * Which language to transcribe in, from what the request knows.
 *
 * The journal's own locale before the reader's, deliberately: a journal
 * written in Swiss German is a journal whose owner speaks Swiss German, and
 * whether they happen to be reading their own site in English today says
 * nothing about the voice recording it. The UI locale is only the answer when
 * the journal's own language is one this cannot transcribe.
 *
 * **An override that is not supported is refused rather than approximated.**
 * Somebody who picked a language meant it; answering with a different one is
 * the silent failure this module exists to prevent, one layer up from
 * detection.
 */
export function speechLanguageFor(
  override: string | null | undefined,
  journalLocale: string | null | undefined,
  uiLocale?: string | null,
): SpeechLanguage | null {
  if ((override ?? "").trim() !== "") return supported(override);
  return supported(journalLocale) ?? supported(uiLocale);
}

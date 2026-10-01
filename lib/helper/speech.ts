/**
 * Which language speech is transcribed in — B686.
 *
 * Pure and client-safe (no `server-only`): the record button and the route
 * that actually transcribes both need the same language rule, so it lives
 * here rather than being computed twice.
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
 * The four B686 names, plus French and Italian — both explicit Nova-3 codes,
 * added with those interface languages. Adding one is adding a row here and a
 * label in `site/locales/`; nothing else reads this list.
 */
export const SPEECH_LANGUAGES = ["en", "de", "de-CH", "hu", "fr", "it"] as const;
export type SpeechLanguage = (typeof SPEECH_LANGUAGES)[number];

/**
 * Each language's own name, in itself — never translated, the same
 * convention `LOCALE_LABEL` in lib/i18n.ts uses for a list of languages.
 * Shared by `RecordButton`'s per-recording select and `TripModeStep`'s
 * once-before-the-first-recording question (B1803 Task 4.1) so the two
 * cannot drift into naming the same languages differently.
 */
export const SPEECH_LANGUAGE_LABEL: Record<SpeechLanguage, string> = {
  en: "English",
  de: "Deutsch",
  "de-CH": "Schwiizerdütsch",
  hu: "Magyar",
  fr: "Français",
  it: "Italiano",
};

/** How long one hold may be. Longer than the five-minute video cap (B670)
 *  because the price ladder above expects recordings past five minutes; past
 *  this somebody is dictating a book rather than talking about a day. */
export const MAX_SPEECH_SECONDS = 900;

/** A ceiling on the bytes, independent of the seconds claimed: an upload is a
 *  thing a caller controls and the duration is a thing a caller *says*. Five
 *  minutes of Opus at 32 kbit/s is about 1.2 MB, so this is generous. */
export const MAX_AUDIO_BYTES = 16 * 1024 * 1024;

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

"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Languages, Mic } from "lucide-react";
import { useI18n } from "@/components/LocaleProvider";
import RecordButton from "@/components/RecordButton";
import {
  SPEECH_LANGUAGE_LABEL,
  SPEECH_LANGUAGES,
  speechLanguageFor,
  type SpeechLanguage,
} from "@/lib/helper/speech";
import { appendSpoken, clock, undoSpoken } from "@/lib/studio/speak";

/**
 * Under a day's words: the "Speak" pill, the language chip, and afterwards
 * "Added · 0:12 in English" with Undo — B2761.
 *
 * The chip names the language the server will use: the person's own pick for
 * this journal on this phone, else the journal's language (`defaultLanguage`,
 * from the page — the same `speechLanguageFor` rule the transcribe route
 * applies). That code is always sent explicitly, so what the chip says is
 * what is transcribed.
 */
export default function SpeakTray({
  username,
  speech,
  trip,
  defaultLanguage,
  value,
  setValue,
}: {
  username: string;
  speech: { consented: boolean; provider: string; aiAvailable?: boolean | null };
  trip?: string;
  /** The journal's speech language; absent -> the reader's own UI language. */
  defaultLanguage?: SpeechLanguage;
  /** The text this tray writes into, and how to replace it. */
  value: string;
  setValue: (next: (prev: string) => string) => void;
}) {
  const { t, locale } = useI18n();
  const key = `fs.speech.${username}`;
  const journalLanguage = defaultLanguage ?? speechLanguageFor(null, null, locale) ?? "en";
  const [override, setOverride] = useState("");
  useEffect(() => {
    try {
      setOverride(window.localStorage.getItem(key) ?? "");
    } catch {
      // No storage: the journal's language, which is right anyway.
    }
  }, [key]);
  const language = speechLanguageFor(override, journalLanguage) ?? journalLanguage;
  const label = SPEECH_LANGUAGE_LABEL[language];

  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [added, setAdded] = useState<{ said: string; text: string; seconds: number; label: string } | null>(null);
  const latest = useRef(value);
  latest.current = value;

  function pick(code: SpeechLanguage) {
    setOverride(code);
    try {
      window.localStorage.setItem(key, code);
    } catch {
      // Forgotten on reload; still used now.
    }
    setPicking(false);
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-t border-line-quiet bg-surface-raised px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex min-h-11 items-center gap-2 rounded-full bg-mic-fill px-5 text-base font-semibold text-on-deep transition-transform duration-75 active:scale-[0.96]"
        >
          <Mic className="h-5 w-5" aria-hidden />
          {t("studio.speak.speak")}
        </button>
        <button
          type="button"
          onClick={() => setPicking(true)}
          aria-label={t("studio.speak.chipLabel", { language: label })}
          className="flex min-h-11 items-center gap-1.5 rounded-full border border-line-strong px-3 text-sm font-semibold text-ink-body"
        >
          <Languages className="h-4 w-4" aria-hidden />
          {label}
          <ChevronDown className="h-4 w-4" aria-hidden />
        </button>
      </div>
      {added && value === added.text && (
        <p role="status" className="fs-speak-added mt-2 flex items-center justify-between gap-2 rounded-xl px-3 text-sm text-ink-body">
          <span>{t("studio.speak.added", { time: clock(added.seconds), language: added.label })}</span>
          <button
            type="button"
            onClick={() => {
              const said = added.said;
              setValue((prev) => undoSpoken(prev, said));
              setAdded(null);
            }}
            className="min-h-11 px-2 font-semibold text-ink-strong underline underline-offset-2"
          >
            {t("studio.speak.undo")}
          </button>
        </p>
      )}

      {open && (
        <RecordButton
          username={username}
          consented={speech.consented}
          provider={speech.provider}
          aiAvailable={speech.aiAvailable}
          trip={trip}
          language={language}
          hold={false}
          sheet={{ onClose: () => setOpen(false), languageLabel: label }}
          onText={(said, _uncertain, held) => {
            const text = appendSpoken(latest.current, said);
            setValue(() => text);
            setAdded({ said, text, seconds: held ?? 0, label });
          }}
        />
      )}

      {picking && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={t("studio.speak.langTitle")}>
          <button type="button" aria-label={t("studio.speak.close")} onClick={() => setPicking(false)} className="fs-speak-scrim absolute inset-0 bg-overlay-strong/70" />
          <div className="fs-speak-sheet absolute inset-x-0 bottom-0 mx-auto max-w-md rounded-t-[28px] border-t border-line-quiet bg-surface-base px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <h2 className="font-display text-xl font-semibold text-ink-strong">{t("studio.speak.langTitle")}</h2>
            <p className="mt-1 text-sm text-ink-secondary">{t("studio.speak.langCopy")}</p>
            <ul className="mt-3 space-y-1.5">
              {SPEECH_LANGUAGES.map((code) => (
                <li key={code}>
                  <button
                    type="button"
                    aria-pressed={code === language}
                    onClick={() => pick(code)}
                    className={`flex min-h-12 w-full items-center justify-between rounded-xl border px-3 text-left text-base ${
                      code === language ? "border-coral-400 bg-surface-raised font-semibold text-ink-strong" : "border-line-quiet text-ink-body"
                    }`}
                  >
                    <span>{SPEECH_LANGUAGE_LABEL[code]}</span>
                    {code === journalLanguage && <span className="text-xs text-ink-secondary">{t("studio.speak.langJournal")}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}

"use client";

import { AlignLeft, Mic } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useI18n } from "@/components/LocaleProvider";
import StepIndicator, { importStep } from "@/components/extract/StepIndicator";
import { SPEECH_LANGUAGE_LABEL, SPEECH_LANGUAGES, type SpeechLanguage } from "@/lib/helper/speech";

export type TripOption = { id: string; title: string; year: string };

/** The wizard's own fixed shape (S2a–S4 of the design) — five screens before
 *  the day board takes over, not a count read off any run. */

/**
 * Step 02 of the design — "where it goes, and how you'll tell it".
 *
 * B1797. `RunManifest.tripId` and `.mode` have carried this since B1751's
 * Task 1.2; nothing has ever asked. Two questions, each cheap, each answered
 * once here and never buried in a setting afterwards — the draft's own
 * framing (`.superpowers/sdd/b1797/design-v2.html`, Step 02).
 *
 * **The talk/type screen is skipped, not disabled, without transcription.**
 * The draft says so explicitly: "If the instance can't transcribe, this
 * screen never appears and the flow is the typing one." Absent, matching
 * `helperEnabled`'s own rule elsewhere in this codebase, rather than a
 * disabled control nobody can explain.
 *
 * **Which language, asked here too — B1803 Task 4.1.** `SPEECH_LANGUAGES`
 * (`lib/helper/speech.ts`) has carried Swiss German and Hungarian since
 * B686, and `POST .../transcribe` has always accepted an explicit
 * `language` override; nothing in the UI ever asked, so every recording
 * used the journal's own guess and a person whose voice was not their
 * journal's language had no way to say so before speaking. This is where
 * that question belongs: it appears only once "Talk it through" is the
 * selected answer, since that is the moment speaking has actually been
 * chosen — the same "not until it is needed" rule `RecordButton`'s own
 * per-recording select already follows. `onSubmit`'s `language` is absent
 * whenever `mode` ends up `"type"`, exactly as `consentedSpeech`'s absence
 * skips this whole screen: a run that will never record has nothing to
 * carry here, and the manifest field stays unset rather than storing a
 * choice nobody was asked to make.
 */
export default function TripModeStep({
  trips,
  consentedSpeech,
  defaultLanguage,
  onSubmit,
}: {
  trips: TripOption[];
  consentedSpeech: boolean;
  /** The journal's own best guess — B1803 Task 4.1. Preselected, and the
   *  person changes it right here if their voice is not their journal's
   *  language. */
  defaultLanguage: SpeechLanguage;
  onSubmit: (tripId: string | null, mode: "voice" | "type", language?: SpeechLanguage) => void;
}) {
  const { t } = useI18n();
  const [screen, setScreen] = useState<"trip" | "mode">("trip");
  const [existing, setExisting] = useState(false);
  const [tripId, setTripId] = useState<string | null>(null);
  const [mode, setMode] = useState<"voice" | "type">("voice");
  const [language, setLanguage] = useState<SpeechLanguage>(defaultLanguage);
  // The mode screen is only ever shown with speech consented (`next`).
  const tripStep = importStep("trip", consentedSpeech);
  const modeStep = importStep("mode", true);

  function next() {
    if (consentedSpeech) {
      setScreen("mode");
    } else {
      onSubmit(existing ? tripId : null, "type");
    }
  }

  if (screen === "mode") {
    return (
      <div className="mt-4">
        <StepIndicator
          total={modeStep.total}
          current={modeStep.current}
          label={t("studio.photos.step.mode", { current: String(modeStep.current), total: String(modeStep.total) })}
        />
        <button
          type="button"
          onClick={() => setScreen("trip")}
          className="text-sm font-semibold text-ink-secondary underline"
        >
          {t("studio.photos.tripMode.back")}
        </button>
        <h2 className="mt-2 font-display text-xl font-semibold leading-tight text-ink-strong">
          {t("studio.photos.tripMode.modeTitle")}
        </h2>

        <div className="mt-4 flex flex-col gap-3">
          <OptionCard
            icon={<Mic className="h-4 w-4" aria-hidden="true" />}
            title={t("studio.photos.tripMode.talk")}
            description={t("studio.photos.tripMode.talkDescription")}
            selected={mode === "voice"}
            onSelect={() => setMode("voice")}
          />
          <OptionCard
            icon={<AlignLeft className="h-4 w-4" aria-hidden="true" />}
            title={t("studio.photos.tripMode.type")}
            description={t("studio.photos.tripMode.typeDescription")}
            selected={mode === "type"}
            onSelect={() => setMode("type")}
          />
        </div>

        {mode === "voice" && (
          <div className="mt-4">
            <p className="text-sm font-semibold text-ink-strong">{t("studio.photos.tripMode.languageTitle")}</p>
            <div className="mt-2 flex flex-col gap-3">
              {SPEECH_LANGUAGES.map((code) => (
                <OptionCard
                  key={code}
                  title={SPEECH_LANGUAGE_LABEL[code]}
                  selected={language === code}
                  onSelect={() => setLanguage(code)}
                />
              ))}
            </div>
          </div>
        )}

        <div className="mt-4 rounded-xl bg-surface-subtle p-4">
          <p className="text-sm font-semibold text-ink-strong">{t("studio.photos.tripMode.switchTitle")}</p>
          <p className="mt-1 text-sm text-ink-body">{t("studio.photos.tripMode.switchBody")}</p>
        </div>

        <button
          type="button"
          onClick={() => onSubmit(existing ? tripId : null, mode, mode === "voice" ? language : undefined)}
          disabled={existing && !tripId}
          className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-full bg-yellow-400 px-5 text-base font-semibold text-yellow-950 transition-colors hover:bg-yellow-300 disabled:opacity-50"
        >
          {t("studio.photos.tripMode.nextPhotos")}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-4">
      <StepIndicator
        total={tripStep.total}
        current={tripStep.current}
        label={t("studio.photos.step.trip", { current: String(tripStep.current), total: String(tripStep.total) })}
      />
      <h2 className="font-display text-xl font-semibold leading-tight text-ink-strong">
        {t("studio.photos.tripMode.tripTitle")}
      </h2>

      <div className="mt-4 flex flex-col gap-3">
        <OptionCard
          title={t("studio.photos.tripMode.newTrip")}
          description={t("studio.photos.tripMode.newTripDescription")}
          selected={!existing}
          onSelect={() => setExisting(false)}
        />
        {trips.length > 0 && (
          <OptionCard
            title={t("studio.photos.tripMode.existingTrip")}
            description={t("studio.photos.tripMode.existingTripDescription")}
            selected={existing}
            onSelect={() => setExisting(true)}
          />
        )}
      </div>

      {existing && trips.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2">
          {trips.map((trip) => (
            <li key={trip.id}>
              <button
                type="button"
                onClick={() => setTripId(trip.id)}
                className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left text-sm transition-colors ${
                  tripId === trip.id
                    ? "border-yellow-600 bg-surface-raised ring-2 ring-yellow-300"
                    : "border-line-strong bg-surface-raised hover:bg-surface-subtle"
                }`}
              >
                <span className="font-semibold text-ink-strong">{trip.title}</span>
                <span className="text-xs text-ink-secondary">{trip.year}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={next}
        disabled={existing && !tripId}
        className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-full bg-yellow-400 px-5 text-base font-semibold text-yellow-950 transition-colors hover:bg-yellow-300 disabled:opacity-50"
      >
        {consentedSpeech ? t("studio.photos.tripMode.nextMode") : t("studio.photos.tripMode.nextPhotos")}
      </button>
    </div>
  );
}

function OptionCard({
  icon,
  title,
  description,
  selected,
  onSelect,
}: {
  icon?: ReactNode;
  title: string;
  /** Absent for the language cards (B1803 Task 4.1) — a language's own name
   *  needs no second line under it. */
  description?: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex flex-col gap-1 rounded-xl border px-4 py-3 text-left transition-colors ${
        selected
          ? "border-yellow-600 bg-surface-raised ring-2 ring-yellow-300"
          : "border-line-strong bg-surface-raised hover:bg-surface-subtle"
      }`}
    >
      <span className="flex items-center gap-2 text-sm font-semibold text-ink-strong">
        {icon}
        {title}
      </span>
      {description && <span className="text-xs text-ink-secondary">{description}</span>}
    </button>
  );
}

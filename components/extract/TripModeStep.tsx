"use client";

import { useState } from "react";
import { useI18n } from "@/components/LocaleProvider";

export type TripOption = { id: string; title: string; year: string };

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
 */
export default function TripModeStep({
  trips,
  consentedSpeech,
  onSubmit,
}: {
  trips: TripOption[];
  consentedSpeech: boolean;
  onSubmit: (tripId: string | null, mode: "voice" | "type") => void;
}) {
  const { t } = useI18n();
  const [screen, setScreen] = useState<"trip" | "mode">("trip");
  const [existing, setExisting] = useState(false);
  const [tripId, setTripId] = useState<string | null>(null);
  const [mode, setMode] = useState<"voice" | "type">("voice");

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
        <button
          type="button"
          onClick={() => setScreen("trip")}
          className="text-sm font-semibold text-ink-secondary underline"
        >
          {t("extract.tripMode.back")}
        </button>
        <h2 className="mt-2 font-display text-xl font-semibold leading-tight text-ink-strong">
          {t("extract.tripMode.modeTitle")}
        </h2>

        <div className="mt-4 flex flex-col gap-3">
          <OptionCard
            title={t("extract.tripMode.talk")}
            description={t("extract.tripMode.talkDescription")}
            selected={mode === "voice"}
            onSelect={() => setMode("voice")}
          />
          <OptionCard
            title={t("extract.tripMode.type")}
            description={t("extract.tripMode.typeDescription")}
            selected={mode === "type"}
            onSelect={() => setMode("type")}
          />
        </div>

        <div className="mt-4 rounded-xl bg-surface-subtle p-4">
          <p className="text-sm font-semibold text-ink-strong">{t("extract.tripMode.switchTitle")}</p>
          <p className="mt-1 text-sm text-ink-body">{t("extract.tripMode.switchBody")}</p>
        </div>

        <button
          type="button"
          onClick={() => onSubmit(existing ? tripId : null, mode)}
          disabled={existing && !tripId}
          className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-full bg-yellow-400 px-5 text-base font-semibold text-yellow-950 transition-colors hover:bg-yellow-300 disabled:opacity-50"
        >
          {t("extract.tripMode.nextPhotos")}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-4">
      <h2 className="font-display text-xl font-semibold leading-tight text-ink-strong">
        {t("extract.tripMode.tripTitle")}
      </h2>

      <div className="mt-4 flex flex-col gap-3">
        <OptionCard
          title={t("extract.tripMode.newTrip")}
          description={t("extract.tripMode.newTripDescription")}
          selected={!existing}
          onSelect={() => setExisting(false)}
        />
        {trips.length > 0 && (
          <OptionCard
            title={t("extract.tripMode.existingTrip")}
            description={t("extract.tripMode.existingTripDescription")}
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
        {consentedSpeech ? t("extract.tripMode.nextMode") : t("extract.tripMode.nextPhotos")}
      </button>
    </div>
  );
}

function OptionCard({
  title,
  description,
  selected,
  onSelect,
}: {
  title: string;
  description: string;
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
      <span className="text-sm font-semibold text-ink-strong">{title}</span>
      <span className="text-xs text-ink-secondary">{description}</span>
    </button>
  );
}

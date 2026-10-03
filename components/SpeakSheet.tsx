"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Languages, Mic } from "lucide-react";
import ConfirmPanel from "@/components/ConfirmPanel";
import { useI18n } from "@/components/LocaleProvider";
import { clock, SPEAK_QUESTIONS } from "@/lib/studio/speak";

/**
 * The Speak sheet — B2761. Only the drawing: `RecordButton` (`sheet` mode)
 * owns the recording, the meter, consent and the send, and hands this what
 * to show. The one guide question is shown and never leaves this file — it
 * is not part of anything `RecordButton` reports back.
 */
export type SpeakPhase = "listening" | "paused" | "working" | "failed" | "notice";

export default function SpeakSheet({
  phase,
  seconds,
  level,
  languageLabel,
  error,
  notice,
  nearLimit,
  confirmDiscard,
  leaving,
  onToggle,
  onDiscard,
  onFinish,
  onRetry,
  onConfirmDiscard,
  onCancelDiscard,
}: {
  phase: SpeakPhase;
  seconds: number;
  level: number;
  languageLabel: string;
  error: string;
  /** Replaces the mic while consent or the used-up notice is what this is about. */
  notice?: React.ReactNode;
  nearLimit: boolean;
  confirmDiscard: boolean;
  leaving: boolean;
  onToggle: () => void;
  /** The "Discard" the person tapped — the host asks first when it is long. */
  onDiscard: () => void;
  onFinish: () => void;
  /** Present only while there is a kept recording to send again. */
  onRetry?: () => void;
  /** Throw it away, now. */
  onConfirmDiscard: () => void;
  onCancelDiscard: () => void;
}) {
  const { t } = useI18n();
  const [q, setQ] = useState(0);
  const mic = useRef<HTMLButtonElement>(null);
  const hasMic = !notice;
  useEffect(() => {
    mic.current?.focus();
  }, [hasMic]);
  const paused = phase === "paused";
  const live = phase === "listening";
  const status =
    phase === "working" ? t("agent.speechWorking") : paused ? t("studio.speak.paused") : live ? t("studio.speak.listening") : "";

  // In the body, not in the page: a page section with its own stacking would paint over a fixed child.
  return createPortal(
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={t("studio.speak.label")}>
      <div className={`fs-speak-scrim absolute inset-0 bg-overlay-strong/70 ${leaving ? "fs-speak-out" : ""}`} aria-hidden />
      <div
        className={`fs-speak-sheet absolute inset-x-0 bottom-0 top-11 mx-auto flex max-w-md flex-col items-center rounded-t-[28px] border-t border-line-quiet bg-surface-base px-4 pt-2 pb-[calc(0.75rem+env(safe-area-inset-bottom))] ${leaving ? "fs-speak-out" : ""}`}
      >
        <span aria-hidden className="h-[5px] w-10 rounded-full bg-line-strong" />
        <div className="mt-1 flex w-full items-center justify-between">
          <button type="button" onClick={onDiscard} className="min-h-11 px-2 text-base font-semibold text-ink-secondary">
            {t("studio.speak.discard")}
          </button>
          <span className="flex items-center gap-1.5 text-sm text-ink-secondary">
            <Languages className="h-4 w-4" aria-hidden />
            {languageLabel}
          </span>
        </div>

        {confirmDiscard && (
          <div className="w-full">
            <ConfirmPanel
              label={t("studio.speak.discard")}
              question={t("studio.speak.discardAsk", { time: clock(seconds) })}
              confirmLabel={t("studio.speak.discardConfirm")}
              tone="destructive"
              onConfirm={onConfirmDiscard}
              onCancel={onCancelDiscard}
            />
          </div>
        )}

        {notice ? (
          <div className="mt-10 w-full">{notice}</div>
        ) : (
          <>
            <div className="fs-speak-mic relative mt-12 h-40 w-40">
              {live && (
                <>
                  <span aria-hidden className="fs-mic-ring absolute inset-0 rounded-full border-2 border-coral-400" />
                  <span aria-hidden className="fs-mic-ring absolute inset-0 rounded-full border-2 border-coral-400" style={{ animationDelay: "0.9s" }} />
                </>
              )}
              <button
                ref={mic}
                type="button"
                disabled={phase === "working" || phase === "failed"}
                aria-label={paused ? t("studio.speak.resumeLabel") : t("studio.speak.pauseLabel")}
                onClick={onToggle}
                style={live ? { transform: `scale(${1 + level * 0.06})`, transition: "transform 80ms linear" } : undefined}
                className={`absolute inset-0 flex items-center justify-center rounded-full focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none disabled:opacity-60 ${
                  paused
                    ? "bg-surface-raised text-ink-strong ring-[3px] ring-coral-400"
                    : "bg-mic-fill text-on-deep shadow-[0_12px_48px_rgba(194,51,74,0.4)]"
                }`}
              >
                <Mic className="h-14 w-14" strokeWidth={2} aria-hidden />
              </button>
            </div>
            <div aria-hidden className="mt-7 flex h-[34px] items-end gap-1">
              {Array.from({ length: 12 }, (_, i) => {
                // ponytail: a fixed zig-zag moved by the one level reading,
                // not a spectrum; per-bar analyser bins if it must look less uniform.
                const rest = 8 + ((i * 7) % 5) * 4;
                return (
                  <span
                    key={i}
                    className={`w-1 rounded-full bg-coral-400 ${live ? "fs-waveform" : ""}`}
                    style={{ height: `${live ? rest + level * 14 : rest}px`, animationDelay: `${i * 90}ms` }}
                  />
                );
              })}
            </div>
            <p className={`mt-3 font-mono text-[34px] font-medium tabular-nums ${paused ? "text-ink-faint" : "text-ink-strong"}`}>
              {clock(seconds)}
            </p>
            <p role="status" className="mt-0.5 text-base text-ink-body">
              {status}
            </p>
            {nearLimit && live && <p className="mt-1 text-sm text-ink-secondary">{t("studio.speak.nearLimit")}</p>}
            {error && (
              <div role="alert" className="mt-2 w-full text-center">
                <p className="text-sm text-coral-600">{error}</p>
                <div className="mt-2 flex justify-center gap-2">
                  {onRetry && (
                    <button type="button" onClick={onRetry} className="min-h-11 rounded-full bg-yellow-400 px-5 text-base font-semibold text-yellow-950">
                      {t("studio.speak.tryAgain")}
                    </button>
                  )}
                  <button type="button" onClick={onConfirmDiscard} className="min-h-11 rounded-full border border-line-strong px-5 text-base font-semibold text-ink-body">
                    {t("studio.speak.discardRecording")}
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        <div className="flex-1" />
        {hasMic && (
          <div className="fs-speak-q w-full text-center">
            <p className="text-xs font-bold uppercase tracking-wide text-ink-secondary">{t("studio.speak.notSure")}</p>
            <p className="mt-2 font-display text-2xl leading-snug font-semibold text-ink-strong">
              {t(`studio.speak.q.${SPEAK_QUESTIONS[q]}`)}
            </p>
            <button
              type="button"
              onClick={() => setQ((n) => (n + 1) % SPEAK_QUESTIONS.length)}
              className="mt-0.5 min-h-11 px-2 text-base font-semibold text-ink-strong underline underline-offset-[3px]"
            >
              {t("studio.speak.another")}
            </button>
            <p className="mb-3.5 text-sm text-ink-secondary">{t("studio.speak.onlyPrompt")}</p>
          </div>
        )}
        {hasMic && !error && (
          <button
            type="button"
            disabled={phase !== "listening" && !paused}
            onClick={onFinish}
            className="h-[50px] w-full rounded-full bg-yellow-400 text-[17px] font-semibold text-yellow-950 disabled:opacity-50"
          >
            {t("studio.speak.finish")}
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}

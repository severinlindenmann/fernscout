"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
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

/** Where the Speak pill that opened the sheet sits, in viewport px. */
export type SpeakAnchor = { top: number; bottom: number; left: number };

const WIDE = "(min-width: 768px)";
const POPOVER_W = 380;

// No matchMedia (an old WebView, jsdom) reads as a phone: the sheet, never broken.
const wideQuery = () => (typeof window.matchMedia === "function" ? window.matchMedia(WIDE) : null);

function subscribeWide(change: () => void) {
  const q = wideQuery();
  q?.addEventListener("change", change);
  return () => q?.removeEventListener("change", change);
}

/** B2784 — on a wide screen the sheet is a popover beside its pill: below it
 *  when there is room, above otherwise, kept 16px inside the viewport. */
function popoverStyle(anchor: SpeakAnchor): React.CSSProperties {
  const left = Math.min(Math.max(16, anchor.left), window.innerWidth - POPOVER_W - 16);
  const below = window.innerHeight - anchor.bottom > anchor.top;
  return below
    ? { left, top: anchor.bottom + 8, width: POPOVER_W, maxHeight: window.innerHeight - anchor.bottom - 24 }
    : { left, bottom: window.innerHeight - anchor.top + 8, width: POPOVER_W, maxHeight: anchor.top - 24 };
}

export default function SpeakSheet({
  phase,
  anchor,
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
  /** The pill that opened it; without one a wide screen gets the sheet too. */
  anchor?: SpeakAnchor;
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
  const wide = useSyncExternalStore(subscribeWide, () => wideQuery()?.matches ?? false, () => false);
  const pop = wide && !!anchor;
  const paused = phase === "paused";
  const live = phase === "listening";
  const status =
    phase === "working" ? t("agent.speechWorking") : paused ? t("studio.speak.paused") : live ? t("studio.speak.listening") : "";

  // In the body, not in the page: a page section with its own stacking would paint over a fixed child.
  return createPortal(
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={t("studio.speak.label")}>
      <div className={`fs-speak-scrim absolute inset-0 ${pop ? "bg-overlay-strong/30" : "bg-overlay-strong/70"} ${leaving ? "fs-speak-out" : ""}`} aria-hidden />
      <div
        style={pop && anchor ? popoverStyle(anchor) : undefined}
        className={`flex flex-col items-center overflow-y-auto bg-surface-base ${
          pop
            ? "fs-speak-pop absolute rounded-3xl border border-line-quiet px-4 pt-3 pb-4 shadow-2xl"
            : "fs-speak-sheet absolute inset-x-0 bottom-0 mx-auto max-h-[calc(100dvh-2.75rem)] max-w-md rounded-t-[28px] border-t border-line-quiet px-4 pt-2 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
        } ${leaving ? "fs-speak-out" : ""}`}
      >
        {!pop && <span aria-hidden className="h-[5px] w-10 shrink-0 rounded-full bg-line-strong" />}
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
          <div className={`${pop ? "mt-4" : "mt-10"} w-full`}>{notice}</div>
        ) : (
          <>
            <div className={`fs-speak-mic relative shrink-0 ${pop ? "mt-4 h-28 w-28" : "mt-8 h-40 w-40"}`}>
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
                <Mic className={pop ? "h-10 w-10" : "h-14 w-14"} strokeWidth={2} aria-hidden />
              </button>
            </div>
            <div aria-hidden className={`${pop ? "mt-5" : "mt-7"} flex h-[34px] items-end gap-1`}>
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

        {hasMic && (
          <div className={`fs-speak-q w-full text-center ${pop ? "mt-5" : "mt-8"}`}>
            <p className="text-xs font-bold uppercase tracking-wide text-ink-secondary">{t("studio.speak.notSure")}</p>
            <p className={`mt-2 font-display leading-snug font-semibold text-ink-strong ${pop ? "text-xl" : "text-2xl"}`}>
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
            className="h-[50px] w-full shrink-0 rounded-full bg-yellow-400 text-[17px] font-semibold text-yellow-950 disabled:opacity-50"
          >
            {t("studio.speak.finish")}
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}

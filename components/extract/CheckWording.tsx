"use client";

import { useState } from "react";
import { Pause } from "lucide-react";
import { useI18n } from "@/components/LocaleProvider";

/**
 * Splits a transcript around its own flagged word — B1803 Task 3.4, fix
 * round 2.
 *
 * A plain substring search rather than rejoining Deepgram's own `words`
 * array: `words[i].punctuated_word` already carries whatever punctuation
 * Deepgram's `smart_format` attached to it, so finding that exact string
 * inside the full transcript and slicing around it reproduces the original
 * spacing and punctuation exactly. Rebuilding the sentence by joining
 * tokens with a bare space would not — a comma or a period would end up
 * with a space in front of it that was never in the transcript Deepgram
 * actually returned.
 *
 * **Which occurrence, not just which word.** A transcript can say the same
 * word twice — round 1 always highlighted the first, regardless of which
 * one the provider actually measured low confidence on. `flagged.occurrence`
 * (from `leastConfidentWord`, carried untouched by everything between it
 * and here) says which one: 0 for the first appearance of that exact text
 * in the transcript, 1 for the second, and so on. This walks forward that
 * many matches with `indexOf`'s own search-from-index rather than any kind
 * of token rejoin, so the exact original spacing and punctuation around
 * *that* occurrence survives.
 *
 * `null` whenever there is no word to flag, or the flagged occurrence
 * cannot actually be found in the text (should not happen, but a screen
 * that cannot locate its own highlight shows a plain transcript rather than
 * throwing) — exported so `test/extract-check-wording.test.ts` can assert
 * both without mounting the component.
 */
export function splitOnWord(
  text: string,
  flagged: { word: string; occurrence: number } | undefined,
): { pre: string; word: string; post: string } | null {
  if (!flagged || flagged.word === "") return null;
  let idx = -1;
  let searchFrom = 0;
  for (let seen = 0; seen <= flagged.occurrence; seen++) {
    idx = text.indexOf(flagged.word, searchFrom);
    if (idx === -1) return null;
    searchFrom = idx + flagged.word.length;
  }
  return {
    pre: text.slice(0, idx),
    word: text.slice(idx, idx + flagged.word.length),
    post: text.slice(idx + flagged.word.length),
  };
}

function clockFor(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

/**
 * S7b — "Check the wording", the screen that did not exist. B1803 Task 3.4.
 *
 * The whole point of this screen is the one thing it must never do: invent
 * an uncertain word. `uncertain` is either what the transcribe route
 * actually measured low confidence on — the word plus which occurrence of
 * it this is, for a word the transcript says more than once — or absent,
 * and absent means a plain transcript with no highlight and no "one word
 * looked uncertain" panel, never a guess dressed up as one (AGENTS.md;
 * `lib/helper/transcribe.ts`'s `leastConfidentWord`).
 *
 * The highlighted word is editable in place — a native `<input>` swapped in
 * for the tapped span, never `window.prompt` (AGENTS.md forbids it) — and
 * "Looks right — keep going" hands back the transcript with that correction
 * folded in, not the original.
 */
export default function CheckWording({
  text,
  uncertain,
  recordedSeconds,
  onKeep,
  onRedo,
}: {
  text: string;
  uncertain?: { word: string; occurrence: number };
  recordedSeconds: number;
  onKeep: (finalText: string) => void;
  onRedo: () => void;
}) {
  const { t } = useI18n();
  const split = splitOnWord(text, uncertain);
  const [correction, setCorrection] = useState(split?.word ?? "");
  const [editing, setEditing] = useState(false);

  const finalText = split ? `${split.pre}${correction}${split.post}` : text;

  return (
    <div>
      <div className="mb-3 flex min-w-0 items-center justify-between gap-2">
        <button
          type="button"
          onClick={onRedo}
          aria-label={t("extract.checkWording.back")}
          className="text-lg text-ink-strong"
        >
          ←
        </button>
        <span className="min-w-0 flex-1 truncate text-center text-sm font-semibold text-ink-strong">
          {t("extract.checkWording.title")}
        </span>
        <button type="button" onClick={onRedo} className="shrink-0 text-sm font-semibold text-coral-600">
          {t("extract.checkWording.redo")}
        </button>
      </div>

      <div
        aria-hidden
        className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-surface-subtle text-ink-secondary"
      >
        <Pause className="h-6 w-6" />
      </div>
      <p className="mt-1 text-center text-sm text-ink-secondary">
        {t("extract.checkWording.paused", { clock: clockFor(recordedSeconds) })}
      </p>

      <div className="mt-3 rounded-xl border border-line-strong bg-surface-raised p-3">
        <span className="text-xs font-semibold tracking-wide text-ink-faint uppercase">
          {t("extract.checkWording.heardLabel")}
        </span>
        <p className="mt-1 text-sm leading-relaxed text-ink-body">
          {split ? (
            <>
              {split.pre}
              {editing ? (
                <input
                  autoFocus
                  value={correction}
                  onChange={(e) => setCorrection(e.target.value)}
                  onBlur={() => setEditing(false)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") setEditing(false);
                  }}
                  aria-label={t("extract.checkWording.correctLabel")}
                  className="inline-block max-w-40 rounded border border-coral-400 bg-surface-raised px-1 text-sm text-ink-body"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="rounded bg-coral-100 px-1 font-medium text-coral-600"
                >
                  {correction}
                </button>
              )}
              {split.post}
            </>
          ) : (
            text
          )}
        </p>
      </div>

      {split && (
        <div className="mt-3 rounded-lg border border-line-faint bg-surface-subtle p-3">
          <p className="text-sm font-semibold text-ink-strong">{t("extract.checkWording.tipTitle")}</p>
          <p className="mt-1 text-sm text-ink-secondary">{t("extract.checkWording.tipBody")}</p>
        </div>
      )}

      <button
        type="button"
        onClick={() => onKeep(finalText)}
        className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-full bg-action-strong px-5 text-base font-semibold text-on-action"
      >
        {t("extract.checkWording.keep")}
      </button>
      <button
        type="button"
        onClick={onRedo}
        className="mt-2 inline-flex min-h-11 w-full items-center justify-center rounded-full border border-line-strong px-5 text-base font-semibold text-ink-strong"
      >
        {t("extract.checkWording.sayAgain")}
      </button>
    </div>
  );
}

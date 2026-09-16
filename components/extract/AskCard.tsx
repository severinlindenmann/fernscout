"use client";

import { useState } from "react";
import BusyButton from "@/components/BusyButton";
import CheckWording from "@/components/extract/CheckWording";
import { weekdayLabel } from "@/components/extract/DayBoard";
import { useI18n } from "@/components/LocaleProvider";
import PhotoStrip, { type PhotoStripItem } from "@/components/extract/PhotoStrip";
import PhotoViewer, { type PhotoViewerItem } from "@/components/extract/PhotoViewer";
import StepIndicator from "@/components/extract/StepIndicator";
import RecordButton from "@/components/RecordButton";
import type { Question } from "@/lib/extract/questions";

/**
 * One question about one day, answered by voice or by typing — B1751, Task
 * 2.3. The telling flow's three screens, S7a/S7b/S7c — B1803 Task 3b.
 *
 * **The transcript is editable, always.** Speech recognition gets names and
 * places wrong — that is the normal case, not the exception. Typing keeps
 * the same plain `<textarea>` it always has; a voice answer now stops at
 * "Check the wording" (S7b, `CheckWording`) before it ever reaches that
 * textarea, so a misheard name is corrected in place rather than published.
 *
 * **Three states, only for a non-follow-up question with speech
 * available:**
 *
 * - `"hero"` — S7a's own voice-first screen: the waveform, the large round
 *   microphone, "Listening · tap to pause". The default, since a person who
 *   came here to speak should not have to find a smaller control first.
 * - `"review"` — S7b, once a recording comes back. `text`/`uncertainWord`/
 *   `heldSeconds` are exactly what `RecordButton`'s `onText` handed over;
 *   nothing here invents or re-measures any of it.
 * - `"type"` — the original textarea-and-submit box, reached by "Type this
 *   one instead" or used from the start whenever speech is not available at
 *   all (`speechProvider === ""` — the capability off, not merely
 *   unconsented; see `app/[user]/extract/photos/page.tsx`).
 *
 * A follow-up question (`question.kind === "follow-up"`, S7c) never uses any
 * of the three states above — it keeps the plain typing box (with its own
 * compact mic, unchanged) and adds the three suggestion chips and the
 * Skip/Finish footer instead.
 *
 * **The photographs the question is about, above it — B1803 Task 1.3.** The
 * design draws a strip above the opening/gap questions (S7a) and a single
 * wide photograph above the third, "one more if you like" follow-up (S7c) —
 * `question.kind === "follow-up"` is what tells the two apart, since that is
 * the only question this flow ever asks third (`MAX_QUESTIONS_PER_DAY` is 3
 * in `lib/extract/questions.ts`, opening/gap first). The hero uses the first
 * photograph offered — this screen has no signal for which one the question
 * is "about" beyond that, so it never guesses further than the data says.
 */
export default function AskCard({
  question,
  dayIndex,
  dayTotal,
  questionIndex,
  questionTotal,
  date,
  username,
  consentedSpeech,
  speechProvider,
  photos = [],
  onAnswer,
  onSkip,
  onDone,
}: {
  question: Question;
  /** This day's 1-indexed position among the run's own days, and how many
   *  there are — B1803 Task 2.1's `day 4 of 9`. Optional so callers that
   *  have not yet wired the board's day list keep compiling. */
  dayIndex?: number;
  dayTotal?: number;
  /** This question's own position among the day's currently open questions —
   *  drives the progress segments, which the design draws separately from
   *  the `day N of M` label above. */
  questionIndex?: number;
  questionTotal?: number;
  /** The group's own date (`undefined` for the undated group), for the
   *  follow-up screen's "Finish {weekday}" — B1803 Task 3.5. */
  date?: string;
  username: string;
  consentedSpeech: boolean;
  /** `""` — never a real provider name — means the capability itself is off
   *  (`isEnabled("transcription", user)`), not merely unconsented. Only
   *  then does this whole card fall back to typing-only, with no attempt at
   *  a consent panel or a microphone at all. */
  speechProvider: string;
  /** The day's own photographs, for the strip (or hero) above the question.
   *  Optional so every existing caller keeps compiling before it is wired. */
  photos?: PhotoStripItem[];
  /** Posts the answer to `.../extract/day`; resolved once saved. */
  onAnswer: (text: string) => Promise<void>;
  /** The follow-up screen's own "Skip" (S7c) — absent for every other
   *  question kind, since only a follow-up is ever optional. */
  onSkip?: () => Promise<void>;
  /** Fired once Skip or Finish has done its own work — B1803 Task 3.5. The
   *  board collapses this day's panel; this component knows nothing about
   *  what "done" looks like beyond having called it. */
  onDone?: () => void;
}) {
  const { t, locale } = useI18n();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [chip, setChip] = useState<string | null>(null);

  const isFollowUp = question.kind === "follow-up";
  // The capability itself, not consent — B1803 Task 3.3/3.4's own binding
  // constraint. `""` is what a caller sends when transcription is off
  // outright; a real provider name (including "none" in tests that are not
  // exercising this distinction) means speech is at least on the table.
  const speechCapable = speechProvider !== "";
  const [mode, setMode] = useState<"hero" | "review" | "type">(
    !isFollowUp && speechCapable ? "hero" : "type",
  );
  const [pending, setPending] = useState<{ text: string; uncertainWord?: string; seconds: number } | null>(
    null,
  );

  async function submit(value: string) {
    const trimmed = value.trim();
    if (trimmed === "") return;
    setBusy(true);
    try {
      await onAnswer(trimmed);
      setText("");
      setPending(null);
      setMode(!isFollowUp && speechCapable ? "hero" : "type");
    } finally {
      setBusy(false);
    }
  }

  async function finishFollowUp() {
    const trimmed = text.trim();
    setBusy(true);
    try {
      if (trimmed !== "") await onAnswer(trimmed);
      onDone?.();
    } finally {
      setBusy(false);
    }
  }

  async function skipFollowUp() {
    if (!onSkip) return;
    setBusy(true);
    try {
      await onSkip();
      onDone?.();
    } finally {
      setBusy(false);
    }
  }

  const viewerItems: PhotoViewerItem[] = photos.map((p) => ({ id: p.id, kind: p.kind, src: p.src }));

  // S7a's "FIRST" and S7c's "ONE MORE, IF YOU LIKE" — the only two the
  // design actually names (design-v2.html:868/916). A "gap" question (the
  // day's second, filling in a missing location) gets no label at all
  // rather than one invented for a case the design never drew.
  const kindLabel =
    questionIndex === 1 ? t("extract.ask.first") : isFollowUp ? t("extract.ask.oneMore") : null;

  const followUpChips = [
    { key: "who", text: t("extract.ask.chip.who") },
    { key: "after", text: t("extract.ask.chip.after") },
    { key: "why", text: t("extract.ask.chip.why") },
  ];

  const finishLabel = date ? t("extract.ask.finishDay", { weekday: weekdayLabel(date, locale) }) : t("extract.board.leave");

  return (
    <div>
      {dayIndex !== undefined && dayTotal !== undefined && questionIndex !== undefined && questionTotal !== undefined && (
        <StepIndicator
          total={questionTotal}
          current={questionIndex}
          label={t("extract.step.dayOfTotal", { current: String(dayIndex), total: String(dayTotal) })}
        />
      )}
      {photos.length > 0 &&
        (isFollowUp ? (
          <div className="mb-2">
            <PhotoStrip size="hero" columns={1} photos={photos.slice(0, 1)} onSelect={(id) => setOpenIndex(photos.findIndex((p) => p.id === id))} />
          </div>
        ) : (
          <div className="mb-2">
            <PhotoStrip size="strip" columns={5} photos={photos.slice(0, 5)} onSelect={(id) => setOpenIndex(photos.findIndex((p) => p.id === id))} />
          </div>
        ))}

      <PhotoViewer
        items={viewerItems}
        index={openIndex}
        onClose={() => setOpenIndex(null)}
        onPrev={() => setOpenIndex((i) => (i === null ? null : (i - 1 + viewerItems.length) % viewerItems.length))}
        onNext={() => setOpenIndex((i) => (i === null ? null : (i + 1) % viewerItems.length))}
      />

      {mode === "review" && pending ? (
        <div className="rounded-xl border border-line-strong bg-surface-raised p-3">
          <CheckWording
            text={pending.text}
            uncertainWord={pending.uncertainWord}
            recordedSeconds={pending.seconds}
            onKeep={(finalText) => void submit(finalText)}
            onRedo={() => {
              setPending(null);
              setMode("hero");
            }}
          />
        </div>
      ) : (
        <div
          className={
            mode === "hero" && !isFollowUp
              ? "fs-ask-dark rounded-xl p-3"
              : "rounded-xl border border-line-strong bg-surface-raised p-3"
          }
        >
          {kindLabel && (
            <span className="mb-1.5 inline-block rounded-full bg-yellow-400 px-2 py-0.5 text-xs font-semibold tracking-wide text-yellow-950 uppercase">
              {kindLabel}
            </span>
          )}
          <p className={mode === "hero" && !isFollowUp ? "text-sm" : "text-sm text-ink-strong"}>{question.text}</p>

          {isFollowUp ? (
            <>
              <div className="relative mt-2">
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={3}
                  placeholder={chip ?? t("extract.ask.placeholder")}
                  className="min-h-20 w-full rounded-lg border border-line-strong bg-surface-subtle px-3 py-2 pr-12 text-sm text-ink-body"
                />
                {speechCapable && (
                  <RecordButton
                    username={username}
                    consented={consentedSpeech}
                    provider={speechProvider}
                    compact
                    onText={(said) => setText((prev) => (prev ? `${prev} ${said}` : said))}
                  />
                )}
              </div>

              <div className="mt-2 flex flex-wrap gap-1.5">
                {followUpChips.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    aria-pressed={chip === c.text}
                    onClick={() => setChip((prev) => (prev === c.text ? null : c.text))}
                    className={`min-h-9 rounded-full border px-3 text-xs font-semibold ${
                      chip === c.text
                        ? "border-coral-400 bg-coral-100 text-coral-600"
                        : "border-line-strong text-ink-strong"
                    }`}
                  >
                    {c.text}
                  </button>
                ))}
              </div>

              <div className="mt-2 rounded-lg border border-line-faint bg-surface-subtle p-3">
                <p className="text-sm font-semibold text-ink-strong">{t("extract.ask.pickOneTitle")}</p>
                <p className="mt-1 text-sm text-ink-secondary">{t("extract.ask.pickOneBody")}</p>
              </div>

              <div className="mt-2 flex gap-2">
                <BusyButton
                  busy={busy}
                  type="button"
                  onClick={() => void skipFollowUp()}
                  className="min-h-11 flex-1 rounded-full border border-line-strong px-5 text-sm font-semibold text-ink-strong"
                >
                  {t("extract.ask.skip")}
                </BusyButton>
                <BusyButton
                  busy={busy}
                  type="button"
                  onClick={() => void finishFollowUp()}
                  className="min-h-11 flex-[2] rounded-full bg-action-strong px-5 text-sm font-semibold text-on-action"
                >
                  {finishLabel}
                </BusyButton>
              </div>
            </>
          ) : mode === "hero" ? (
            <div className="mt-3">
              <RecordButton
                username={username}
                consented={consentedSpeech}
                provider={speechProvider}
                hero
                hold={false}
                onText={(said, uncertainWord, heldSeconds) => {
                  setPending({ text: said, uncertainWord, seconds: heldSeconds ?? 0 });
                  setMode("review");
                }}
              />
              <button
                type="button"
                onClick={() => setMode("type")}
                className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-full border border-cream-50/40 px-5 text-sm font-semibold text-cream-50"
              >
                {t("extract.ask.typeInstead")}
              </button>
            </div>
          ) : (
            <>
              <div className="relative mt-2">
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={3}
                  placeholder={t("extract.ask.placeholder")}
                  className="min-h-20 w-full rounded-lg border border-line-strong bg-surface-subtle px-3 py-2 pr-12 text-sm text-ink-body"
                />
                {speechCapable && (
                  <RecordButton
                    username={username}
                    consented={consentedSpeech}
                    provider={speechProvider}
                    compact
                    onText={(said) => setText((prev) => (prev ? `${prev} ${said}` : said))}
                  />
                )}
              </div>
              <BusyButton
                busy={busy}
                type="button"
                disabled={text.trim() === ""}
                onClick={() => void submit(text)}
                className="mt-2 min-h-11 rounded-full bg-action-strong px-5 text-sm font-semibold text-on-action disabled:opacity-50"
              >
                {t("extract.ask.submit")}
              </BusyButton>
            </>
          )}
        </div>
      )}
    </div>
  );
}

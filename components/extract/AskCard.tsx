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
 * - `"review"` — S7b, once a recording comes back. `text`/`uncertain`/
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
  place,
  username,
  consentedSpeech,
  speechProvider,
  speechLanguage,
  answerMode,
  runId,
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
   *  follow-up screen's "Finish {weekday}" — B1803 Task 3.5 — and for the
   *  header row's own `Tue 2 Jul` (fix round 2, S7a/S7c). */
  date?: string;
  /** The day's own place, exactly as `DayBoard` already resolves it for its
   *  own summary line (`group.placeName` or the answered "where were you"
   *  gap question) — never a second, invented lookup. `undefined` whenever
   *  the day has none, which the header shows as no place at all rather
   *  than a guess (B1803 Task 3b fix round 2). */
  place?: string;
  username: string;
  consentedSpeech: boolean;
  /** `""` — never a real provider name — means the capability itself is off
   *  (`isEnabled("transcription", user)`), not merely unconsented. Only
   *  then does this whole card fall back to typing-only, with no attempt at
   *  a consent panel or a microphone at all. */
  speechProvider: string;
  /**
   * Which language a recording is transcribed in — B1803 Task 4.1/4.2, the
   * run manifest's own `.language`, answered once on Step 02 and never
   * asked again. Passed straight through as `RecordButton`'s `fixedLanguage`
   * so its own per-recording select (right for a control mounted with no
   * such answer on hand) does not draw a second time here. `undefined` for a
   * run that started before this ticket, or one that never asked because it
   * chose typing — `RecordButton` falls back to its own remembered-or-journal
   * default exactly as it always did.
   */
  speechLanguage?: string;
  /**
   * Which way this run said it wanted to answer — the manifest's own
   * `mode`, asked once on Step 02 ("Speak it" / "Type it out") and, until
   * B1803's final review, written and read by nothing. A run that chose
   * typing opens every question in the typing box rather than the
   * voice-first hero, which is what the answer was for; the mic is still
   * there beside the box for a question somebody would rather speak.
   * `undefined` for a caller with no manifest on hand (a test, a future
   * entry point), which keeps the old behaviour: voice-first wherever
   * speech is available at all.
   */
  answerMode?: "voice" | "type";
  /**
   * The staging run this question belongs to — passed through to
   * `RecordButton` so a transcription is charged against this import's own
   * ledger ref (`extract:<runId>:speech:<n>s`) and the import's "Credits
   * spent" row can name what it really cost (B1803 final review, finding
   * 4). Nothing else uses it here.
   */
  runId?: string;
  /** The day's own photographs, for the strip (or hero) above the question.
   *  Optional so every existing caller keeps compiling before it is wired. */
  photos?: PhotoStripItem[];
  /** Posts the answer to `.../studio/day`; resolved once saved. */
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
  // The run's own answer to "Speak it or type it out?" decides which of the
  // two this opens in — B1803 final review, finding 2.
  const voiceFirst = !isFollowUp && speechCapable && answerMode !== "type";
  const [mode, setMode] = useState<"hero" | "review" | "type">(voiceFirst ? "hero" : "type");
  const [pending, setPending] = useState<{
    text: string;
    uncertain?: { word: string; occurrence: number };
    seconds: number;
  } | null>(null);

  async function submit(value: string) {
    const trimmed = value.trim();
    if (trimmed === "") return;
    setBusy(true);
    try {
      await onAnswer(trimmed);
      setText("");
      setPending(null);
      setMode(voiceFirst ? "hero" : "type");
    } finally {
      setBusy(false);
    }
  }

  // B2057 — Finish closes the day exactly as Skip does: with words, they are
  // the answer; without, the follow-up is skipped. Leaving it open made the
  // prominent button the one that did not finish anything.
  async function finishFollowUp() {
    const trimmed = text.trim();
    setBusy(true);
    try {
      if (trimmed !== "") await onAnswer(trimmed);
      else await onSkip?.();
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
  // day's second, filling in a missing location — or, for an undated group,
  // the day's own *first* question per `lib/extract/questions.ts`'s "when"
  // gap) gets no label at all rather than one invented for a case the
  // design never drew. Keyed on `question.kind`, not `questionIndex`: an
  // undated group's "when" gap question lands at position 1 (it must come
  // before the opening question — there is no "It's Tuesday morning" to say
  // until "when" is answered), and position alone would wrongly dress it in
  // a badge the design never gave a gap question — B1803 Task 3b fix
  // round 2.
  const kindLabel =
    question.kind === "opening" ? t("studio.photos.ask.first") : isFollowUp ? t("studio.photos.ask.oneMore") : null;

  const followUpChips = [
    { key: "who", text: t("studio.photos.ask.chip.who") },
    { key: "after", text: t("studio.photos.ask.chip.after") },
    { key: "why", text: t("studio.photos.ask.chip.why") },
  ];

  // `weekdayLabel` returns "" for a date it cannot parse (the undated
  // group's own `""` among them) — so the weekday clause is dropped rather
  // than printed empty, here and in the header below.
  const weekday = date ? weekdayLabel(date, locale) : "";
  const finishLabel = weekday ? t("studio.photos.ask.finishDay", { weekday }) : t("studio.photos.board.leave");

  // The header row S7a and S7c both draw and S7b does not (`← Tue 2 Jul ·
  // Hoi An` / `1 of 3`, design-v2.html:863/911) — B1803 Task 3b fix
  // round 2. `weekdayLabel` is the same function `DayBoard` already
  // exports and uses for its own day labels, reused rather than a second
  // date formatter. The place only ever shows on the non-follow-up screen
  // (S7a) — the design never draws it on S7c (design-v2.html:911) — and is
  // omitted entirely, never guessed, for an undated group or a day with no
  // place. `undefined` for `date` (the undated group) leaves the title with
  // no date clause rather than an invented one.
  const headerParts: string[] = [];
  if (weekday) headerParts.push(weekday);
  if (!isFollowUp && place) headerParts.push(place);
  const headerTitle = headerParts.join(" · ");
  // The back arrow leaves this question the same way Skip/Finish already
  // do — `onDone` is the board's own "collapse this day's panel" callback,
  // and stepping back out of a single question screen is exactly that,
  // not a second navigation stack invented for this header alone.
  const showHeader = mode !== "review" && questionIndex !== undefined && questionTotal !== undefined;

  return (
    <div>
      {showHeader && (
        <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => onDone?.()}
            aria-label={t("studio.photos.checkWording.back")}
            className="shrink-0 text-lg text-ink-strong"
          >
            ←
          </button>
          {headerTitle !== "" && (
            <span className="min-w-0 flex-1 truncate text-center text-sm font-semibold text-ink-strong">
              {headerTitle}
            </span>
          )}
          {/* The design's own `.navbar .r` colour (a yellow accent) is on
              `test/contrast.test.ts`'s own "never a text colour" list — a
              light accent readable only against the slideshow's blacked-out
              backdrop this card does not have. The neutral secondary-ink
              token below is `StepIndicator`'s own choice for the same kind
              of small, secondary metadata label right beneath this one. */}
          <span className="shrink-0 whitespace-nowrap text-sm font-medium text-ink-secondary">
            {t("studio.photos.step.ofTotal", { current: String(questionIndex), total: String(questionTotal) })}
          </span>
        </div>
      )}
      {dayIndex !== undefined && dayTotal !== undefined && questionIndex !== undefined && questionTotal !== undefined && (
        <StepIndicator
          total={questionTotal}
          current={questionIndex}
          label={t("studio.photos.step.dayOfTotal", { current: String(dayIndex), total: String(dayTotal) })}
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
            uncertain={pending.uncertain}
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
                  placeholder={chip ?? t("studio.photos.ask.placeholder")}
                  className="min-h-20 w-full rounded-lg border border-line-strong bg-surface-subtle px-3 py-2 pr-12 text-sm text-ink-body"
                />
                {speechCapable && (
                  <RecordButton
                    username={username}
                    consented={consentedSpeech}
                    provider={speechProvider}
                    language={speechLanguage}
                    run={runId}
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
                <p className="text-sm font-semibold text-ink-strong">{t("studio.photos.ask.pickOneTitle")}</p>
                <p className="mt-1 text-sm text-ink-secondary">{t("studio.photos.ask.pickOneBody")}</p>
              </div>

              <div className="mt-2 flex gap-2">
                <BusyButton
                  busy={busy}
                  type="button"
                  onClick={() => void skipFollowUp()}
                  className="min-h-11 flex-1 rounded-full border border-line-strong px-5 text-sm font-semibold text-ink-strong"
                >
                  {t("studio.photos.ask.skip")}
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
                language={speechLanguage}
                run={runId}
                hero
                hold={false}
                onText={(said, uncertain, heldSeconds) => {
                  setPending({ text: said, uncertain, seconds: heldSeconds ?? 0 });
                  setMode("review");
                }}
              />
              <button
                type="button"
                onClick={() => setMode("type")}
                className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-full border border-cream-50/40 px-5 text-sm font-semibold text-cream-50"
              >
                {t("studio.photos.ask.typeInstead")}
              </button>
            </div>
          ) : (
            <>
              <div className="relative mt-2">
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={3}
                  placeholder={t("studio.photos.ask.placeholder")}
                  className="min-h-20 w-full rounded-lg border border-line-strong bg-surface-subtle px-3 py-2 pr-12 text-sm text-ink-body"
                />
                {speechCapable && (
                  <RecordButton
                    username={username}
                    consented={consentedSpeech}
                    provider={speechProvider}
                    language={speechLanguage}
                    run={runId}
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
                {t("studio.photos.ask.submit")}
              </BusyButton>
            </>
          )}
        </div>
      )}
    </div>
  );
}

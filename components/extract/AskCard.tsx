"use client";

import { useState } from "react";
import BusyButton from "@/components/BusyButton";
import { useI18n } from "@/components/LocaleProvider";
import PhotoStrip, { type PhotoStripItem } from "@/components/extract/PhotoStrip";
import PhotoViewer, { type PhotoViewerItem } from "@/components/extract/PhotoViewer";
import StepIndicator from "@/components/extract/StepIndicator";
import RecordButton from "@/components/RecordButton";
import type { Question } from "@/lib/extract/questions";

/**
 * One question about one day, answered by voice or by typing — B1751, Task 2.3.
 *
 * **The transcript is editable, always.** Speech recognition gets names and
 * places wrong — that is the normal case, not the exception — so what comes
 * back from `RecordButton` lands in the same `<textarea>` typing already
 * uses rather than a read-only line next to a "keep" button. A person
 * corrects it exactly like they would correct their own typo.
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
  username,
  consentedSpeech,
  speechProvider,
  photos = [],
  onAnswer,
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
  username: string;
  consentedSpeech: boolean;
  speechProvider: string;
  /** The day's own photographs, for the strip (or hero) above the question.
   *  Optional so every existing caller keeps compiling before it is wired. */
  photos?: PhotoStripItem[];
  /** Posts the answer to `.../extract/day`; resolved once saved. */
  onAnswer: (text: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  async function submit() {
    const trimmed = text.trim();
    if (trimmed === "") return;
    setBusy(true);
    try {
      await onAnswer(trimmed);
      setText("");
    } finally {
      setBusy(false);
    }
  }

  const viewerItems: PhotoViewerItem[] = photos.map((p) => ({ id: p.id, kind: p.kind, src: p.src }));
  const isFollowUp = question.kind === "follow-up";

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

      <div className="rounded-xl border border-line-strong bg-surface-raised p-3">
      <p className="text-sm text-ink-strong">{question.text}</p>
      <div className="relative mt-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          placeholder={t("extract.ask.placeholder")}
          className="min-h-20 w-full rounded-lg border border-line-strong bg-surface-subtle px-3 py-2 pr-12 text-sm text-ink-body"
        />
        <RecordButton
          username={username}
          consented={consentedSpeech}
          provider={speechProvider}
          compact
          onText={(said) => setText((prev) => (prev ? `${prev} ${said}` : said))}
        />
      </div>
      <BusyButton
        busy={busy}
        type="button"
        disabled={text.trim() === ""}
        onClick={() => void submit()}
        className="mt-2 min-h-11 rounded-full bg-action-strong px-5 text-sm font-semibold text-on-action disabled:opacity-50"
      >
        {t("extract.ask.submit")}
      </BusyButton>
      </div>
    </div>
  );
}

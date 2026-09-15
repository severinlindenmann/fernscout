"use client";

import { useState } from "react";
import BusyButton from "@/components/BusyButton";
import { useI18n } from "@/components/LocaleProvider";
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
 */
export default function AskCard({
  question,
  username,
  consentedSpeech,
  speechProvider,
  onAnswer,
}: {
  question: Question;
  username: string;
  consentedSpeech: boolean;
  speechProvider: string;
  /** Posts the answer to `.../extract/day`; resolved once saved. */
  onAnswer: (text: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

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

  return (
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
        className="mt-2 min-h-11 rounded-full bg-ink-strong px-5 text-sm font-semibold text-white disabled:opacity-50"
      >
        {t("extract.ask.submit")}
      </BusyButton>
    </div>
  );
}

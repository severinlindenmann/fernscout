"use client";

import { useState } from "react";
import BusyButton from "@/components/BusyButton";
import { useI18n } from "@/components/LocaleProvider";
import { cannedReasonsFor } from "@/lib/studio/declineReasons";

/**
 * A5b — "Declining, in words". One field, walked by both of A5's own
 * buttons: the bulk "say why not" path calls this once per still-open
 * field, and "answer it" (the per-field mini screen) links here too, since
 * declining is always the other honest answer to any of these questions.
 *
 * Canned reasons come from `cannedReasonsFor`, which reads them straight out
 * of the field's own `whyRequired` sentence (`DAY_DECLINABLES`, v2) rather
 * than a second list kept here — most fields have none, and this renders
 * nothing but the free-text box for those, which is correct: not every
 * question has three obvious answers.
 *
 * **A decline with an empty reason is never written (C8).** The confirm
 * button stays disabled until the chosen or typed reason clears the same
 * ten-character floor the v2 API itself enforces (`declineReason`,
 * `lib/api/v2/schemas/shared.ts`) — checked again, for real, on the server
 * before anything is kept (`createDayTransactional`), so a client bug here
 * can narrow what gets written but never widen it.
 */
export default function DeclineScreen({
  field,
  whyRequired,
  onConfirm,
  onCancel,
}: {
  field: string;
  whyRequired: string;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const canned = cannedReasonsFor(whyRequired);
  const [picked, setPicked] = useState<string | null>(null);
  const [free, setFree] = useState("");
  const usingFree = picked === null || picked === "__free__";
  const reason = usingFree ? free.trim() : picked;
  const valid = reason.length >= 10;
  const tooShort = !valid && reason.length > 0;

  return (
    <div className="mt-4">
      <h2 className="font-display text-xl font-semibold text-ink-strong">
        {t("studio.day.decline.question", { field: t(`studio.day.field.${field}` as never) })}
      </h2>
      <p className="mt-2 text-sm text-ink-body">{t("studio.day.decline.intro")}</p>

      <div className="mt-3 flex flex-col gap-2">
        {canned.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => {
              setPicked(option);
              setFree("");
            }}
            className={`rounded-xl border px-4 py-3 text-left text-sm font-semibold ${
              picked === option
                ? "border-action-strong bg-surface-subtle text-ink-strong"
                : "border-line-strong text-ink-strong hover:bg-surface-subtle"
            }`}
          >
            {option}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setPicked("__free__")}
          className={`rounded-xl border px-4 py-3 text-left text-sm font-semibold ${
            usingFree ? "border-action-strong bg-surface-subtle text-ink-strong" : "border-line-strong text-ink-strong hover:bg-surface-subtle"
          }`}
        >
          {t("studio.day.decline.somethingElse")}
        </button>
        {usingFree && (
          <div>
            <textarea
              value={free}
              onChange={(e) => setFree(e.target.value)}
              placeholder={t("studio.day.decline.freePlaceholder")}
              aria-invalid={tooShort || undefined}
              aria-describedby={tooShort ? "decline-too-short" : undefined}
              className={`min-h-20 w-full rounded-xl border bg-surface-base px-3 py-2 text-sm text-ink-body ${tooShort ? "border-coral-600" : "border-line-strong"}`}
            />
            {tooShort && (
              <p id="decline-too-short" role="alert" className="mt-1.5 text-sm text-coral-600">
                {t("studio.day.decline.tooShort")}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <BusyButton
          type="button"
          disabled={!valid}
          onClick={() => onConfirm(reason)}
          className="min-h-11 rounded-full bg-yellow-400 px-5 text-base font-semibold text-yellow-950 transition-colors hover:bg-yellow-300 disabled:opacity-50"
        >
          {t("studio.day.decline.confirm")}
        </BusyButton>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-11 rounded-full border border-line-strong px-5 text-base font-semibold text-ink-body hover:bg-surface-subtle"
        >
          {t("me.cancel")}
        </button>
      </div>
    </div>
  );
}

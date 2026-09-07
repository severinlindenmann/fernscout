"use client";

import { useI18n } from "@/components/LocaleProvider";

/**
 * A question asked in the page, not by the browser — B668.
 *
 * B633 made this call first, for the day-notify button, and the reasoning is
 * its: a `window.confirm` arrives in the operating system's own type, in a box
 * whose title bar names the domain, over a page that has gone to some trouble
 * to look like somebody's travel journal. It also renders exactly one string,
 * so it cannot show what it is about to delete, what it will cost, or offer a
 * second choice alongside the first — the cleanup's two stacked dialogs were
 * that limitation showing.
 *
 * Extracted here once there were three callers with one shape. Two would not
 * have been enough: B668 said as much in its own Work section and was wrong by
 * the time the photobook's pair joined the storage card's.
 *
 * **`aria-modal="false"`, and no focus trap.** It sits in the flow rather than
 * over it, the same call `DayNotify` and `PushPrompt` make. Nothing this
 * codebase asks is urgent enough to cover the page up for, and a real modal is
 * a focus-management problem nobody here needs to own.
 *
 * The confirming button is the yellow one and it says what it *does* —
 * "Delete them", "Buy 5 GB" — never "OK". Somebody who has stopped reading by
 * the time they reach the buttons should still be able to tell the two apart.
 */
export default function ConfirmPanel({
  label,
  question,
  confirmLabel,
  busyLabel,
  busy = false,
  error,
  onConfirm,
  onCancel,
  children,
}: {
  /** Names the dialog for a screen reader — usually the button that opened it. */
  label: string;
  question: string;
  confirmLabel: string;
  busyLabel?: string;
  busy?: boolean;
  error?: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Anything the question needs beyond words — a checkbox for a second,
   * narrower choice that would otherwise have been a second dialog. */
  children?: React.ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label={label}
      className="max-w-md rounded-2xl border border-navy-200 bg-cream-50 p-4"
    >
      <p className="text-sm leading-6 text-navy-700">{question}</p>
      {children}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="min-h-11 rounded-full bg-yellow-400 px-5 text-base font-semibold text-yellow-950 transition-colors hover:bg-yellow-300 disabled:opacity-50"
        >
          {busy && busyLabel ? busyLabel : confirmLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="min-h-11 rounded-full border border-navy-300 px-5 text-base font-semibold text-navy-700 transition-colors hover:bg-cream-100 disabled:opacity-50"
        >
          {t("me.cancel")}
        </button>
      </div>
      {error && (
        <p role="status" className="mt-2 text-sm text-coral-600">
          {error}
        </p>
      )}
    </div>
  );
}

"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { useI18n } from "@/components/LocaleProvider";

/**
 * The one sheet the "without a trip" screens share (B2914) — the preview pane,
 * the add/edit form and the checklist. A bottom sheet on a phone, a centred
 * card from `sm` up, the same overlay `PushInstallOnboarding` draws. Escape and
 * the close button dismiss it; focus moves into it once on mount.
 */
export default function VisitedSheet({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const { t } = useI18n();
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.focus();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-overlay-strong/40 sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-surface-raised shadow-xl focus:outline-none sm:rounded-2xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-line-quiet px-5 py-3">
          <h2 className="font-display text-lg font-semibold text-ink-strong">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("visited.close")}
            className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-surface-subtle hover:text-ink-strong"
          >
            <X aria-hidden className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer && <div className="border-t border-line-quiet bg-surface-raised px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

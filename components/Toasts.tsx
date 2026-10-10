"use client";

import { useSyncExternalStore } from "react";
import { dismissToast, getToasts, subscribeToasts } from "@/lib/toast";
import { useI18n } from "./LocaleProvider";

const none: never[] = [];

/** B-2929 — the one toast host, mounted in the root layout. Bottom of the
 * screen on a phone (above the safe area), bottom-right on desktop. */
export default function Toasts() {
  const { t } = useI18n();
  const toasts = useSyncExternalStore(subscribeToasts, getToasts, () => none);
  if (toasts.length === 0) return null;
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col gap-2 px-4 sm:inset-x-auto sm:right-4 sm:w-96 sm:px-0"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1rem)" }}
    >
      {toasts.map((x) => (
        <div
          key={x.id}
          role={x.kind === "error" ? "alert" : "status"}
          className="fs-rise-in pointer-events-auto flex items-start gap-3 rounded-lg border border-line-strong bg-surface-raised p-3 text-sm shadow-lg"
        >
          <div className="min-w-0 flex-1 break-words">
            <p className={x.kind === "error" ? "font-medium text-coral-600" : "font-medium"}>
              {x.kind === "error" ? t("toast.failed", { action: x.action }) : x.action}
            </p>
            {x.kind === "error" && (
              <p className="mt-1 text-ink-secondary">
                {x.detail ?? (x.ref ? t("toast.serverFault") : t("toast.unknown"))}
                {x.code && <span className="font-mono"> ({x.code})</span>}
              </p>
            )}
            {x.ref && <p className="mt-1 font-mono text-xs text-ink-secondary">{t("toast.ref", { ref: x.ref })}</p>}
          </div>
          <button type="button" onClick={() => dismissToast(x.id)} className="shrink-0 rounded px-2 py-1 underline">
            {t("toast.dismiss")}
          </button>
        </div>
      ))}
    </div>
  );
}

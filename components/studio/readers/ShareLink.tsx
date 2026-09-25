"use client";

import { useState, useSyncExternalStore } from "react";
import type { Translate } from "./shared";

const noop = () => () => {};

/**
 * A link the owner hands on themselves: the URL as selectable text, Copy, and
 * the system share sheet where the device has one (`navigator.share`, read through
 * `useSyncExternalStore` so the server render and hydration agree).
 */
export default function ShareLink({ url, t, big = false }: { url: string; t: Translate; big?: boolean }) {
  const [copied, setCopied] = useState<boolean | null>(null);
  const canShare = useSyncExternalStore(
    noop,
    () => typeof navigator.share === "function",
    () => false,
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <code
        className={`break-all rounded-xl border border-line-strong bg-surface-base px-3 py-2 font-semibold text-ink-strong ${
          big ? "text-lg" : "text-sm"
        }`}
      >
        {url.replace(/^https?:\/\//, "")}
      </code>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={copy}
          className="min-h-11 rounded-xl bg-yellow-400 px-4 text-sm font-semibold text-navy-900 hover:bg-yellow-300"
        >
          {copied ? t("notifyStep.copied") : t("readers.link.copy")}
        </button>
        {canShare && (
          <button
            type="button"
            onClick={() => navigator.share({ url }).catch(() => {})}
            className="min-h-11 rounded-xl border border-line-strong bg-surface-raised px-4 text-sm font-semibold text-ink-strong hover:bg-surface-subtle"
          >
            {t("readers.link.share")}
          </button>
        )}
      </div>
      {copied === false && (
        <p role="alert" className="text-sm text-coral-600">
          {t("readers.copyFailed")}
        </p>
      )}
    </div>
  );
}

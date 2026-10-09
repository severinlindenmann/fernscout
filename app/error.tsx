"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/components/LocaleProvider";
import { pageRequestId } from "@/lib/requestId";

/**
 * The catch-all for a render that threw.
 *
 * Before this file, a server error reached the reader as Next's own grey
 * "Application error" screen, in English, with no way forward — which for
 * somebody who opened a link from an email reads as "the whole thing is
 * broken". Two things fix that: say whose fault it is (ours), and give them a
 * button. `retry()` re-fetches and re-renders the segment, so a transient
 * failure — a dropped connection mid-navigation, most likely on a bus — clears
 * without a reload.
 *
 * Next 16 passes `retry`, not the older `reset`; `reset` re-renders without
 * re-fetching, which for a server-render failure just fails again.
 *
 * The digest is shown deliberately. Production hides the real message, so it is
 * the only thing that connects "it did it again" from a reader to a line in the
 * server log.
 */
export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const { t } = useI18n();
  const [requestId, setRequestId] = useState<string | null>(null);

  useEffect(() => {
    console.error("[fernscout] render failed", error);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the document is only readable in the browser
    setRequestId(pageRequestId());
  }, [error]);

  return (
    <main id="main" tabIndex={-1} className="mx-auto w-full max-w-xl px-6 py-20 sm:py-28">
      <h1 className="font-display text-3xl font-semibold leading-tight text-ink-strong sm:text-4xl">
        {t("err.crashTitle")}
      </h1>
      <p className="mt-5 text-xl leading-8 text-ink-body">{t("err.crashBody")}</p>

      <div className="mt-9 flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={() => retry()}
          className="inline-flex min-h-12 items-center justify-center rounded-full bg-yellow-400 px-6 text-lg font-semibold text-yellow-950 transition-colors hover:bg-yellow-300"
        >
          {t("err.retry")}
        </button>
        {/* B2851: a way out that does not need the crash to clear. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a full load: the router may be what crashed */}
        <a
          href="/"
          className="inline-flex min-h-12 items-center justify-center rounded-full border-2 border-line-quiet px-6 text-lg font-semibold text-ink-strong hover:underline"
        >
          {t("err.goToStart")}
        </a>
      </div>

      {error.digest && (
        <p className="mt-8 font-mono text-sm text-ink-secondary">
          {t("err.reference", { id: error.digest })}
        </p>
      )}
      {requestId && (
        <p className="mt-2 font-mono text-sm text-ink-secondary">{t("err.requestId", { id: requestId })}</p>
      )}
    </main>
  );
}

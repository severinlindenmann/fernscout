"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/components/LocaleProvider";
import UploadStep from "@/components/extract/UploadStep";

type Run = { runId: string; expiresAt: string };

/**
 * The camera roll import's shell — B1751, Task 1.3.
 *
 * Opens a run the moment the page loads (`POST .../extract/start`, Task 1.2)
 * and then hands the upload step its `runId`. Everything past the upload —
 * the day board, the question card — is a later task's screen; this step
 * ends at "uploaded", not at "imported".
 */
export default function ExtractFlow({ username }: { username: string }) {
  const { t } = useI18n();
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState(false);
  const [uploaded, setUploaded] = useState<number | null>(null);

  useEffect(() => {
    start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function start() {
    setError(false);
    setRun(null);
    try {
      const res = await fetch(`/api/helper/${encodeURIComponent(username)}/extract/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as Run;
      setRun(json);
    } catch {
      setError(true);
    }
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-8">
      <h1 className="text-2xl font-semibold text-ink-strong">{t("extract.title")}</h1>

      {error && (
        <div className="mt-4">
          <p className="text-sm text-red-700">{t("extract.flow.startError")}</p>
          <button
            type="button"
            onClick={start}
            className="mt-2 inline-flex min-h-11 items-center rounded-full border border-line-strong px-5 text-base font-semibold text-ink-strong"
          >
            {t("err.retry")}
          </button>
        </div>
      )}

      {!run && !error && <p className="mt-4 text-sm text-ink-secondary">{t("extract.flow.starting")}</p>}

      {run && uploaded === null && (
        <div className="mt-4">
          <UploadStep username={username} runId={run.runId} onDone={setUploaded} />
        </div>
      )}

      {uploaded !== null && (
        <p className="mt-4 text-sm text-ink-body">{t("extract.flow.done", { count: String(uploaded) })}</p>
      )}
    </div>
  );
}

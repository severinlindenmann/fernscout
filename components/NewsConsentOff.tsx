"use client";

import { useState } from "react";
import BusyButton from "@/components/BusyButton";
import { useI18n } from "@/components/LocaleProvider";

/**
 * B2453 — the way back out of "News from Fernscout": shown on /me only while
 * this address is on the list, so the join form's promise ("you can turn it
 * off on your own page") is true.
 */
export default function NewsConsentOff({ journal }: { journal: string }) {
  const { t } = useI18n();
  const [state, setState] = useState<"on" | "busy" | "off" | "failed">("on");

  async function stop() {
    setState("busy");
    try {
      const res = await fetch(`/${encodeURIComponent(journal)}/me/news`, { method: "POST" });
      setState(res.ok ? "off" : "failed");
    } catch {
      setState("failed");
    }
  }

  return (
    <section aria-labelledby="news-title" className="mt-8 border-t border-line-quiet pt-6">
      <h2 id="news-title" className="font-display text-xl font-semibold text-ink-strong">
        {t("me.newsTitle")}
      </h2>
      {state === "off" ? (
        <p role="status" className="mt-2 text-base text-ink-body">
          {t("me.newsOff")}
        </p>
      ) : (
        <>
          <p className="mt-2 text-base text-ink-body">{t("me.newsOn")}</p>
          <BusyButton
            busy={state === "busy"}
            type="button"
            onClick={stop}
            className="mt-3 inline-flex min-h-11 items-center rounded-full border border-line-ink px-4 text-sm font-semibold text-ink-strong"
          >
            {t("me.newsStop")}
          </BusyButton>
          {state === "failed" && (
            <p role="alert" className="mt-2 text-sm text-coral-600">
              {t("me.newsFailed")}
            </p>
          )}
        </>
      )}
    </section>
  );
}

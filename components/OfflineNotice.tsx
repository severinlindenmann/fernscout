"use client";

import { useEffect, useState } from "react";
import NoticeShell from "./NoticeShell";
import { useI18n } from "./LocaleProvider";

/**
 * The offline page's one control.
 *
 * A link would be wrong here: the service worker serves this page's body in
 * answer to whatever URL the reader actually asked for, so the address bar
 * still holds their day, and reloading retries *that* rather than sending them
 * somewhere else. The button also enables itself the moment the browser sees a
 * connection again, which on a bus is the difference between pressing it
 * hopefully and pressing it once.
 */
export default function OfflineNotice() {
  const { t } = useI18n();
  const [online, setOnline] = useState(false);

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  return (
    <NoticeShell title={t("err.offlineTitle")} body={t("err.offlineBody")}>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className={`mt-9 inline-flex min-h-12 items-center justify-center rounded-full px-6 text-lg font-semibold transition-colors ${
          online
            ? "bg-yellow-400 text-yellow-950 hover:bg-yellow-300"
            : "border border-navy-200 bg-white text-navy-700"
        }`}
      >
        {t("err.retry")}
      </button>
    </NoticeShell>
  );
}

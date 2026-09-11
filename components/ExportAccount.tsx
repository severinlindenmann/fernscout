"use client";

import { useState } from "react";
import BusyButton from "@/components/BusyButton";
import { useI18n } from "@/components/LocaleProvider";

/**
 * Taking everything with you — B1295, beside `DeleteAccount`.
 *
 * Leaving and taking your things with you are the same moment, so this sits
 * right next to it and uses the same mechanism: a link mailed to the address
 * that owns the journal. There is nothing to confirm the way deletion needs
 * confirming — downloading a copy changes nothing — so one press is the
 * whole flow: the button asks, the mail arrives, and the link in it is the
 * download itself.
 */
export default function ExportAccount({ username }: { username: string }) {
  const { t } = useI18n();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [minutes, setMinutes] = useState("60");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function ask() {
    setBusy(true);
    setFailed(false);
    const response = await fetch(`/${encodeURIComponent(username)}/me/export`, {
      method: "POST",
    }).catch(() => null);
    setBusy(false);
    if (!response?.ok) {
      setFailed(true);
      return;
    }
    const sent = (await response.json()) as { mailedTo: string; minutes: string };
    setMinutes(sent.minutes);
    setSentTo(sent.mailedTo);
  }

  return (
    <section className="mt-8 border-t border-navy-200 pt-6">
      <h2 className="font-display text-xl font-semibold text-navy-900">
        {t("me.exportTitle")}
      </h2>
      <p className="mt-2 text-base leading-7 text-navy-700">{t("me.exportBody")}</p>

      {sentTo ? (
        <p role="status" className="mt-4 text-base leading-7 text-navy-900">
          {t("me.exportSent", { email: sentTo, minutes })}
        </p>
      ) : (
        <>
          <BusyButton
            type="button"
            busy={busy}
            busyLabel={t("me.exportWorking")}
            onClick={() => void ask()}
            className="mt-4 inline-flex min-h-11 items-center rounded-full border border-navy-700 px-5 text-base font-semibold text-navy-900 transition-colors hover:bg-cream-100 disabled:opacity-50"
          >
            {t("me.exportButton")}
          </BusyButton>
          <p role="alert" className="mt-3 text-base text-coral-600 empty:mt-0">
            {failed ? t("me.exportFailed") : ""}
          </p>
        </>
      )}
    </section>
  );
}

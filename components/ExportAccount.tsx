"use client";

import { useState } from "react";
import ConfirmPanel from "@/components/ConfirmPanel";
import { useI18n } from "@/components/LocaleProvider";

/**
 * Taking everything with you — B1295, beside `DeleteAccount`.
 *
 * Leaving and taking your things with you are the same moment, so this sits
 * right next to it and uses the same mechanism: a link mailed to the address
 * that owns the journal. B2023: the owner asked for a confirmation before
 * the mail goes, the same shape deletion has — one press opens the question,
 * the second sends. `open` starts with the question already showing (the hub
 * tile pressed is the first press), and `onClose` is what cancel does there.
 */
export default function ExportAccount({
  username,
  open = false,
  onClose,
}: {
  username: string;
  open?: boolean;
  onClose?: () => void;
}) {
  const { t } = useI18n();
  const [asking, setAsking] = useState(open);
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
    setAsking(false);
  }

  function cancel() {
    setAsking(false);
    onClose?.();
  }

  return (
    <section className="mt-8 border-t border-line-quiet pt-6">
      <h2 className="font-display text-xl font-semibold text-ink-strong">
        {t("me.exportTitle")}
      </h2>
      <p className="mt-2 text-base leading-7 text-ink-body">{t("me.exportBody")}</p>

      {sentTo ? (
        <p role="status" className="mt-4 text-base leading-7 text-ink-strong">
          {t("me.exportSent", { email: sentTo, minutes })}
        </p>
      ) : asking ? (
        <div className="mt-4">
          <ConfirmPanel
            label={t("me.exportButton")}
            question={t("me.exportQuestion")}
            confirmLabel={t("me.exportConfirm")}
            busyLabel={t("me.exportWorking")}
            busy={busy}
            error={failed ? t("me.exportFailed") : undefined}
            onConfirm={() => void ask()}
            onCancel={cancel}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAsking(true)}
          className="mt-4 inline-flex min-h-11 items-center rounded-full border border-line-ink px-5 text-base font-semibold text-ink-strong transition-colors hover:bg-surface-subtle"
        >
          {t("me.exportButton")}
        </button>
      )}
    </section>
  );
}

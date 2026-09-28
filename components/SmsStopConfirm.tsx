"use client";

import { useState } from "react";
import ConfirmPanel from "@/components/ConfirmPanel";
import { useI18n } from "@/components/LocaleProvider";

import { journalPath } from "@/lib/journalPath";
export default function SmsStopConfirm({ username, token, journal }: { username: string; token: string; journal: string }) {
  const { t } = useI18n();
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");

  if (state === "done") {
    return <p className="text-lg leading-relaxed text-ink-body">{t("smsStop.done", { journal })}</p>;
  }

  return (
    <ConfirmPanel
      label={t("smsStop.title")}
      question={t("smsStop.question", { journal })}
      details={t("smsStop.details")}
      confirmLabel={t("smsStop.confirm")}
      busyLabel={t("smsStop.working")}
      busy={state === "busy"}
      error={state === "error" ? t("smsStop.error") : undefined}
      tone="destructive"
      onConfirm={async () => {
        setState("busy");
        const response = await fetch(`${journalPath(username)}/stop/${token}/confirm`, { method: "POST" }).catch(() => null);
        setState(response?.ok ? "done" : "error");
      }}
      onCancel={() => {
        window.location.href = journalPath(username);
      }}
      cancelLabel={t("smsStop.cancel")}
    />
  );
}

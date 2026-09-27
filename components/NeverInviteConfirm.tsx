"use client";

import { useState } from "react";
import ConfirmPanel from "@/components/ConfirmPanel";
import { useI18n } from "@/components/LocaleProvider";

/**
 * "Never invite this address again" — the public page an invite mail's
 * footer links to (B2442). No login: the token in the URL is the whole
 * credential, and it can only ever suppress one address or number, never
 * read one back.
 */
export default function NeverInviteConfirm({ token }: { token: string }) {
  const { t } = useI18n();
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");

  if (state === "done") {
    return (
      <p className="text-lg leading-relaxed text-ink-body">{t("neverInvite.done")}</p>
    );
  }

  return (
    <ConfirmPanel
      label={t("neverInvite.title")}
      question={t("neverInvite.question")}
      details={t("neverInvite.details")}
      confirmLabel={t("neverInvite.confirm")}
      busyLabel={t("neverInvite.working")}
      busy={state === "busy"}
      error={state === "error" ? t("neverInvite.error") : undefined}
      tone="destructive"
      onConfirm={async () => {
        setState("busy");
        const response = await fetch(`/x/${token}/confirm`, { method: "POST" }).catch(() => null);
        setState(response?.ok ? "done" : "error");
      }}
      onCancel={() => {
        window.location.href = "/";
      }}
      cancelLabel={t("neverInvite.cancel")}
    />
  );
}

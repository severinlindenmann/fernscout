"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { useI18n } from "./LocaleProvider";

/**
 * The operator's Accept button — B425. Posts the token to the approve route,
 * which grants the credits. On success it shows what was granted; the token is
 * spent, so a reload of this page will 404.
 */
export default function ApproveButton({
  username,
  paymentId,
  token,
  credits,
  amount,
}: {
  username: string;
  paymentId: string;
  token: string;
  credits: number;
  amount: string;
}) {
  const { t, tn } = useI18n();
  const [state, setState] = useState<"idle" | "busy" | "done" | "failed">("idle");

  async function approve() {
    setState("busy");
    const response = await fetch(`/api/v1/${username}/payments/${paymentId}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    }).catch(() => null);
    setState(response?.ok ? "done" : "failed");
  }

  return (
    <>
      <h1 className="font-display text-3xl font-semibold tracking-tight text-navy-900 sm:text-4xl">
        {t("approve.title")}
      </h1>
      <section className="mt-6 rounded-2xl border border-navy-200 bg-white p-5 sm:p-6">
        {state === "done" ? (
          <div className="rounded-xl border border-green-500/40 bg-green-100 p-4">
            <p className="flex items-center gap-2 font-display text-base font-semibold text-green-700">
              <Check className="h-5 w-5" aria-hidden="true" />
              {t("approve.done", { credits: String(credits), user: username })}
            </p>
          </div>
        ) : (
          <>
            <p className="text-lg leading-8 text-navy-900">
              {t("approve.prompt", {
                credits: String(credits),
                unit: tn("me.paymentUnit", credits),
                amount,
                user: username,
              })}
            </p>
            <button
              type="button"
              onClick={approve}
              disabled={state === "busy"}
              className="mt-5 inline-flex min-h-11 items-center justify-center rounded-full bg-yellow-400 px-6 text-base font-semibold text-yellow-950 transition-colors hover:bg-yellow-300 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {state === "busy" ? t("approve.working") : t("approve.accept")}
            </button>
            {state === "failed" && (
              <p role="alert" className="mt-3 text-base text-coral-600">
                {t("approve.failed")}
              </p>
            )}
          </>
        )}
      </section>
    </>
  );
}

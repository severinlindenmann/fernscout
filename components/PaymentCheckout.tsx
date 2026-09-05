"use client";

import { useState } from "react";
import { Check, Smartphone, CreditCard } from "lucide-react";
import { useI18n } from "./LocaleProvider";
import { formatChf } from "@/lib/credits/pricing";
import type { PaymentMethod, PaymentStatus } from "@/lib/payments";

/**
 * The mock checkout card — B405.
 *
 * Renders one transaction: amount, credits, id and status. While pending it
 * offers TWINT or a card and a Pay button; pressing it posts to the pay route,
 * which records the payment and — deliberately — adds no credits. The success
 * state says so in plain words: this is a preview, nothing was charged and no
 * credits were added. A reader who comes back to the link later sees the paid
 * state instead of the buttons.
 */
type PaymentView = {
  id: string;
  credits: number;
  amountRappen: number;
  status: PaymentStatus;
  method: PaymentMethod | null;
  paidAt: string | null;
};

export default function PaymentCheckout({
  username,
  payment,
}: {
  username: string;
  payment: PaymentView;
}) {
  const { t, tn } = useI18n();
  const [status, setStatus] = useState<PaymentStatus>(payment.status);
  const [approver, setApprover] = useState<string | null>(null);
  const [method, setMethod] = useState<PaymentMethod>(payment.method ?? "twint");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function pay() {
    setBusy(true);
    setFailed(false);
    const response = await fetch(`/api/v1/${username}/payments/${payment.id}/pay`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ method }),
    }).catch(() => null);
    setBusy(false);
    if (response?.ok) {
      const b = (await response.json().catch(() => null)) as { approver?: string | null } | null;
      setApprover(b?.approver ?? null);
      setStatus("requested");
    } else {
      setFailed(true);
    }
  }

  const paid = status === "paid";
  const requested = status === "requested";

  return (
    <>
      <h1 className="font-display text-3xl font-semibold tracking-tight text-navy-900 sm:text-4xl">
        {t("pay.title")}
      </h1>

      <section className="mt-6 rounded-2xl border border-navy-200 bg-white p-5 sm:p-6">
        {/* The summary — the same whether paid or pending. */}
        <div className="flex items-baseline justify-between gap-4">
          <p className="font-display text-2xl font-semibold text-navy-900">
            {payment.credits} {tn("me.paymentUnit", payment.credits)}
          </p>
          <p className="font-display text-2xl font-semibold tabular-nums text-navy-900">
            {formatChf(payment.amountRappen)}
          </p>
        </div>
        <dl className="mt-4 space-y-1.5 text-base text-navy-700">
          <div className="flex justify-between gap-4">
            <dt className="text-navy-600">{t("pay.transaction")}</dt>
            <dd className="font-mono text-sm text-navy-900 break-all">{payment.id}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-navy-600">{t("pay.status")}</dt>
            <dd className={`font-semibold ${paid ? "text-green-700" : "text-navy-900"}`}>
              {t(paid ? "pay.statusPaid" : requested ? "pay.statusRequested" : "pay.statusPending")}
            </dd>
          </div>
        </dl>

        {paid ? (
          <div className="mt-5 rounded-xl border border-green-500/40 bg-green-100 p-4">
            <p className="flex items-center gap-2 font-display text-base font-semibold text-green-700">
              <Check className="h-5 w-5" aria-hidden="true" />
              {t("pay.paidTitle")}
            </p>
            <p className="mt-1.5 text-base leading-7 text-navy-700">
              {t("pay.paidNote", { credits: String(payment.credits) })}
            </p>
          </div>
        ) : requested ? (
          <div className="mt-5 rounded-xl border border-navy-200 bg-cream-50 p-4">
            <p className="font-display text-base font-semibold text-navy-900">
              {t("pay.requestedTitle")}
            </p>
            {/* The manual-approval bridge, in plain words. */}
            <p className="mt-1.5 text-base leading-7 text-navy-700">
              {approver
                ? t("pay.requestedNote", { admin: approver })
                : t("pay.requestedNoteNoAdmin")}
            </p>
          </div>
        ) : (
          <div className="mt-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-navy-600">
              {t("pay.chooseMethod")}
            </p>
            <div className="mt-2 grid grid-cols-2 gap-3">
              {(
                [
                  { id: "twint" as const, label: t("pay.twint"), Icon: Smartphone },
                  { id: "card" as const, label: t("pay.card"), Icon: CreditCard },
                ]
              ).map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={method === id}
                  onClick={() => setMethod(id)}
                  className={`flex min-h-11 items-center justify-center gap-2 rounded-xl border px-4 text-base font-semibold transition-colors ${
                    method === id
                      ? "border-navy-900 bg-cream-50 text-navy-900"
                      : "border-navy-200 text-navy-700 hover:border-navy-500"
                  }`}
                >
                  <Icon className="h-[18px] w-[18px] text-navy-600" aria-hidden="true" />
                  {label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={pay}
              disabled={busy}
              className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-full bg-yellow-400 px-5 text-base font-semibold text-yellow-950 transition-colors hover:bg-yellow-300 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? t("pay.working") : t("pay.payNow", { amount: formatChf(payment.amountRappen) })}
            </button>
            {failed && (
              <p role="alert" className="mt-3 text-base text-coral-600">
                {t("pay.failed")}
              </p>
            )}
            <p className="mt-3 text-sm leading-6 text-navy-600">{t("pay.comeBack")}</p>
          </div>
        )}
      </section>
    </>
  );
}

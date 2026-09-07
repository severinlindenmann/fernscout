"use client";

import { useEffect, useState } from "react";
import BusyButton from "@/components/BusyButton";
import { useRouter, useSearchParams } from "next/navigation";
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
  provider,
}: {
  username: string;
  payment: PaymentView;
  /** `"stripe"` sends the buyer to a hosted checkout page and a webhook grants
   *  the credits; `"manual"` is the operator-approves-by-mail path (B425),
   *  which is what an instance with no provider configured still does. */
  provider: "stripe" | "manual";
}) {
  const { t, tn } = useI18n();
  const [status, setStatus] = useState<PaymentStatus>(payment.status);
  const [approver, setApprover] = useState<string | null>(null);
  const [method, setMethod] = useState<PaymentMethod>(
    payment.method ?? "twint",
  );
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function pay() {
    setBusy(true);
    setFailed(false);
    const response = await fetch(
      `/api/v1/${username}/payments/${payment.id}/pay`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ method }),
      },
    ).catch(() => null);
    if (response?.ok) {
      const b = (await response.json().catch(() => null)) as {
        approver?: string | null;
        url?: string;
      } | null;
      // The provider path answers with somewhere to go. Stay busy: this tab is
      // leaving, and a button that springs back to life for the half-second
      // before it does invites a second press.
      if (b?.url) {
        window.location.href = b.url;
        return;
      }
      setBusy(false);
      setApprover(b?.approver ?? null);
      setStatus("requested");
    } else {
      setBusy(false);
      setFailed(true);
    }
  }

  const paid = status === "paid";
  const requested = status === "requested";

  // Back from the provider, and the webhook has not landed yet — B792. The
  // redirect is the buyer arriving, not the payment settling: the two race,
  // and the webhook usually wins by a second or two. Re-read the page a few
  // times rather than telling somebody who has just paid that nothing has.
  // Bounded on purpose: a payment that has genuinely not settled is not one a
  // page should poll about forever, and the link still shows the truth later.
  const returned = useSearchParams().get("returned") === "1";
  const router = useRouter();
  const [waited, setWaited] = useState(0);
  const confirming = returned && !paid && waited < 10;
  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => {
      setWaited((n) => n + 1);
      router.refresh();
    }, 2000);
    return () => clearTimeout(timer);
  }, [confirming, waited, router]);

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
            <dd className="font-mono text-sm text-navy-900 break-all">
              {payment.id}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-navy-600">{t("pay.status")}</dt>
            <dd
              className={`font-semibold ${paid ? "text-green-700" : "text-navy-900"}`}
            >
              {t(
                paid
                  ? "pay.statusPaid"
                  : requested
                    ? "pay.statusRequested"
                    : "pay.statusPending",
              )}
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
              {t(
                provider === "stripe"
                  ? "pay.confirmingTitle"
                  : "pay.requestedTitle",
              )}
            </p>
            {/* The manual-approval bridge, in plain words. */}
            <p className="mt-1.5 text-base leading-7 text-navy-700">
              {provider === "stripe"
                ? t(confirming ? "pay.confirming" : "pay.notSettled")
                : approver
                  ? t("pay.requestedNote", { admin: approver })
                  : t("pay.requestedNoteNoAdmin")}
            </p>
          </div>
        ) : (
          <div className="mt-5">
            {/* Under a provider there is nothing to choose here: Stripe's own
                page offers TWINT, the device's wallet and a card, and a second
                chooser in front of it would only be a guess at the first. */}
            <p className="text-xs font-semibold uppercase tracking-wide text-navy-600">
              {t(
                provider === "stripe" ? "pay.methodsNote" : "pay.chooseMethod",
              )}
            </p>
            <div
              className={`mt-2 grid grid-cols-2 gap-3 ${provider === "stripe" ? "hidden" : ""}`}
            >
              {[
                {
                  id: "twint" as const,
                  label: t("pay.twint"),
                  Icon: Smartphone,
                },
                { id: "card" as const, label: t("pay.card"), Icon: CreditCard },
              ].map(({ id, label, Icon }) => (
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
                  <Icon
                    className="h-[18px] w-[18px] text-navy-600"
                    aria-hidden="true"
                  />
                  {label}
                </button>
              ))}
            </div>

            <BusyButton
              busy={busy}
              type="button"
              onClick={pay}
              className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-full bg-yellow-400 px-5 text-base font-semibold text-yellow-950 transition-colors hover:bg-yellow-300 disabled:cursor-not-allowed disabled:opacity-60"
              busyLabel={t(
                provider === "stripe" ? "pay.redirecting" : "pay.working",
              )}
            >
              {t("pay.payNow", { amount: formatChf(payment.amountRappen) })}
            </BusyButton>
            {failed && (
              <p role="alert" className="mt-3 text-base text-coral-600">
                {t("pay.failed")}
              </p>
            )}
            <p className="mt-3 text-sm leading-6 text-navy-600">
              {t("pay.comeBack")}
            </p>
          </div>
        )}
      </section>
    </>
  );
}

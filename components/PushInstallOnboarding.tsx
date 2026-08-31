"use client";

import { useEffect, useState } from "react";
import { Share, SquarePlus, Smartphone, X } from "lucide-react";
import { useI18n } from "./LocaleProvider";
import { useTrip } from "./TripProvider";
import { needsHomeScreenInstall } from "./PushOptIn";

/** Shown once per browser, ever — not once per trip, not once per visit. */
const SEEN_KEY = "fs.pushInstallSeen";

/**
 * D7 — the install onboarding.
 *
 * iOS requires the page to be added to the Home Screen before push can be
 * requested at all, and non-technical family members have no reason to know
 * that. Without this screen, push adoption among exactly the people it is
 * for — the ones who never got prompted to do anything unusual on their
 * phone before — is close to zero.
 *
 * Deliberately separate from `PushOptIn`'s own small `needs-install` hint,
 * which stays put as a permanent low-key reminder: this is the one-time,
 * dismissible, illustrated moment: it shows itself once — the first time a
 * reader who could use it turns up — and never again after being dismissed.
 * Never on desktop, because `needsHomeScreenInstall` never says yes there.
 */
export default function PushInstallOnboarding() {
  const { t } = useI18n();
  const trip = useTrip();
  const username = trip?.trip.username ?? null;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!username) return;
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem(SEEN_KEY)) return;
    if (!needsHomeScreenInstall()) return;

    let cancelled = false;
    // Push might be off for this journal or this server entirely — the
    // explainer would otherwise promise a feature that doesn't exist.
    fetch(`/api/push/subscribe?user=${encodeURIComponent(username)}`)
      .then((r) => r.json())
      .then((res) => {
        if (!cancelled && res?.enabled) setVisible(true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [username]);

  const dismiss = () => {
    window.localStorage.setItem(SEEN_KEY, "1");
    setVisible(false);
  };

  if (!visible) return null;

  const steps: [typeof Share, string][] = [
    [Share, t("push.install.step1")],
    [SquarePlus, t("push.install.step2")],
    [Smartphone, t("push.install.step3")],
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-navy-900/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={t("push.install.title")}
    >
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-base font-semibold text-navy-900">{t("push.install.title")}</h2>
          <button
            onClick={dismiss}
            aria-label={t("push.install.dismiss")}
            className="-m-1 shrink-0 rounded-full p-1 text-navy-400 transition-colors hover:text-navy-700"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <p className="mt-1.5 text-sm text-navy-500">{t("push.install.body")}</p>
        <ol className="mt-5 space-y-3.5">
          {steps.map(([Icon, label], i) => (
            <li key={i} className="flex items-center gap-3 text-sm text-navy-700">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sky-50 text-navy-600">
                <Icon className="h-4 w-4" aria-hidden />
              </span>
              {label}
            </li>
          ))}
        </ol>
        <button
          onClick={dismiss}
          className="mt-6 w-full rounded-full bg-navy-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-navy-800"
        >
          {t("push.install.dismiss")}
        </button>
      </div>
    </div>
  );
}

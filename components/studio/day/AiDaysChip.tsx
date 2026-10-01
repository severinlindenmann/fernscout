"use client";

import { useState } from "react";
import Link from "next/link";
import { useI18n } from "@/components/LocaleProvider";
import { useNativeShell } from "@/components/nativeShell";
import { journalPath } from "@/lib/journalPath";

export type AiDaysStatus = { unlimited: true } | { unlimited: false; used: number; allowed: number; plan: "free" | "pass" | "plus" };

/**
 * "AI days 7 of 10" — B2591, from the canvas draft "Studio: AI days used up"
 * (board Wall.dc.html). A small pill on a day; once the plan has none left it
 * opens the same upgrade choice inline rather than as a popup, so it works
 * identically at phone and desktop width.
 *
 * Absent entirely when `billing` is off or the plan is unlimited — the same
 * "absent, not broken" rule every optional capability follows.
 */
export type AiDaysUpgradeOffers = {
  passPrice: string;
  passDays: number;
  plusPrice: string;
};

export default function AiDaysChip({
  username,
  status,
  offers,
}: {
  username: string;
  status: AiDaysStatus;
  /** The two plans' own numbers, computed server-side from `PLANS` — never
   *  typed here, so a price change in `paid/billing/lib/plans.ts` cannot
   *  drift from what this sheet says. */
  offers: AiDaysUpgradeOffers;
}) {
  const { t, tn } = useI18n();
  const native = useNativeShell();
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (status.unlimited) return null;
  const atLimit = status.used >= status.allowed;
  const showSheet = open || (atLimit && !dismissed);

  // B2649 — a quiet counter beside the assistant switch, in the same
  // wrapping row; its sheet takes the row's whole width below it.
  return (
    <>
      <button
        type="button"
        aria-expanded={showSheet}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex min-h-11 items-center px-1 text-xs underline-offset-2 hover:underline ${atLimit ? "font-semibold text-coral-600" : "text-ink-secondary"}`}
      >
        {t("studio.day.aiDays.count", { used: String(status.used), allowed: String(status.allowed) })}
      </button>

      {showSheet && (
        <div className="mt-1 flex w-full basis-full flex-col gap-3 rounded-2xl border border-line-strong bg-surface-raised p-5">
          <h3 className="font-display text-lg font-semibold text-ink-strong">
            {atLimit
              ? t("studio.day.aiDays.usedUpTitle", { allowed: String(status.allowed) })
              : t("studio.day.aiDays.chip", { used: String(status.used), allowed: String(status.allowed) })}
          </h3>
          {atLimit && (
            <>
              <p className="text-sm text-ink-body">{t("studio.day.aiDays.usedUpBody")}</p>
              <div className="flex flex-col gap-2 rounded-xl border-2 border-ink-strong p-3.5">
                <div className="flex justify-between font-semibold text-ink-strong">
                  <span>{t("plans.pass")}</span>
                  <span>{offers.passPrice}</span>
                </div>
                <p className="text-sm text-ink-body">
                  {t("studio.day.aiDays.passBody", {
                    days: tn("studio.day.aiDays.days", offers.passDays, { count: String(offers.passDays) }),
                  })}
                </p>
              </div>
              <div className="flex flex-col gap-2 rounded-xl border border-line-quiet p-3.5">
                <div className="flex justify-between font-semibold text-ink-strong">
                  <span>{t("plans.plus")}</span>
                  <span>{offers.plusPrice}</span>
                </div>
                <p className="text-sm text-ink-body">{t("studio.day.aiDays.plusBody")}</p>
              </div>
              {native ? (
                <p className="text-sm text-ink-secondary">{t("studio.day.aiDays.managedOnWeb")}</p>
              ) : (
                <Link
                  href={`${journalPath(username)}/studio/account`}
                  className="flex min-h-12 items-center justify-center rounded-xl bg-navy-900 px-4 font-semibold text-cream-50"
                >
                  {t("studio.day.aiDays.continue")}
                </Link>
              )}
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setDismissed(true);
                }}
                className="min-h-11 text-sm font-semibold text-ink-strong underline underline-offset-2"
              >
                {t("studio.day.aiDays.keepWriting")}
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}

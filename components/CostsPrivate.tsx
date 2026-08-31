"use client";

import PageHeader from "@/components/PageHeader";
import { useI18n } from "@/components/LocaleProvider";

/**
 * What stands in for the costs page when `costsVisibility: guests` is set and
 * the reader is not one.
 *
 * A page rather than a 404: the trip is public and its costs link is part of
 * the furniture, so "there is nothing here" would read as a broken site. It
 * says whose decision it was and stops. Nothing on this route computes a total
 * — see lib/tripView.ts.
 */
export default function CostsPrivate() {
  const { t } = useI18n();
  return (
    <div className="min-h-screen">
      <PageHeader />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-navy-900 sm:text-4xl">
          {t("cost.title")}
        </h1>
        <p className="mt-4 max-w-prose text-base leading-7 text-navy-700">{t("cost.private")}</p>
      </main>
    </div>
  );
}

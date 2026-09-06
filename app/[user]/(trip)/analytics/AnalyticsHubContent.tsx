"use client";

import Link from "next/link";
import { ArrowRight, CloudSun, Wallet } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { useI18n } from "@/components/LocaleProvider";
import { useMoney } from "@/components/CurrencyProvider";

/**
 * The hub — B557.
 *
 * One card per analysis this trip can actually show, and each card carries a
 * figure rather than only a name. A hub that is a list of two links is a menu,
 * and a menu is a page a reader passes through rather than reads; the headline
 * is what makes the trip's own numbers visible one level earlier.
 *
 * A card is here only when the server decided it should be — the capability is
 * on, this trip has the data, and this reader may see it. Nothing is greyed
 * out and nothing says "not available": an optional capability is absent
 * rather than broken, and a disabled card is the broken kind.
 */

export type CostsCard = {
  href: string;
  /** Absent when this reader may not see the trip's spending (`mayViewCosts`). */
  total?: number;
};

export type WeatherCard = {
  href: string;
  measured: number;
  missing: number;
  avgHigh?: number;
};

export default function AnalyticsHubContent({
  costs,
  weather,
}: {
  costs?: CostsCard;
  weather?: WeatherCard;
}) {
  const { t, tn } = useI18n();
  const { money } = useMoney();

  const deg = (n: number) => `${String(Math.round(n)).replace("-", "−")}°C`;

  return (
    <div className="min-h-screen">
      <PageHeader />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-navy-900 sm:text-4xl">
          {t("analytics.title")}
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-navy-600">{t("analytics.subtitle")}</p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {costs && (
            <Card
              href={costs.href}
              Icon={Wallet}
              title={t("cost.title")}
              blurb={t("analytics.costsBlurb")}
              /* No figure for a reader who may not see the spending — the
                 card still leads to the page, which says so itself. */
              headline={costs.total === undefined ? undefined : money(costs.total)}
              open={t("analytics.open")}
            />
          )}
          {weather && (
            <Card
              href={weather.href}
              Icon={CloudSun}
              title={t("weatherPage.title")}
              blurb={t("analytics.weatherBlurb")}
              headline={weather.avgHigh === undefined ? undefined : deg(weather.avgHigh)}
              /* The denominator, on the card. A trip with three readings out
                 of forty days must not present one average as its weather,
                 and the hub is where a reader decides whether to look. */
              note={tn("analytics.measured", weather.measured + weather.missing, {
                measured: String(weather.measured),
                days: String(weather.measured + weather.missing),
              })}
              open={t("analytics.open")}
            />
          )}
        </div>
      </main>
    </div>
  );
}

function Card({
  href,
  Icon,
  title,
  blurb,
  headline,
  note,
  open,
}: {
  href: string;
  Icon: typeof Wallet;
  title: string;
  blurb: string;
  headline?: string;
  note?: string;
  open: string;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col rounded-2xl border border-navy-200 bg-white p-5 shadow-sm transition-colors hover:border-yellow-600/40 sm:p-6"
    >
      <div className="flex items-center gap-2 text-navy-600">
        <Icon className="h-4 w-4" strokeWidth={2.2} aria-hidden />
        <h2 className="font-display text-lg font-semibold text-navy-900">{title}</h2>
      </div>
      {headline && (
        <p className="mt-3 font-display text-3xl font-semibold text-navy-900">{headline}</p>
      )}
      {note && <p className="mt-1 text-xs text-navy-600">{note}</p>}
      <p className="mt-3 flex-1 text-sm text-navy-600">{blurb}</p>
      <span className="mt-4 flex items-center gap-1.5 text-sm font-semibold text-navy-600 group-hover:text-navy-900">
        {open}
        <ArrowRight className="h-3.5 w-3.5" aria-hidden />
      </span>
    </Link>
  );
}

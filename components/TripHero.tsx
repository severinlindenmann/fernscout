"use client";

import Image from "next/image";
import { mediaLoader } from "./mediaLoader";
import { motion } from "motion/react";
import { ArrowDown, LocateFixed, PlayCircle, Sparkles } from "lucide-react";
import MiniMap from "./MiniMap";
import type { Basemap } from "@/lib/basemap";
import PushInstallOnboarding from "./PushInstallOnboarding";
import PushOptIn from "./PushOptIn";
import Travelers from "./Travelers";
import { StackedShareBar, BarList } from "./charts/Charts";
import { useI18n } from "./LocaleProvider";
import { useTrip } from "./TripProvider";
import { flagFor } from "@/lib/flags";
import { useSite } from "@/components/SiteProvider";
import { useMoney } from "./CurrencyProvider";
import { CATEGORY_STYLE, type CostCategory } from "@/lib/costFormat";
import type { TranslationKey } from "@/lib/i18n";
import type { DaySummary } from "@/lib/types";

export type HeroStats = {
  tripDays: number;
  dayCount: number;
  places: number;
  countries: number;
  totalMedia: number;
  firstDate?: string;
  lastDate?: string;
  totalSpend?: number;
  spendPerDay?: number;
  /** Spend split, for the breakdown bar. */
  byCategory?: { category: CostCategory; amount: number }[];
  /** Nights and spend per country. */
  byCountry?: { country: string; countryCode?: string; nights: number; amount: number }[];
};

export default function TripHero({
  stats,
  route,
  current,
  over,
  coverSrc,
  onStart,
  onToday,
  onResume,
  resumeLabel,
  newDayCount = 0,
  onShowNew,
  basemap = null,
}: {
  stats: HeroStats;
  /** Clipped to this trip's frame on the server — see lib/basemap.ts. */
  basemap?: Basemap | null;
  route: { lat: number; lng: number }[];
  /** Where the trip has got to — the pin on the map and the "currently in" /
   * "ended in" line. A summary, not a full day: the hero never shows the day's
   * prose. For a finished trip this is its last day, not "today". */
  current: DaySummary;
  /** Whether the trip is done — see `isOver` in lib/tripTime.ts. Turns off the
   * pulsing dot, which is a claim about right now that stops being true the
   * moment the trip ends. */
  over: boolean;
  coverSrc?: string;
  onStart: () => void;
  onToday: () => void;
  onResume?: () => void;
  resumeLabel?: string;
  /** Days published since this reader was last here. 0 for a first visit. */
  newDayCount?: number;
  onShowNew?: () => void;
}) {
  const { t, tn, formatShortDate, localizedTrip } = useI18n();
  const { money } = useMoney();
  const site = useSite();
  const flag = flagFor(current.country, current.countryCode);

  // The bare URLs are the journal's front door, so the masthead there is the
  // journal. Open one particular trip and the masthead is that trip — the date
  // line underneath already belongs to it, and a journal title above a past
  // trip's dates reads as a mistake. (The hero only renders inside a trip's
  // story, so the context is always there.)
  const active = useTrip()!;
  const localized = localizedTrip(active.trip);
  const heading = active.isCurrent ? site.title : localized.title;
  const subheading = active.isCurrent ? site.tagline : (localized.tagline ?? site.tagline);
  // "Right now we're in" is a claim about the world, and `status` alone is not
  // enough to make it: a trip still marked `current` a fortnight after its end
  // date is exactly the case that goes on claiming a location. `isOver` decides
  // — see lib/tripTime.ts.
  const live = !over;

  const slices = (stats.byCategory ?? []).map((c) => ({
    key: c.category,
    label: t(`cost.cat.${c.category}` as TranslationKey),
    value: c.amount,
    color: CATEGORY_STYLE[c.category].color,
  }));

  return (
    <div className="flex flex-col gap-4">
      {/* Masthead */}
      <section className="overflow-hidden rounded-2xl border border-navy-200 bg-cream-100 shadow-sm">
        <div className="grid gap-0 md:grid-cols-[1.1fr_1fr]">
          <div className="p-6 sm:p-8">
            <h1 className="font-display text-3xl font-semibold leading-tight tracking-tight text-navy-900 sm:text-4xl">
              {heading}
            </h1>
            <p className="mt-1.5 max-w-md text-sm text-navy-600">{subheading}</p>
            {stats.firstDate && stats.lastDate && (
              <p className="mt-0.5 text-xs text-navy-600">
                {formatShortDate(stats.firstDate)} – {formatShortDate(stats.lastDate)}
              </p>
            )}

            {newDayCount > 0 && onShowNew && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: 0.15 }}
                className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-green-500/40 bg-green-100 px-3 py-2"
              >
                <Sparkles className="h-4 w-4 shrink-0 text-green-700" aria-hidden />
                <span className="text-xs text-navy-900">
                  <strong className="font-semibold">{newDayCount}</strong>{" "}
                  {newDayCount === 1 ? t("hero.newSinceOne") : t("hero.newSince")}
                </span>
                <button
                  onClick={onShowNew}
                  className="inline-flex min-h-11 items-center rounded-full bg-green-700 px-3.5 text-sm font-semibold text-white transition-colors hover:bg-navy-900"
                >
                  {t("hero.showNew")}
                </button>
              </motion.div>
            )}

            {live ? (
              <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-navy-200 bg-white px-3 py-1.5">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-yellow-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-yellow-400" />
                </span>
                <span className="text-xs text-navy-600">
                  {t("hero.currentlyIn")}{" "}
                  <strong className="font-semibold text-navy-900">
                    {flag} {current.location}
                  </strong>
                </span>
              </div>
            ) : (
              // No dot, nothing pinging — the whole point is that this is not
              // happening right now. It says so first, then where it ended.
              <div className="mt-4 inline-flex flex-col gap-0.5 rounded-xl border border-navy-200 bg-white px-3 py-2">
                <span className="text-xs font-semibold text-navy-900">{t("hero.over")}</span>
                <span className="text-xs text-navy-600">
                  {t("hero.endedIn")}{" "}
                  <strong className="font-semibold text-navy-900">
                    {flag} {current.location}
                  </strong>{" "}
                  · {formatShortDate(current.date)}
                </span>
              </div>
            )}

            <div className="mt-6 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              {onResume && resumeLabel && (
                <button
                  onClick={onResume}
                  className="col-span-2 inline-flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-navy-900 px-4 text-base font-semibold text-white transition-colors hover:bg-navy-700 sm:col-auto"
                >
                  <PlayCircle className="h-4 w-4" />
                  {resumeLabel}
                </button>
              )}
              <button
                onClick={onToday}
                className="inline-flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-yellow-400 px-4 text-base font-semibold text-yellow-950 transition-colors hover:bg-yellow-300"
              >
                <LocateFixed className="h-4 w-4" />
                {t("hero.jumpToToday")}
              </button>
              <button
                onClick={onStart}
                className="inline-flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-navy-200 bg-white px-4 text-base font-semibold text-navy-700 transition-colors hover:border-navy-500"
              >
                <ArrowDown className="h-4 w-4" />
                {t("hero.startReading")}
              </button>
            </div>

            {/* Renders nothing unless this browser can actually do it. */}
            <PushOptIn />
            {/* Renders nothing unless it's iOS, push is on, and this browser
                hasn't seen it before — see PushInstallOnboarding. */}
            <PushInstallOnboarding />
          </div>

          <div className="relative min-h-[200px] border-t border-navy-200 md:border-l md:border-t-0">
            {coverSrc ? (
              <Image
                src={coverSrc}
                loader={mediaLoader}
                alt={current.location}
                fill
                sizes="(max-width: 768px) 100vw, 40vw"
                className="object-cover"
                priority
              />
            ) : (
              <div className="absolute inset-0 bg-sky-300" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-navy-900/40 to-transparent" />
            <div className="pointer-events-none absolute bottom-2 right-3">
              <Travelers size={54} />
            </div>
          </div>
        </div>
      </section>

      {/* Where we are — the map gets proper room now. */}
      <section className="overflow-hidden rounded-2xl border border-navy-200 bg-sky-300 shadow-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5 }}
        >
          <MiniMap
            route={route}
            current={current}
            basemap={basemap}
            className="block h-auto w-full"
          />
        </motion.div>
      </section>

      {/* Numbers. A <dl> because Stat renders dt/dd — as a plain <section>
          those were orphaned, and each label/value pair was announced as two
          unrelated fragments. */}
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label={tn("map.days", stats.tripDays)} value={String(stats.tripDays)} big />
        <Stat label={tn("map.countries", stats.countries)} value={String(stats.countries)} big />
        <Stat label={tn("map.stops", stats.places)} value={String(stats.places)} big />
        <Stat label={t("map.media")} value={String(stats.totalMedia)} big />
        {stats.totalSpend !== undefined && (
          <Stat label={t("cost.total")} value={money(stats.totalSpend)} />
        )}
        {stats.spendPerDay !== undefined && (
          <Stat label={t("cost.perDay")} value={money(stats.spendPerDay)} />
        )}
      </dl>

      {/* Where the money goes */}
      {slices.length > 0 && (
        <section className="rounded-2xl border border-navy-200 bg-white p-5 shadow-sm sm:p-6">
          <h2 className="mb-3 font-display text-base font-semibold text-navy-900">
            {t("cost.byCategory")}
          </h2>
          <StackedShareBar slices={slices} format={(n) => money(n)} height={22} />
        </section>
      )}

      {/* Time per country */}
      {stats.byCountry && stats.byCountry.length > 0 && (
        <section className="rounded-2xl border border-navy-200 bg-white p-5 shadow-sm sm:p-6">
          <h2 className="mb-3 font-display text-base font-semibold text-navy-900">
            {t("hero.timePerCountry")}
          </h2>
          <BarList
            rows={stats.byCountry.map((c) => ({
              key: c.country,
              label: `${flagFor(c.country, c.countryCode)} ${c.country}`,
              value: c.nights,
              sub: money(c.amount),
            }))}
            format={(n) => `${n} ${n === 1 ? t("stay.night") : t("stay.nights")}`}
            accent={CATEGORY_STYLE.accommodation.color}
          />
        </section>
      )}
    </div>
  );
}

function Stat({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div className="rounded-xl border border-navy-200 bg-white px-4 py-3">
      <dt className="text-[11px] leading-tight text-navy-600">{label}</dt>{" "}
      <dd className={`font-display font-semibold text-navy-900 ${big ? "text-2xl" : "text-lg"}`}>
        {value}
      </dd>
    </div>
  );
}

"use client";

import PageHeader from "@/components/PageHeader";
import WorldMap, { type PlaceView } from "@/components/WorldMap";
import { useState } from "react";
import dynamic from "next/dynamic";
import { Clapperboard } from "lucide-react";
import { useI18n } from "@/components/LocaleProvider";
import { useTrip } from "@/components/TripProvider";
import { flagFor } from "@/lib/flags";
import type { PlannedStop } from "@/lib/types";

// Behind a button — nobody should pay to download the presentation bundle
// (map projection data, motion) until they actually press it.
const SlideShow = dynamic(() => import("@/components/SlideShow"), { ssr: false });

export default function MapPageContent({
  places,
  stats,
  plan = [],
  reachedCount = 0,
}: {
  places: PlaceView[];
  stats: { tripDays: number; places: number; countries: number; totalMedia: number };
  plan?: PlannedStop[];
  reachedCount?: number;
}) {
  const { t, tn, formatShortDate, formatStay } = useI18n();
  // Day permalinks hang off the trip in view — `/example/day/…` for the
  // current trip, `/example/trips/<id>/day/…` for any other.
  const href = useTrip()?.href ?? ((p: string) => p);
  const [showing, setShowing] = useState(false);
  const remaining = plan.filter((s) => !s.reached);
  // Only ever true for the owner — `getPlan` only tags a stop `fromDraft` when
  // it was asked to include drafts, which only the owner's page does.
  const hasDraftStops = plan.some((s) => s.fromDraft);

  return (
    <div className="min-h-screen">
      <PageHeader />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-navy-900 sm:text-4xl">
          {t("map.title")}
        </h1>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-navy-600">{t("map.subtitle")}</p>
          {places.length > 0 && (
            <button
              onClick={() => setShowing(true)}
              className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-navy-900 px-4 text-sm font-semibold text-white transition-colors hover:bg-navy-700"
            >
              <Clapperboard className="h-4 w-4" />
              {t("show.start")}
            </button>
          )}
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label={tn("map.days", stats.tripDays)} value={stats.tripDays} />
          <Stat label={tn("map.stops", stats.places)} value={stats.places} />
          <Stat label={tn("map.countries", stats.countries)} value={stats.countries} />
          <Stat label={t("map.media")} value={stats.totalMedia} />
        </dl>

        <div className="mt-7">
          {places.length > 0 ? (
            <WorldMap places={places} plan={plan} />
          ) : (
            <p className="text-navy-600">{t("story.empty")}</p>
          )}
        </div>

        {plan.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-navy-600">
            <span className="flex items-center gap-1.5">
              <svg width="26" height="6" aria-hidden className="shrink-0">
                <line
                  x1="0"
                  y1="3"
                  x2="26"
                  y2="3"
                  stroke="#5a6a80"
                  strokeWidth="1.6"
                  strokeDasharray="5 4"
                  opacity="0.6"
                />
              </svg>
              {t("map.planned")} — {t("map.plannedHint")}
            </span>
            <span className="font-semibold text-navy-700">
              {reachedCount}/{plan.length} {t("map.progress")}
            </span>
            {hasDraftStops && (
              // Visible to nobody but the owner (see `hasDraftStops`), so this
              // is the one place on the site allowed to say "draft" out loud
              // without it meaning an entry is showing through.
              <span>{t("map.plannedFromDrafts")}</span>
            )}
          </div>
        )}

        {remaining.length > 0 && (
          <section className="mt-10">
            <h2 className="font-display text-xl font-semibold text-navy-900">
              {t("map.stillToCome")}
            </h2>
            <ol className="mt-3 flex flex-wrap gap-2">
              {remaining.map((stop, i) => (
                <li
                  key={`${stop.location}-${i}`}
                  className={`rounded-full border px-3 py-1.5 text-xs ${
                    i === 0
                      ? "border-yellow-600 bg-yellow-400 font-semibold text-yellow-950"
                      : "border-dashed border-navy-200 bg-white text-navy-700"
                  }`}
                  title={stop.note}
                >
                  {i === 0 && <span className="mr-1">{t("map.nextUp")}:</span>}
                  {flagFor(stop.country, stop.countryCode)} {stop.location}
                </li>
              ))}
            </ol>
          </section>
        )}

        <section className="mt-10">
          <h2 className="font-display text-xl font-semibold text-navy-900">{t("map.everyStop")}</h2>
          <ol className="mt-3 divide-y divide-navy-200 overflow-hidden rounded-xl border border-navy-200 bg-white">
            {places.map((place) => (
              <li key={place.key}>
                <a
                  href={href(`/day/${place.entries[0].slug}`)}
                  className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-cream-50"
                >
                  <div className="min-w-0">
                    <div className="truncate font-display text-sm font-semibold text-navy-900">
                      {flagFor(place.country, place.countryCode)} {place.location}
                    </div>
                    <div className="text-xs text-navy-600">{place.country}</div>
                  </div>
                  <div className="shrink-0 text-right text-xs text-navy-600">
                    <div>
                      {formatShortDate(place.firstDate)}
                      {place.lastDate !== place.firstDate &&
                        ` – ${formatShortDate(place.lastDate)}`}
                    </div>
                    <div>
                      {formatStay(place.nights)} · {place.mediaCount} {t("media.count")}
                    </div>
                  </div>
                </a>
              </li>
            ))}
          </ol>
        </section>
      </main>

      {showing && <SlideShow places={places} onClose={() => setShowing(false)} />}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-navy-200 bg-white px-4 py-3">
      <dt className="text-xs text-navy-600">{label}</dt>{" "}
      <dd className="font-display text-2xl font-semibold text-navy-900">{value}</dd>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import PageHeader from "./PageHeader";
import WorldMap from "./WorldMap";
import { useI18n } from "./LocaleProvider";
import { useMoney } from "./CurrencyProvider";
import { flagFor } from "@/lib/flags";
import { daysUntil } from "@/lib/tripTime";
import type { Basemap } from "@/lib/basemap";
import type { PlannedStop, Trip } from "@/lib/types";

export default function TripCountdown({
  trip,
  stops,
  budget,
  basemap = null,
}: {
  trip: Trip;
  stops: PlannedStop[];
  budget?: { total: number; days: number };
  /** Clipped to the planned route's frame on the server — see lib/basemap.ts. */
  basemap?: Basemap | null;
}) {
  const { t, formatLongDate, localizedTrip } = useI18n();
  const { money } = useMoney();
  // This route is statically generated (generateStaticParams, no
  // dynamic/revalidate), so the server HTML is produced once at build time.
  // `new Date()` must never run during that render — it would bake in the
  // build date and then disagree with the client's own `new Date()` on
  // hydration, which is a mismatch on the page's headline number. Instead
  // render nothing for this line until after mount, then fill it in — same
  // pattern LocaleProvider uses for adopting the stored/browser locale.
  //
  // After mount is also the only place `daysUntil` can be honest: it counts in
  // the *reader's* calendar, and the reader's calendar only exists in the
  // reader's browser. See lib/tripTime.ts.
  const [away, setAway] = useState<number | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAway(daysUntil(trip.start));
  }, [trip.start]);
  const countries = Array.from(new Set(stops.map((s) => s.country).filter(Boolean)));
  const { title } = localizedTrip(trip);

  return (
    <div className="min-h-screen">
      <PageHeader />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        {/* min-h reserves the line's height so filling this in after mount
            doesn't shift the layout below it. */}
        <p className="min-h-[1.25rem] font-display text-sm font-semibold uppercase tracking-wide text-navy-600">
          {away !== null &&
            (away === 0
              ? t("trips.today")
              : away === 1
                ? t("trips.oneDayAway")
                : `${away} ${t("trips.daysAway")}`)}
        </p>
        <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight text-navy-900 sm:text-4xl">
          {title}
        </h1>
        <p className="mt-2 text-sm text-navy-600">
          {formatLongDate(trip.start)} — {formatLongDate(trip.end)}
        </p>
        {trip.intro && <p className="mt-4 max-w-2xl text-navy-700">{trip.intro}</p>}

        {countries.length > 0 && (
          <p className="mt-4 flex flex-wrap gap-2 text-sm text-navy-700">
            {countries.map((c) => (
              <span key={c} className="rounded-full bg-cream-100 px-3 py-1">
                {flagFor(c)} {c}
              </span>
            ))}
          </p>
        )}

        {stops.length > 0 && (
          <section className="mt-8">
            <h2 className="font-display text-xl font-semibold text-navy-900">
              {t("trips.plannedRoute")}
            </h2>
            <div className="mt-3">
              {/* No places yet, so the map draws the plan alone. */}
              <WorldMap places={[]} plan={stops} basemap={basemap} />
            </div>
          </section>
        )}

        {budget && (
          <section className="mt-8 rounded-2xl border border-navy-200 bg-white p-5">
            <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-navy-600">
              {t("trips.plannedBudget")}
            </h2>
            <p className="mt-1 font-display text-2xl font-semibold text-navy-900">
              {money(budget.total)}
            </p>
            <p className="text-xs text-navy-600">
              {money(budget.total / budget.days)} / {budget.days}d
            </p>
          </section>
        )}

        <p className="mt-8 text-sm text-navy-600">{t("trips.noEntriesYet")}</p>
      </main>
    </div>
  );
}

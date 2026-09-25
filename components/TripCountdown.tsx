"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import PageHeader from "./PageHeader";
import WorldMap from "./WorldMap";
import { useI18n } from "./LocaleProvider";
import { useMoney } from "./CurrencyProvider";
import { flagFor } from "@/lib/flags";
import { daysUntil } from "@/lib/tripTime";
import { googleMapsHref } from "@/lib/tripMap";
import type { Basemap } from "@/lib/basemap";
import type { PlannedStop, PlanPrivateView, PlanReaders, Trip } from "@/lib/types";

export default function TripCountdown({
  trip,
  stops,
  budget,
  basemap = null,
  readers = "map",
  personPlan = null,
  changePlanHref,
}: {
  trip: Trip;
  stops: PlannedStop[];
  budget?: { total: number; days: number };
  /** Clipped to the planned route's frame on the server — see lib/basemap.ts. */
  basemap?: Basemap | null;
  /** Whether a reader gets the map alone, or the fuller stop-by-stop detail
   * too — `trip.plan.readers` (B2012). Absent on disk reads as `map`. */
  readers?: PlanReaders;
  /**
   * The stay and links behind each stop — never handed to this component
   * for anybody but a `person` reader (the page's job, not this
   * component's: see `lib/plan.ts`'s `getPlanPrivate`).
   */
  personPlan?: PlanPrivateView | null;
  /** Present for the owner only — B2011's planner. */
  changePlanHref?: string;
}) {
  const { t, tn, formatLongDate, localizedTrip } = useI18n();
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
  const showsDetails = readers === "details";

  return (
    <div className="min-h-screen">
      <PageHeader />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        {/* min-h reserves the line's height so filling this in after mount
            doesn't shift the layout below it. */}
        <p className="min-h-[1.25rem] font-display text-sm font-semibold uppercase tracking-wide text-ink-secondary">
          {away !== null &&
            (away === 0
              ? t("trips.today")
              : away === 1
                ? t("trips.oneDayAway")
                : `${away} ${t("trips.daysAway")}`)}
        </p>
        <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight text-ink-strong sm:text-4xl">
          {title}
        </h1>
        <p className="mt-2 text-sm text-ink-secondary">
          {formatLongDate(trip.start)} — {formatLongDate(trip.end)}
          {changePlanHref && (
            <>
              {" · "}
              <Link href={changePlanHref} className="underline hover:no-underline">
                {t("trips.plan.changePlan")}
              </Link>
            </>
          )}
        </p>
        {trip.intro && <p className="mt-4 max-w-2xl text-ink-body">{trip.intro}</p>}

        {countries.length > 0 && (
          <p className="mt-4 flex flex-wrap gap-2 text-sm text-ink-body">
            {countries.map((c) => (
              <span key={c} className="rounded-full bg-surface-subtle px-3 py-1">
                {flagFor(c)} {c}
              </span>
            ))}
          </p>
        )}

        {personPlan && (
          <p className="mt-4 max-w-2xl text-sm text-ink-body">{t("trips.plan.personIntro")}</p>
        )}

        {stops.length > 0 && (
          <section className="mt-8">
            <h2 className="font-display text-xl font-semibold text-ink-strong">
              {t("trips.plannedRoute")}
            </h2>
            <div className="mt-3">
              {/* No places yet, so the map draws the plan alone. */}
              <WorldMap places={[]} plan={stops} basemap={basemap} />
            </div>

            <ol className="mt-4 space-y-4">
              {stops.map((stop, i) => {
                const personal = personPlan?.stops[stop.id ?? ""];
                const range = stop.arrive && stop.leave ? `${formatLongDate(stop.arrive)} – ${formatLongDate(stop.leave)}` : undefined;
                return (
                  <li key={stop.id ?? `${stop.location}-${i}`} className="flex gap-3">
                    <span
                      aria-hidden
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-subtle font-display text-xs font-semibold text-ink-strong"
                    >
                      {i + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="font-semibold text-ink-strong">
                        {flagFor(stop.country, stop.countryCode)} {stop.location}
                      </p>

                      {showsDetails && (range || stop.nights !== undefined) && (
                        <p className="text-sm text-ink-secondary">
                          {range ?? `${stop.nights} ${tn("trips.plan.nights", stop.nights ?? 0)}`}
                        </p>
                      )}
                      {showsDetails && stop.note && <p className="mt-1 text-sm text-ink-body">{stop.note}</p>}
                      {showsDetails && stop.see && stop.see.length > 0 && (
                        <p className="mt-1 text-sm text-ink-body">
                          {t("trips.plan.seeThings")}: {stop.see.map((s) => s.name).join(", ")}
                        </p>
                      )}

                      {personal && (personal.stay || (personal.links && personal.links.length > 0)) && (
                        <div className="mt-1">
                          <p className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
                            {t("trips.plan.peopleOnThisTrip")}
                          </p>
                          {personal.stay && <p className="text-sm text-ink-body">{personal.stay.name}</p>}
                          {personal.links?.map((link) => (
                            <a
                              key={link.url}
                              href={link.url}
                              target="_blank"
                              rel="noreferrer"
                              className="block text-sm text-action-strong underline"
                            >
                              {link.label}
                            </a>
                          ))}
                        </div>
                      )}

                      <a
                        href={googleMapsHref(stop)}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-block text-xs text-action-strong underline"
                      >
                        {t("trips.plan.openInMaps")}
                      </a>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        )}

        {budget && (
          <section className="mt-8 rounded-2xl border border-line-quiet bg-surface-raised p-5">
            <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-ink-secondary">
              {t("trips.plannedBudget")}
            </h2>
            <p className="mt-1 font-display text-2xl font-semibold text-ink-strong">
              {money(budget.total)}
            </p>
            <p className="text-xs text-ink-secondary">
              {money(budget.total / budget.days)} / {budget.days}d
            </p>
          </section>
        )}

        {personPlan && personPlan.links.length > 0 && (
          <section className="mt-8 rounded-2xl border border-line-quiet bg-surface-raised p-5">
            <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-ink-secondary">
              {t("trips.plan.tripLinks")}
            </h2>
            <ul className="mt-2 space-y-1">
              {personPlan.links.map((link) => (
                <li key={link.url}>
                  <a href={link.url} target="_blank" rel="noreferrer" className="text-sm text-action-strong underline">
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="mt-8 text-sm text-ink-secondary">{t("trips.noEntriesYet")}</p>
      </main>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { mediaLoader } from "@/components/mediaLoader";
import AgentHandover from "@/components/AgentHandover";
import PageHeader from "@/components/PageHeader";
import LifetimeMap, { ACCENT_HEX, type TripRoute } from "@/components/LifetimeMap";
import type { Basemap } from "@/lib/basemap";
import { useI18n } from "@/components/LocaleProvider";
import { useSite } from "@/components/SiteProvider";
import type { TranslationKey } from "@/lib/i18n";
import { daysUntil } from "@/lib/tripTime";
import type { TripAccent, TripStatus, TripTranslations } from "@/lib/types";

export type TripCardData = {
  id: string;
  title: string;
  tagline?: string;
  cover?: string;
  accent: TripAccent;
  status: TripStatus;
  start: string; // ISO yyyy-mm-dd
  end: string; // ISO yyyy-mm-dd
  translations?: TripTranslations;
  tripDays: number;
  countries: number;
  totalMedia: number;
};

/**
 * What to say when the journal holds no trips at all.
 *
 * Null when it holds at least one — including when the gate has removed every
 * one of them from *this* reader, which looks identical from here and is not
 * the same thing (B44: there the journal is full and the filter is silent).
 * The server decides, because only the server can see past the gate.
 *
 * A union rather than three nullable fields, so that the owner's address
 * simply is not in the payload of a page a stranger asked for.
 */
export type EmptyJournal =
  | { owner: false }
  | { owner: true; docUrl: string; ownerEmail: string | null };

export type RouteData = {
  id: string;
  title: string;
  accent: TripAccent;
  translations?: TripTranslations;
  points: { lat: number; lng: number; location: string }[];
};

const GROUPS: { status: TripStatus; key: TranslationKey }[] = [
  { status: "current", key: "trips.now" },
  { status: "upcoming", key: "trips.upcoming" },
  { status: "past", key: "trips.past" },
];

export default function TripsIndexContent({
  trips,
  routes,
  lifetime,
  basemap = null,
  empty = null,
}: {
  trips: TripCardData[];
  routes: RouteData[];
  lifetime: { countries: number; days: number; photos: number; trips: number };
  /** Clipped on the server to every route's combined frame — lib/basemap.ts. */
  basemap?: Basemap | null;
  /** Set only when the journal has no trips whatsoever. See `EmptyJournal`. */
  empty?: EmptyJournal | null;
}) {
  const { t, tn, localizedTrip } = useI18n();

  // The map and its legend want each route's title already resolved to the
  // active locale — LifetimeMap itself just renders what it's handed.
  const mapRoutes: TripRoute[] = routes.map((r) => ({
    id: r.id,
    title: localizedTrip(r).title,
    accent: r.accent,
    points: r.points,
  }));

  return (
    <div className="min-h-screen">
      <PageHeader />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-navy-900 sm:text-4xl">
          {t("trips.title")}
        </h1>
        {/*
          An empty journal used to render the subtitle and the four tiles
          anyway: a promise to record everywhere its owner had been, under
          0 · 0 · 0 · 0, with everything that could have said more hidden
          because it had nothing to show. It looked finished and said nothing,
          and it is the first page a new owner sees — `/<user>` redirects here.
          So the totals go, and the page says what is true instead (B76).
        */}
        {empty ? (
          <EmptyState empty={empty} />
        ) : (
          <>
            <p className="mt-1 max-w-2xl text-sm text-navy-600">{t("trips.subtitle")}</p>

            <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {/* `tn`, not `t`: one country is a country. */}
              <Stat
                label={tn("trips.lifetimeCountries", lifetime.countries)}
                value={lifetime.countries}
              />
              <Stat label={tn("trips.lifetimeDays", lifetime.days)} value={lifetime.days} />
              <Stat label={t("trips.lifetimePhotos")} value={lifetime.photos} />
              <Stat label={tn("trips.lifetimeTrips", lifetime.trips)} value={lifetime.trips} />
            </dl>

            {mapRoutes.length > 0 && (
              <div className="mt-7">
                <LifetimeMap routes={mapRoutes} basemap={basemap} />
              </div>
            )}

            {GROUPS.map(({ status, key }) => {
              const group = trips.filter((tr) => tr.status === status);
              if (group.length === 0) return null;
              return (
                <section key={status} className="mt-10">
                  <h2 className="font-display text-xl font-semibold text-navy-900">{t(key)}</h2>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    {group.map((trip) => (
                      <TripCard key={trip.id} trip={trip} />
                    ))}
                  </div>
                </section>
              );
            })}
          </>
        )}
      </main>
    </div>
  );
}

/**
 * A journal with nothing in it, said plainly.
 *
 * Two readers, and they need opposite things. A visitor needs the honest line
 * and nothing to do. The **owner** needs the one fact nobody can guess from
 * looking: there is no button here, there never will be (ROADMAP decision 24),
 * and a trip is made by handing two lines to an agent. That instruction
 * already existed on `/<user>/me`, in a panel a person who has just created a
 * journal has no reason to have opened — so it is repeated here rather than
 * linked to, from the same component, and this is the page they land on.
 */
function EmptyState({ empty }: { empty: EmptyJournal }) {
  const { t } = useI18n();

  return (
    <section className="mt-6 rounded-2xl border border-navy-200 bg-white p-5 sm:p-6">
      <h2 className="font-display text-xl font-semibold text-navy-900">{t("trips.emptyTitle")}</h2>
      <p className="mt-2 max-w-2xl text-lg leading-8 text-navy-700">
        {empty.owner ? t("trips.emptyOwnerBody") : t("trips.emptyBody")}
      </p>
      {empty.owner && (
        <div className="mt-6 border-t border-navy-200 pt-5">
          <AgentHandover docUrl={empty.docUrl} email={empty.ownerEmail} />
        </div>
      )}
    </section>
  );
}

function TripCard({ trip }: { trip: TripCardData }) {
  const { tn, formatLongDate, localizedTrip } = useI18n();
  const { base } = useSite();
  const { title, tagline } = localizedTrip(trip);
  // Every URL carries the owner. The current trip lives at the journal's own
  // base; the rest hang off it. Without the base these pointed at `/trips/<id>`
  // at the root of the instance, which is nobody's trip and answers 404.
  const href = trip.status === "current" ? base : `${base}/trips/${trip.id}`;
  const startYear = trip.start.slice(0, 4);
  const endYear = trip.end.slice(0, 4);

  return (
    <Link
      href={href}
      className="group flex flex-col overflow-hidden rounded-2xl border border-navy-200 bg-white transition-shadow hover:shadow-md"
    >
      {trip.cover && (
        <span className="relative block h-40 w-full shrink-0 overflow-hidden bg-cream-200 sm:h-48">
          <Image
            src={trip.cover}
            loader={mediaLoader}
            alt={title}
            fill
            sizes="(min-width: 640px) 50vw, 100vw"
            className="object-cover transition-transform duration-300 group-hover:scale-105"
          />
        </span>
      )}
      <div className="flex flex-1 flex-col gap-2 p-5">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: ACCENT_HEX[trip.accent] }}
          />
          <h3 className="font-display text-lg font-semibold text-navy-900">{title}</h3>
        </div>
        {tagline && <p className="text-sm text-navy-600">{tagline}</p>}
        <p className="text-xs text-navy-600">
          {formatLongDate(trip.start)} — {formatLongDate(trip.end)}
          {" · "}
          {startYear === endYear ? startYear : `${startYear}–${endYear}`}
        </p>

        {trip.status === "upcoming" ? (
          <CountdownLine start={trip.start} />
        ) : (
          <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-navy-600">
            <CardStat label={tn("map.days", trip.tripDays)} value={trip.tripDays} />
            <CardStat label={tn("map.countries", trip.countries)} value={trip.countries} />
            <CardStat label={tn("map.media", trip.totalMedia)} value={trip.totalMedia} />
          </dl>
        )}
      </div>
    </Link>
  );
}

/** Days-until text for an upcoming trip's card. Rendered after mount only —
 * this page is static, so baking `new Date()` into the server HTML would
 * disagree with the client's own `new Date()` on hydration. Mirrors
 * TripCountdown's own handling of the same problem, and shares its arithmetic
 * rather than repeating it: the two used to hold separate copies of the same
 * calculation, which is how they would have drifted apart. */
function CountdownLine({ start }: { start: string }) {
  const { t } = useI18n();
  const [away, setAway] = useState<number | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAway(daysUntil(start));
  }, [start]);

  return (
    <p className="mt-1 min-h-[1.25rem] text-xs font-semibold text-navy-700">
      {away !== null &&
        (away === 0
          ? t("trips.today")
          : away === 1
            ? t("trips.oneDayAway")
            : `${away} ${t("trips.daysAway")}`)}
    </p>
  );
}

function CardStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dd className="inline font-semibold text-navy-700">{value}</dd>{" "}
      <dt className="inline">{label}</dt>
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

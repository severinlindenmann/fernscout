"use client";

import PageHeader from "@/components/PageHeader";
import WorldMap, { type PlaceView } from "@/components/WorldMap";
import { useState } from "react";
import dynamic from "next/dynamic";
import { Clapperboard } from "lucide-react";
import { useI18n } from "@/components/LocaleProvider";
import { useTrip } from "@/components/TripProvider";
import { flagFor } from "@/lib/flags";
import type { Basemap } from "@/lib/basemap";
import type { PlannedStop } from "@/lib/types";

// Behind a button — nobody should pay to download the presentation bundle
// (map projection data, motion) until they actually press it.
const SlideShow = dynamic(() => import("@/components/SlideShow"), { ssr: false });

export default function MapPageContent({
  places,
  stats,
  plan = [],
  reachedCount = 0,
  basemap = null,
}: {
  places: PlaceView[];
  stats: { tripDays: number; places: number; countries: number; totalMedia: number };
  plan?: PlannedStop[];
  reachedCount?: number;
  /** Clipped on the server to this trip's frame — see lib/basemap.ts. */
  basemap?: Basemap | null;
}) {
  const { t, tn, formatShortDate, formatStay } = useI18n();
  // Day permalinks hang off the trip in view — `/example/day/…` for the
  // current trip, `/example/trips/<id>/day/…` for any other.
  const href = useTrip()?.href ?? ((p: string) => p);
  // Whether the draft stops below are this reader's own to publish — B327.
  const canPublish = useTrip()?.canPublish ?? false;
  const [showing, setShowing] = useState(false);
  const remaining = plan.filter((s) => !s.reached);
  // `getPlan` only tags a stop `fromDraft` when it was asked to include
  // drafts, and since B327 that is the owner *or* somebody on the trip — so
  // this is no longer only ever true for the owner, and the caption below has
  // to say which reader it is talking to.
  const hasDraftStops = plan.some((s) => s.fromDraft);
  // B336: `places` may now itself hold draft-derived markers, for the same
  // reader `hasDraftStops` already covers — the owner, or somebody on the
  // trip. Without this, an owner's own screenshot of the map could be handed
  // to family as a record of the trip while some of its markers are days
  // nobody but that reader can actually open.
  const hasDraftPlaces = places.some((p) => p.entries.some((e) => e.draft));
  // Everything on this page is one of two kinds: a record of travel already
  // made, or the route still intended. An upcoming trip has only the second,
  // and asked as `places.length > 0` in four separate places the first kind
  // rendered anyway — as four zeroes, an empty box, and no map at all.
  const hasPlaces = places.length > 0;

  return (
    <div className="min-h-screen">
      <PageHeader />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Past tense is a claim, and on a trip that has not started it is a
            false one: "Wo wir waren" over eight places nobody has been to yet.
            The subtitle was worse — it invited the reader to tap stops that do
            not exist, because the only markers on the map are planned ones and
            they open nothing. Both follow `hasPlaces`, the same question the
            rest of the page asks (B18), rather than `trip.status`, which this
            component is deliberately never told. */}
        <h1 className="font-display text-3xl font-semibold tracking-tight text-navy-900 sm:text-4xl">
          {t(hasPlaces ? "map.title" : "map.titlePlanned")}
        </h1>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-navy-600">
            {t(hasPlaces ? "map.subtitle" : "map.subtitlePlanned")}
          </p>
          {hasPlaces && (
            <button
              onClick={() => setShowing(true)}
              className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-navy-900 px-4 text-sm font-semibold text-white transition-colors hover:bg-navy-700"
            >
              <Clapperboard className="h-4 w-4" />
              {t("show.start")}
            </button>
          )}
        </div>

        {/* Days on the road, stops, countries, photographs — every one counts
            travel that has happened. A trip that has not started has an honest
            answer for none of them, and four zeroes is not that answer. Nor is
            the plan's own arithmetic: eight planned stops is not eight stops,
            and putting it in this row would say it was. The size of the plan is
            already on this page twice — the `0/8` counter under the map, and
            the list of stops still to come. */}
        {hasPlaces && (
          <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label={tn("map.days", stats.tripDays)} value={stats.tripDays} />
            <Stat label={tn("map.stops", stats.places)} value={stats.places} />
            <Stat label={tn("map.countries", stats.countries)} value={stats.countries} />
            <Stat label={t("map.media")} value={stats.totalMedia} />
          </dl>
        )}
        {hasDraftPlaces && (
          // Visible only to somebody who may see the drafts themselves (see
          // `hasDraftPlaces`) — the same audience, and the same wording shape,
          // as the planned route's own note below.
          <p className="mt-2 text-xs text-navy-600">
            {t(canPublish ? "map.stopsFromDrafts" : "map.stopsFromDraftsShared")}
          </p>
        )}

        {/* A planned route is a map. `WorldMap` has framed one since it was
            written — see the `base` frame in components/WorldMap.tsx, which
            falls back to projecting `plan` when there are no places — and this
            guard, published entries only, was the single thing withholding it.
            An upcoming trip is the one most likely to be shared before there is
            anything else to show, and it was answering "no entries yet"
            directly above a legend for the route it had just refused to draw. */}
        <div className="mt-7">
          {hasPlaces || plan.length > 0 ? (
            <WorldMap places={places} plan={plan} basemap={basemap} />
          ) : (
            // Not `story.empty`. "No entries yet" is true and is not the reason
            // the map is missing; with neither days nor a route there is
            // nothing to draw, and the message should say that instead.
            <p className="text-navy-600">{t("map.empty")}</p>
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
              // Visible only to somebody who may see the drafts themselves
              // (see `hasDraftStops`), so this is the one place on the site
              // allowed to say "draft" out loud without it meaning an entry is
              // showing through.
              <span>
                {t(canPublish ? "map.plannedFromDrafts" : "map.plannedFromDraftsShared")}
              </span>
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

        {/* Withheld rather than drawn empty. A heading reading "Every stop"
            over a blank bordered box says this trip had no stops, when what is
            true is that it has not started — and where it is going is the list
            immediately above. */}
        {hasPlaces && (
          <section className="mt-10">
            <h2 className="font-display text-xl font-semibold text-navy-900">
              {t("map.everyStop")}
            </h2>
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
        )}
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

"use client";

import PageHeader from "@/components/PageHeader";
import WorldMap, { type PlaceView } from "@/components/WorldMap";
import StreetMap from "@/components/map/StreetMap";
import type { Map as MapLibreMap, Marker as MapLibreMarker } from "maplibre-gl";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Clapperboard, MapPin, ArrowUp } from "lucide-react";
import { useI18n } from "@/components/LocaleProvider";
import { useTrip } from "@/components/TripProvider";
import { flagFor } from "@/lib/flags";
import { isPlottable } from "@/lib/mapFrame";
import { googleMapsHref } from "@/lib/tripMap";
import type { Basemap } from "@/lib/basemap";
import { ACCENT_HEX, type PlannedStop } from "@/lib/types";
import { buildTripFrame, type MapPlace, type MapLine, type RecordedSegment } from "@/lib/map/tripFrame";
import { applyStreetOverlay } from "@/lib/map/streetOverlay";
import type { MapDay } from "@/lib/map/mapDays";
import MobileMapSheet from "@/components/map/MobileMapSheet";
import { mediaLoader, posterSrc } from "@/components/mediaLoader";
import { POSTER_WIDTH } from "@/lib/mediaSizes";

// Behind a button — nobody should pay to download the presentation bundle
// (map projection data, motion) until they actually press it.
const SlideShow = dynamic(() => import("@/components/SlideShow"), { ssr: false });

/** `[[minLng, minLat], [maxLng, maxLat]]` for a set of points, padded — the
 * plain-degrees equivalent of `lib/mapFrame.ts`'s `frameRoute` for a caller
 * (the street map's own region switch) that only needs a `fitBounds` box,
 * not a latitude-corrected SVG frame. */
function boundsFor(points: readonly { lat: number; lng: number }[]): [[number, number], [number, number]] {
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const padLat = Math.max((maxLat - minLat) * 0.35, 0.03);
  const padLng = Math.max((maxLng - minLng) * 0.35, 0.03);
  return [
    [minLng - padLng, minLat - padLat],
    [maxLng + padLng, maxLat + padLat],
  ];
}

/**
 * Recorded GPS, attributed to a calendar day — B2537's own carry-through of
 * `TrackSegment.day` (`lib/gps/track.ts`), which `readerTrack` already
 * resolves but which this page used to drop on the way in, flattening every
 * segment to bare points before it ever reached here. Two segments the same
 * day are joined by a short dashed "gap" bridge — a real hole in the
 * recording (a tunnel, a dead phone, the overnight stop) — the same "a break
 * between segments is drawn as a break, never joined" fact `TrackSegment`'s
 * own doc already states, just drawn rather than left invisible.
 *
 * ponytail: no >10 min/>600 m classification (`TrackSegment` carries no
 * timestamps this page reads) — every within-day break becomes a `gap`
 * bridge regardless of size, and a break *between* two different days is
 * never bridged at all (`buildTripFrame`'s own `RecordedSegment` is
 * single-day by construction). Upgrade path: carry `TrackSegment.from`
 * through too and apply the real thresholds once that matters more than "a
 * break exists".
 */
function recordedSegmentsFor(
  trackByDay: readonly { date?: string; points: [number, number][] }[],
  dayNumberByDate: ReadonlyMap<string, number>,
): RecordedSegment[] {
  const byDate = new Map<string, [number, number][][]>();
  for (const seg of trackByDay) {
    if (!seg.date || seg.points.length === 0) continue;
    const list = byDate.get(seg.date) ?? [];
    list.push(seg.points);
    byDate.set(seg.date, list);
  }
  const out: RecordedSegment[] = [];
  for (const [date, segs] of byDate) {
    const day = dayNumberByDate.get(date);
    if (day === undefined) continue;
    segs.forEach((points, i) => {
      if (points.length >= 2) {
        out.push({ day, points: points.map(([lat, lng]) => ({ lat, lng })) });
      }
      const next = segs[i + 1];
      if (next && points.length > 0 && next.length > 0) {
        out.push({
          day,
          points: [points[points.length - 1], next[0]].map(([lat, lng]) => ({ lat, lng })),
          gap: true,
        });
      }
    });
  }
  return out;
}

export default function MapPageContent({
  places,
  days = [],
  stats,
  plan = [],
  trackByDay = [],
  liveTail,
  reachedCount = 0,
  basemap = null,
  over = false,
  hasDays = false,
  streetMap = null,
}: {
  places: PlaceView[];
  /** Every published day this reader may see, in order — B2537, including a
   * day with no place at all (greyed in the day list/strip). Defaults to
   * empty for a test caller that has not been updated. */
  days?: MapDay[];
  /** This trip's own line, where the owner has derived one, one entry per
   * recorded run — see lib/gps/. `date` is the calendar day
   * (`TrackSegment.day`) that run's own local-midnight window belongs to;
   * absent on a legacy file derived before that field existed, in which
   * case the run still draws on `WorldMap`'s SVG path (which never asked for
   * a day) but cannot be attributed to a day here and is left out of the
   * street map / region / legend picture. */
  trackByDay?: { date?: string; points: [number, number][] }[];
  /**
   * Whether *this viewer's own request* may see the live tail, and how long
   * ago it was last derived — B2536. Resolved server-side
   * (`mayReadLiveTrack`, lib/tripGate.ts) from who is asking: the owner
   * always, a named guest of the trip unless its own setting says 24h late,
   * a public reader never. Absent means no dot — the honest default for a
   * reader this was never computed for.
   */
  liveTail?: { minutesAgo: number };
  stats: { tripDays: number; places: number; countries: number; totalMedia: number };
  plan?: PlannedStop[];
  reachedCount?: number;
  /** Clipped on the server to this trip's frame — see lib/basemap.ts. */
  basemap?: Basemap | null;
  /** Whether the trip itself is finished (`isOver`, lib/tripTime.ts) — B1289.
   * Defaults to false, so a page that forgets to pass it keeps the older,
   * narrower claim rather than calling an unfinished trip done. */
  over?: boolean;
  /** Whether a day is written at all, distinct from whether any carries
   * coordinates — B1289. Defaults to false, so a caller that forgets it gets
   * the more conservative "no days written" rather than a false negative. */
  hasDays?: boolean;
  /**
   * `features.streetMaps` resolved server-side, and a region file that
   * actually covers this trip (`lib/maps/dir.ts`'s `tripMapRegions`) — B2535.
   * `null` (the default) is the ordinary case: the capability off, or no
   * extract for this trip yet, and this page keeps drawing `WorldMap`
   * exactly as it always has. Only the trip's primary (largest) region has a
   * file today, so the street map itself only ever renders that region's own
   * tiles even when a reader switches the frame to another one — the markers
   * and bounds still move, the tiles underneath do not.
   */
  streetMap?: { url: string; bounds: [[number, number], [number, number]] } | null;
}) {
  const { t, tn, locale, formatShortDate } = useI18n();
  // Day permalinks hang off the trip in view — `/example/day/…` for the
  // current trip, `/example/trips/<id>/day/…` for any other.
  const trip = useTrip()?.trip;
  const href = useTrip()?.href ?? ((p: string) => p);
  // The trip's own colour on its own route (B2422) — undeclared reads as
  // no-preference (`tripAccent`, lib/trips.ts), so this map falls back to
  // navy the same way `WorldMap` itself does for a caller with no trip.
  const accent = trip?.accent ?? "navy";
  // The one yellow marker on this map, gated on the trip's own declared
  // status — "current" is an editorial choice, not a date guess
  // (`effectiveStatus`, lib/tripTime.ts), and this page already reads it
  // to decide the tense above.
  const live = trip?.status === "current";
  // Whether the draft stops below are this reader's own to publish — B327.
  const canPublish = useTrip()?.canPublish ?? false;
  const [showing, setShowing] = useState(false);
  const [startDate, setStartDate] = useState<string | undefined>(undefined);
  const remaining = plan.filter((s) => !s.reached);
  const hasDraftStops = plan.some((s) => s.fromDraft);
  const hasDraftPlaces = places.some((p) => p.entries.some((e) => e.draft));
  const hasPlaces = places.length > 0;
  // `WorldMap`'s own flattened shape — it never asked for a day, only points.
  const track = useMemo(() => trackByDay.map((s) => s.points), [trackByDay]);

  // The trip's own calendar-day number for every place — B2534/B2537. A
  // place's own `key` is `${location}-${firstDate}` (`getPlaces`,
  // lib/entries.ts), so its day number is whichever calendar day `firstDate`
  // itself is; `days` (from `getMapDays`) is that count over *every*
  // published day, not only the ones with a place, so an earlier placeless
  // day still bumps the number the way "day 3" on the calendar means.
  const dayNumberByDate = useMemo(() => {
    // `days` is every published day, including a placeless one, so this is
    // the honest count. A caller with no `days` at all (a test harness that
    // predates B2537, or a page that has not been updated) falls back to
    // numbering `places` in the order they arrived — the same thing
    // `WorldMap`'s own `orderByKey` already did before this ticket.
    if (days.length > 0) return new Map(days.map((d, i) => [d.date, i + 1] as const));
    return new Map(places.map((p, i) => [p.firstDate, i + 1] as const));
  }, [days, places]);
  const dateByDayNumber = useMemo(
    () => new Map(Array.from(dayNumberByDate, ([date, n]) => [n, date] as const)),
    [dayNumberByDate],
  );
  const dayNumbers = useMemo(
    () => new Map(places.map((p) => [p.key, dayNumberByDate.get(p.firstDate) ?? 1] as const)),
    [places, dayNumberByDate],
  );

  // The rules every map follows (B2534) — regions, chips, which lines to
  // draw, fed real recorded segments now that `trackByDay` carries a day for
  // each run: a trip with a track draws `recorded`/`gap` lines; one without
  // falls back to `photo-join` lines between places in order, exactly as
  // `buildTripFrame` already chooses on its own.
  const mapPlaces: MapPlace[] = useMemo(
    () =>
      places.map((p) => ({
        day: dayNumberByDate.get(p.firstDate) ?? 1,
        date: p.firstDate,
        lat: p.lat,
        lng: p.lng,
        name: p.location,
      })),
    [places, dayNumberByDate],
  );
  const recordedSegments = useMemo(
    () => recordedSegmentsFor(trackByDay, dayNumberByDate),
    [trackByDay, dayNumberByDate],
  );
  const frame = useMemo(
    () => buildTripFrame(mapPlaces, recordedSegments),
    [mapPlaces, recordedSegments],
  );

  // Which region the map is currently framed on — the main one until a
  // reader taps another region's chip. Seeded once from `frame` at mount;
  // Next.js gives every trip's map page its own fresh mount (a route change
  // is a new component instance, not a prop update on this one), so there is
  // no later point where `frame` changes under an already-mounted page for
  // this to resync against.
  const [regionIndex, setRegionIndex] = useState(frame.mainRegionIndex);

  const regionDayNumbers = useMemo(
    () => new Set((frame.isTour ? frame.framePlaces : frame.regions[regionIndex]?.places ?? []).map((p) => p.day)),
    [frame, regionIndex],
  );
  // A tour shows every place at once (docs/plans/2026-09-28-trip-maps —
  // "more than three regions ⇒ a tour, shown whole"); otherwise the map
  // frames on whichever region is selected.
  const regionPlaces = useMemo(
    () =>
      frame.isTour
        ? places
        : places.filter((p) => regionDayNumbers.has(dayNumberByDate.get(p.firstDate) ?? 1)),
    [frame.isTour, places, regionDayNumbers, dayNumberByDate],
  );
  const onMainRegion = frame.isTour || regionIndex === frame.mainRegionIndex;
  // The server only ever clipped a basemap around the main region (see
  // `basemapForRoute(framePoints(places))` in the page above this
  // component) — switched onto another region, that bundle would draw the
  // wrong coastline, so `WorldMap` falls back to its own whole-world
  // coastline instead, same as a trip with no basemap at all.
  const regionBasemap = onMainRegion ? basemap : null;

  const plottableInRegion = useMemo(() => regionPlaces.filter(isPlottable), [regionPlaces]);

  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [sheetInset, setSheetInset] = useState(0);

  // Selects a day and carries it in the URL as `?day=<date>` (B2537 — was
  // `?stop=<key>` before this ticket, since the page now navigates by
  // calendar day rather than by merged-stay place; `?stop=` on an old link
  // simply finds nothing below, same as any other unknown key always did).
  // `history.replaceState`, so picking through a trip never grows the back
  // stack or jumps the scroll position `pushState`/a hash link would.
  const selectDay = useCallback((date: string | null) => {
    setSelectedDate(date);
    const params = new URLSearchParams(window.location.search);
    if (date) params.set("day", date);
    else params.delete("day");
    const query = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
    );
  }, []);

  const toggleDay = useCallback((date: string | null) => {
    selectDay(date === selectedDate ? null : date);
  }, [selectDay, selectedDate]);

  const [dayParam] = useState<string | null>(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("day"),
  );

  useEffect(() => {
    if (!dayParam) return;
    // Matched against `places` — the same reader-filtered array the map
    // itself draws from — rather than `days`, so a link naming a day this
    // reader may not see (a draft, a hidden day) finds nothing here either.
    if (places.some((p) => dayParam >= p.firstDate && dayParam <= p.lastDate)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedDate(dayParam);
    }
  }, [places, dayParam]);

  // The place the selected day maps onto, for `WorldMap`/`StreetMap` — a
  // place spans `firstDate`…`lastDate` (a merged multi-night stay), so any
  // date inside that span is "this place" as far as the map's own selection
  // goes.
  const selectedPlace = useMemo(
    () =>
      places.find(
        (p) => selectedDate !== null && selectedDate >= p.firstDate && selectedDate <= p.lastDate,
      ) ?? null,
    [places, selectedDate],
  );
  const selectedDayNumber = selectedPlace ? (dayNumberByDate.get(selectedPlace.firstDate) ?? null) : null;

  const pastTense = over && hasDays;
  // WorldMap draws from the last reached stop onward, and needs two
  // stops for a leg. StreetMap currently draws no planned legs.
  const lastReached = plan.findLastIndex((stop) => stop.reached);
  const showPlannedLegend = !over && !streetMap && plan.length - Math.max(0, lastReached) > 1;

  useEffect(() => {
    if (!hasPlaces) return;
    const show = new URLSearchParams(window.location.search).get("show");
    if (!show) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStartDate(/^\d{4}-\d{2}-\d{2}$/.test(show) && !Number.isNaN(Date.parse(show)) ? show : undefined);
    setShowing(true);
  }, [hasPlaces]);

  const closeSlideshow = () => {
    setShowing(false);
    const params = new URLSearchParams(window.location.search);
    if (!params.has("show")) return;
    params.delete("show");
    const query = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
    );
  };

  // Which line kinds are actually drawn on the *street map* right now —
  // "Legend shows only what is drawn." Only the street map draws tripFrame's
  // own line vocabulary (recorded/gap/photo-join/flight); `WorldMap`'s SVG
  // path keeps its existing accent hop-lines with transport-mode chips
  // (see the ceiling noted on `recordedSegmentsFor`'s own doc), which this
  // legend would misdescribe, so it is street-map only. Flights are
  // overview-only and only ever shown when nothing is selected.
  const linesShown = useMemo(() => {
    const inRegion = frame.isTour
      ? frame.lines
      : frame.lines.filter((l) => regionDayNumbers.has(l.fromDay) || regionDayNumbers.has(l.toDay));
    if (selectedDayNumber === null) return inRegion;
    return inRegion.filter(
      (l) => l.kind !== "flight" && (l.fromDay === selectedDayNumber || l.toDay === selectedDayNumber),
    );
  }, [frame.isTour, frame.lines, regionDayNumbers, selectedDayNumber]);
  const lineKindsShown = useMemo(() => new Set(linesShown.map((l: MapLine) => l.kind)), [linesShown]);

  const regionChips = onMainRegion ? frame.chips : [];

  // The street map itself — a live `maplibregl.Map`, drawn onto imperatively
  // by `applyStreetOverlay` rather than through JSX. `onReady` only fires
  // once, at creation; every later change (a day selected, a region
  // switched) re-runs the effect below against the same stored instance.
  const streetMapRef = useRef<MapLibreMap | null>(null);
  const streetMarkersRef = useRef<Map<number, MapLibreMarker>>(new Map());
  const [streetMapReady, setStreetMapReady] = useState(false);
  const onStreetMapReady = useCallback((map: MapLibreMap) => {
    streetMapRef.current = map;
    setStreetMapReady(true);
  }, []);
  useEffect(() => {
    const map = streetMapRef.current;
    if (!map || !streetMapReady) return;
    const redraw = applyStreetOverlay(
      map,
      {
        frame,
        regionDayNumbers,
        selectedDay: selectedDayNumber,
        accentHex: ACCENT_HEX[accent],
        onSelectDay: (day) => {
          const date = dateByDayNumber.get(day);
          if (date) toggleDay(date);
        },
        // Keeps a fitted day clear of the header above and the phone
        // sheet's own peek height below — `sheetInset` is 0 on desktop and
        // wherever nothing covers the map, same value `WorldMap` already
        // frames around.
        // The bottom also clears the legend row and the town label drawn
        // under each marker, or the southernmost day sits under them.
        padding: { top: 80, bottom: sheetInset + 96, left: 56, right: 56 },
      },
      streetMarkersRef.current,
    );
    map.on("zoom", redraw);
    return () => {
      map.off("zoom", redraw);
    };
  }, [streetMapReady, frame, regionDayNumbers, selectedDayNumber, accent, dateByDayNumber, toggleDay, sheetInset]);

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden lg:h-screen">
      <div className="shrink-0">
        <PageHeader />
      </div>

      {/* The info/chip row — region switch, far legs, and the live-tail
          status (B2536), in one row right under the header. Visible at
          every width: on a phone this *is* "a small header chip row" over
          the full-bleed map below; on desktop it sits atop the day list. */}
      {(regionChips.length > 0 || liveTail) && hasPlaces && (
        <div
          role="list"
          aria-label={t("map.regions")}
          className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line-quiet bg-surface-subtle px-3 py-2"
        >
          {liveTail && (
            <span className="flex items-center gap-1.5 rounded-full bg-yellow-400 px-2.5 py-1 text-xs font-semibold text-yellow-950">
              <span className="h-2 w-2 rounded-full bg-yellow-950/70" aria-hidden />
              {tn("map.liveUpdatedAgo", liveTail.minutesAgo, { count: String(liveTail.minutesAgo) })}
            </span>
          )}
          {regionChips.map((chip, i) => {
            const targetRegionIndex = frame.regions.findIndex((r) =>
              r.places.some((p) => p.day === chip.place.day),
            );
            const clickable = chip.kind === "region" && targetRegionIndex >= 0;
            return (
              <button
                key={`${chip.kind}-${chip.place.day}-${i}`}
                type="button"
                role="listitem"
                disabled={!clickable}
                onClick={clickable ? () => setRegionIndex(targetRegionIndex) : undefined}
                className="flex items-center gap-1 rounded-full border border-line-quiet bg-surface-raised px-2.5 py-1 text-xs font-semibold text-ink-body disabled:cursor-default"
              >
                <ArrowUp
                  className="h-3 w-3 shrink-0"
                  style={{ transform: `rotate(${chip.bearingDeg}deg)` }}
                  aria-hidden
                />
                {chip.label}
                {chip.days ? ` · ${chip.days} ${tn("map.days", chip.days)}` : ""}
              </button>
            );
          })}
        </div>
      )}

      <main
        id="main"
        className="grid min-h-0 flex-1 grid-cols-1 grid-rows-1 overflow-hidden lg:grid-cols-[340px_1fr]"
      >
        {/* The day list — desktop only below `lg` (the phone sheet is its
            own equivalent). A compact title line replaces the old big page
            heading and stat-tile grid: "the map is the page", not a page
            with a map at the bottom of it. */}
        <section
          aria-label={days.length > 0 ? t("map.everyDay") : undefined}
          className="hidden min-h-0 flex-col overflow-y-auto border-r border-line-quiet bg-surface-subtle lg:flex"
        >
          <div className="shrink-0 border-b border-line-quiet px-4 py-3">
            <h1 className="font-display text-base font-semibold text-ink-strong">
              {t(pastTense ? "map.title" : "map.titlePlanned")}
            </h1>
            {hasPlaces && (
              <p className="mt-0.5 text-xs text-ink-secondary">
                {tn("map.days", stats.tripDays)} {stats.tripDays} · {tn("map.stops", stats.places)}{" "}
                {stats.places} · {t("map.media")} {stats.totalMedia}
              </p>
            )}
            {hasDraftPlaces && (
              <p className="mt-1 text-xs text-ink-secondary">
                {t(canPublish ? "map.stopsFromDrafts" : "map.stopsFromDraftsShared")}
              </p>
            )}
            {hasPlaces && (
              <button
                onClick={() => {
                  setStartDate(undefined);
                  setShowing(true);
                }}
                className="mt-2 flex min-h-8 items-center gap-1.5 rounded-full border border-line-quiet bg-surface-raised px-3 text-xs font-semibold text-ink-body transition-colors hover:border-line-prominent"
              >
                <Clapperboard className="h-3.5 w-3.5" />
                {t("show.start")}
              </button>
            )}
          </div>

          {days.length > 0 && (
            <ol className="divide-y divide-line-quiet">
              {days.map((day, i) => {
                const place = places.find((p) => day.date >= p.firstDate && day.date <= p.lastDate);
                const isSelected = day.date === selectedDate;
                return (
                  <li key={day.date}>
                    {day.hasPlace ? (
                      <button
                        type="button"
                        onClick={() => toggleDay(day.date)}
                        aria-expanded={isSelected}
                        className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-base${
                          isSelected ? " bg-surface-selected" : ""
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="truncate font-display text-sm font-semibold text-ink-strong">
                            {i + 1}. {flagFor(day.country, day.countryCode)} {day.location}
                          </div>
                          <div className="text-xs text-ink-secondary">{formatShortDate(day.date)}</div>
                        </div>
                        <div className="shrink-0 text-right text-xs text-ink-secondary">
                          {day.mediaCount} {t("media.count")}
                        </div>
                      </button>
                    ) : (
                      <div
                        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-ink-secondary"
                        aria-disabled
                      >
                        <div className="min-w-0">
                          <div className="truncate font-display text-sm font-semibold">
                            {i + 1}. {t("map.noPlaceGiven")}
                          </div>
                          <div className="text-xs">{formatShortDate(day.date)}</div>
                        </div>
                        <a
                          href={href(`/day/${day.slug}`)}
                          className="shrink-0 text-xs font-semibold underline decoration-line-quiet underline-offset-2"
                        >
                          {t("map.readDay")}
                        </a>
                      </div>
                    )}

                    {isSelected && place && (
                      <div className="flex flex-col gap-2 px-4 pb-4">
                        {(place.entries[0]?.headline?.[locale] ??
                          Object.values(place.entries[0]?.headline ?? {})[0]) && (
                          <p className="text-sm text-ink-body">
                            {place.entries[0].headline[locale] ??
                              Object.values(place.entries[0].headline)[0]}
                          </p>
                        )}
                        {place.entries.flatMap((e) => e.gallery ?? []).length > 0 && (
                          <div className="flex gap-1.5 overflow-x-auto">
                            {place.entries
                              .flatMap((e) => e.gallery ?? [])
                              .slice(0, 8)
                              .map((m) => (
                                <span
                                  key={m.src}
                                  className="relative block h-16 w-16 shrink-0 overflow-hidden rounded-md border border-line-quiet bg-surface-muted"
                                >
                                  {m.type === "video" ? (
                                    <video
                                      src={m.src}
                                      poster={posterSrc(m.poster, POSTER_WIDTH.GRID)}
                                      preload={m.poster ? "none" : "metadata"}
                                      className="h-full w-full object-cover"
                                      muted
                                    />
                                  ) : (
                                    <Image
                                      src={m.src}
                                      loader={mediaLoader}
                                      alt={m.alt ?? m.caption ?? place.location}
                                      fill
                                      sizes="64px"
                                      className="object-cover"
                                    />
                                  )}
                                </span>
                              ))}
                          </div>
                        )}
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm font-semibold">
                          <a
                            href={href(`/day/${place.entries[0].slug}`)}
                            className="text-ink-strong underline decoration-blue-500 decoration-2 underline-offset-2 hover:decoration-coral-600"
                          >
                            {t("map.readDay")} →
                          </a>
                          <a
                            href={googleMapsHref(place)}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-ink-secondary underline decoration-line-quiet underline-offset-2"
                          >
                            <MapPin className="h-3.5 w-3.5" aria-hidden />
                            {t("tripMap.googleMaps")}
                          </a>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          )}

          {(showPlannedLegend || (!over && remaining.length > 0)) && (
            <div className="mt-2 flex flex-col gap-3 border-t border-line-quiet px-4 py-3">
              {showPlannedLegend && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-ink-secondary">
                  <span className="flex items-center gap-1.5">
                    <svg width="20" height="6" aria-hidden className="shrink-0">
                      <line
                        x1="0"
                        y1="3"
                        x2="20"
                        y2="3"
                        stroke="#5a6a80"
                        strokeWidth="1.6"
                        strokeDasharray="5 4"
                        opacity="0.6"
                      />
                    </svg>
                    {t("map.planned")}
                  </span>
                  <span className="font-semibold text-ink-body">
                    {reachedCount}/{plan.length} {t("map.progress")}
                  </span>
                  {hasDraftStops && (
                    <span>{t(canPublish ? "map.plannedFromDrafts" : "map.plannedFromDraftsShared")}</span>
                  )}
                </div>
              )}
              {!over && remaining.length > 0 && (
                <div>
                  <h2 className="font-display text-sm font-semibold text-ink-strong">{t("map.stillToCome")}</h2>
                  <ol className="mt-2 flex flex-wrap gap-1.5">
                    {remaining.map((stop, i) => (
                      <li
                        key={`${stop.location}-${i}`}
                        className={`rounded-full border px-2.5 py-1 text-xs ${
                          i === 0
                            ? "border-yellow-600 bg-yellow-400 font-semibold text-yellow-950"
                            : "border-dashed border-line-quiet bg-surface-raised text-ink-body"
                        }`}
                        title={stop.note}
                      >
                        {i === 0 && <span className="mr-1">{t("map.nextUp")}:</span>}
                        {flagFor(stop.country, stop.countryCode)} {stop.location}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          )}
        </section>

        {/* The map — full-bleed under the info row, on every width. */}
        <div className="relative h-full min-h-0">
          {streetMap ? (
            <StreetMap
              // The places where days happened, not the region file's own padded
              // box — that box is 15 km wider and lets a day sit on the edge.
              bounds={plottableInRegion.length > 0 ? boundsFor(plottableInRegion) : streetMap.bounds}
              // Clear of the header chips above and the legend (and, on a
              // phone, the day sheet) below.
              padding={{ top: 70, bottom: sheetInset + 56, left: 40, right: 40 }}
              pmtilesUrl={streetMap.url}
              onReady={onStreetMapReady}
              className="h-full w-full"
            />
          ) : hasPlaces || plan.length > 0 || track.length > 0 ? (
            <WorldMap
              places={regionPlaces}
              plan={plan}
              track={track}
              basemap={regionBasemap}
              pastTense={pastTense}
              accent={accent}
              live={live}
              selectedKey={selectedPlace?.key ?? null}
              onSelect={(p) => selectDay(p ? p.firstDate : null)}
              fillHeight
              bottomInset={sheetInset}
              showStopCard={false}
              showTimeScrubber={false}
              dayNumbers={dayNumbers}
            />
          ) : (
            <p className="flex h-full items-center justify-center p-6 text-center text-ink-secondary">
              {t(hasDays ? "map.emptyNoPlace" : "map.empty")}
            </p>
          )}

          {/* "Legend shows only what is drawn" — the street map's own line
              vocabulary only; see `linesShown`'s own doc for why. */}
          {streetMap && hasPlaces && lineKindsShown.size > 0 && (
            <div className="absolute inset-x-3 bottom-[130px] z-10 flex flex-wrap gap-x-3 gap-y-1 rounded-full bg-surface-raised/90 px-3 py-1.5 text-xs text-ink-secondary shadow-sm backdrop-blur lg:bottom-3">
              {lineKindsShown.has("recorded") && <span>— {t("map.legend.recorded")}</span>}
              {lineKindsShown.has("gap") && <span>┄ {t("map.legend.gap")}</span>}
              {lineKindsShown.has("photo-join") && <span>┄ {t("map.legend.photoJoin")}</span>}
              {lineKindsShown.has("flight") && <span>⋯ {t("map.legend.flight")}</span>}
            </div>
          )}
        </div>
      </main>

      {showing && (
        <SlideShow
          places={places}
          onClose={closeSlideshow}
          stats={stats}
          startDate={startDate}
          basemap={basemap}
        />
      )}

      <MobileMapSheet
        days={days}
        places={places}
        selectedDate={selectedDate}
        onSelectDate={toggleDay}
        onInsetChange={setSheetInset}
        hrefForDay={(slug) => href(`/day/${slug}`)}
      />
    </div>
  );
}

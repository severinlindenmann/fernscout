"use client";

import PageHeader from "@/components/PageHeader";
import Lightbox from "@/components/Lightbox";
import FullPhoto from "@/components/FullPhoto";
import type { PhotoPin } from "@/lib/map/photoPins";
import WorldMap, { type PlaceView } from "@/components/WorldMap";
import StreetMap from "@/components/map/StreetMap";
import type { Map as MapLibreMap, Marker as MapLibreMarker } from "maplibre-gl";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Clapperboard, Globe, MapPin, ArrowUp, BookOpen, Layers, X } from "lucide-react";
import { useI18n } from "@/components/LocaleProvider";
import { useTrip } from "@/components/TripProvider";
import { flagFor } from "@/lib/flags";
import { isPlottable } from "@/lib/mapFrame";
import { googleMapsHref } from "@/lib/tripMap";
import type { Basemap } from "@/lib/basemap";
import { ACCENT_HEX, type PlannedStop } from "@/lib/types";
import { buildTripFrame, linesForRegion, type MapPlace } from "@/lib/map/tripFrame";
import { recordedSegmentsFor, type DayTrack } from "@/lib/map/recordedSegments";
import { pinsInRegion, placeDayByDate } from "@/lib/map/mapSafety";
import { applyStreetOverlay } from "@/lib/map/streetOverlay";
import { boundsFor } from "@/lib/map/tripStill";
import { legModeFromEntry, legendModes, withDeclaredLegs, type LegPattern } from "@/lib/map/legMode";
import type { TransportMode } from "@/lib/types";
import type { MapDay } from "@/lib/map/mapDays";
import MobileMapSheet, { READ_DAY_BUTTON } from "@/components/map/MobileMapSheet";
import DayReader from "@/components/map/DayReader";
import { adjacentDate, escapeDeselects, withDayParam, zoomControlsVisible } from "@/lib/map/dayTransition";
import { kmByDate as kmByDateOf } from "@/lib/map/dayFacts";
import MapControls from "@/components/map/MapControls";
import { useWeatherText } from "@/components/map/DayFacts";
import { usePrefetchDays } from "@/components/map/usePreload";
import { useReducedMotion } from "motion/react";
import { mediaLoader, posterSrc } from "@/components/mediaLoader";
import { POSTER_WIDTH } from "@/lib/mediaSizes";

// Behind a button — nobody should pay to download the presentation bundle
// (map projection data, motion) until they actually press it.
const SlideShow = dynamic(() => import("@/components/SlideShow"), { ssr: false });

/** `[[minLng, minLat], [maxLng, maxLat]]` for a set of points, padded — the
 * plain-degrees equivalent of `lib/mapFrame.ts`'s `frameRoute` for a caller
 * (the street map's own region switch) that only needs a `fitBounds` box,
 * not a latitude-corrected SVG frame. */
/** A short sample of a leg's line, drawn the way the map draws it. */
function LineSwatch({ pattern }: { pattern: LegPattern }) {
  const dash = { solid: undefined, hatch: undefined, dotted: "0.1 5", dash: "10 5", dashed: "3 4" }[pattern];
  const colour = pattern === "dashed" ? "var(--map-leg-water)" : "var(--map-route-line)";
  return (
    <svg width="32" height="12" viewBox="0 0 32 12" aria-hidden className="shrink-0">
      <line x1="2" x2="30" y1="6" y2="6" style={{ stroke: "var(--map-route-edge)" }} strokeWidth="7" strokeLinecap="round" />
      <line x1="2" x2="30" y1="6" y2="6" style={{ stroke: colour }} strokeWidth="4" strokeLinecap={pattern === "dash" || pattern === "dashed" ? "butt" : "round"} strokeDasharray={dash} />
      {pattern === "hatch" && <line x1="2" x2="30" y1="6" y2="6" style={{ stroke: "var(--map-route-edge)" }} strokeWidth="9" strokeDasharray="1 6" />}
    </svg>
  );
}

/** A region file as the server hands it over (`StreetMapFile`, lib/maps/dir.ts). */
type StreetFile = {
  url: string;
  bounds: [[number, number], [number, number]];
  maxZoom?: number;
  /** The z0–6 world file standing in for a trip with no extract of its own. */
  world?: true;
};

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
  streetMapRegions = null,
  pins: allPins = [],
  unwritten,
  owner = false,
  tripCost,
}: {
  /** B-2980 — the trip's total spend in the base currency; present only for a viewer who may see costs. */
  tripCost?: number;
  /** B-2980 — the owner's own request: only they are told a trip lacks a map extract. */
  owner?: boolean;
  /** B-2980 — photographs at their own measured position (SVG map only). */
  pins?: PhotoPin[];
  /** B-2980 — owner only: recorded days that have no day yet, and their lines. */
  unwritten?: { dates: string[]; lines: [number, number][][] };
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
  trackByDay?: DayTrack[];
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
  streetMap?: StreetFile | null;
  /**
   * Every region file this trip has (`streetMapRegionFiles`, lib/maps/dir.ts)
   * — B2560. A region switch (`regionIndex` below) picks whichever of these
   * covers the most of that region's own places, rather than always
   * redrawing `streetMap`'s own main-region tiles under a moved frame.
   * `null`/absent when the capability is off or nothing's been extracted;
   * the map then keeps showing only `streetMap`'s single file, same as
   * before this ticket.
   */
  streetMapRegions?: StreetFile[] | null;
}) {
  const { t, tn, locale, formatShortDate } = useI18n();
  // Day permalinks hang off the trip in view — `/example/day/…` for the
  // current trip, `/example/trips/<id>/day/…` for any other.
  const trip = useTrip()?.trip;
  const href = useTrip()?.href ?? ((p: string) => p);
  const userHref = useTrip()?.userHref ?? ((p: string) => p);
  const tripId = trip?.id ?? "";
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
  // B-2980: no place to frame on, but a recorded route — frame on the route.
  const routePoints = useMemo(
    () => (places.length === 0 ? [...track, ...(unwritten?.lines ?? [])].flat().map(([lat, lng]) => ({ lat, lng })).concat(allPins) : []),
    [places.length, track, unwritten, allPins],
  );
  const [openPins, setOpenPins] = useState<PhotoPin[] | null>(null);
  const [pinIndex, setPinIndex] = useState(0);
  const openPin = openPins?.[pinIndex];

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
  // Each date -> the day number of the place it is drawn as (a merged stay is one place, numbered by its first day).
  const placeDayMap = useMemo(() => placeDayByDate(days, places, dayNumberByDate), [days, places, dayNumberByDate]);
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
        // B2543 — `p.home` already came out of `getPlaces` with `p.location`
        // swapped for the localized "Home" string.
        home: p.home,
      })),
    [places, dayNumberByDate],
  );
  const recordedSegments = useMemo(
    () => recordedSegmentsFor(trackByDay, placeDayMap),
    [trackByDay, placeDayMap],
  );
  // B-2980: how each day's own entry says it travelled, by day number.
  const declaredModes = useMemo(() => {
    const m = new Map<number, TransportMode>();
    for (const d of days) {
      const mode = legModeFromEntry(d.transportMode);
      const n = dayNumberByDate.get(d.date);
      // Only a day that starts its place: a later day of a merged stay has no leg of its own.
      if (mode && n && placeDayMap.get(d.date) === n) m.set(n, mode);
    }
    return m;
  }, [days, dayNumberByDate, placeDayMap]);
  const frame = useMemo(() => {
    const built = buildTripFrame(mapPlaces, recordedSegments);
    // A reader never gets a line that ends at a home-zone place: its real coordinates stay off the map.
    const homeDays = new Set(mapPlaces.filter((p) => p.home).map((p) => p.day));
    const lines = withDeclaredLegs(built.allLines, mapPlaces, declaredModes).filter(
      (l) => l.kind === "recorded" || l.kind === "gap" || !(homeDays.has(l.fromDay) || homeDays.has(l.toDay)),
    );
    return { ...built, lines };
  }, [mapPlaces, recordedSegments, declaredModes]);
  // Literal keys so the locale scope ships them to this page.
  const modeLabel = (mode: TransportMode): string =>
    ({
      flight: t("studio.day.transport.flight"),
      train: t("studio.day.transport.train"),
      bus: t("studio.day.transport.bus"),
      motorbike: t("studio.day.transport.motorbike"),
      bicycle: t("studio.day.transport.bicycle"),
      boat: t("studio.day.transport.boat"),
      car: t("studio.day.transport.car"),
      taxi: t("studio.day.transport.taxi"),
      walk: t("studio.day.transport.walk"),
      metro: t("studio.day.transport.metro"),
      tram: t("studio.day.transport.tram"),
      ferry: t("studio.day.transport.ferry"),
    })[mode];
  // "Mode (recorded)" or "Mode (from the day)": never claim a recording that was not one.
  const legLabel = (mode: TransportMode, source: "recorded" | "day"): string =>
    source === "recorded"
      ? t("map.leg.recorded", { mode: modeLabel(mode) })
      : t("map.leg.fromDay", { mode: modeLabel(mode) });
  // How a day travelled and who said so — the recording, or the day's own entry.
  const transportLine = (date: string): string | undefined => {
    const n = placeDayMap.get(date);
    if (!n) return undefined;
    const declared = declaredModes.get(dayNumberByDate.get(date) ?? 0);
    if (declared) return legLabel(declared, "day");
    const recorded = recordedSegments.find((s) => s.day === n && !s.gap && s.mode)?.mode;
    return recorded ? legLabel(recorded, "recorded") : undefined;
  };
  const legLabelRef = useRef(legLabel);
  useEffect(() => {
    legLabelRef.current = legLabel;
  });

  // Which region the map is currently framed on — the main one until a
  // reader taps another region's chip. Seeded once from `frame` at mount;
  // Next.js gives every trip's map page its own fresh mount (a route change
  // is a new component instance, not a prop update on this one), so there is
  // no later point where `frame` changes under an already-mounted page for
  // this to resync against.
  const [regionIndex, setRegionIndex] = useState(frame.mainRegionIndex);

  // The `MapPlace`s the currently-showing region (or the whole tour) is
  // actually made of — B2560. `frame.framePlaces` alone is only ever the
  // *main* region's own places (or, for a tour, every non-home place), so a
  // reader's region switch needs this instead: `applyStreetOverlay`'s own
  // marker loop draws exactly this list, never a day-number-filtered guess
  // at it (two different regions can share a day *number*, however
  // unlikely, and that guess would draw the wrong region's place — see its
  // own doc on `regionPlaces`).
  // B-2980: the "Whole trip" chip shows every region at once, like a tour,
  // so the flight between two of them is drawn.
  const [wholeTrip, setWholeTrip] = useState(false);
  const whole = frame.isTour || wholeTrip;
  const frameRegionPlaces = useMemo(
    () =>
      frame.isTour
        ? frame.framePlaces
        : wholeTrip
          ? frame.regions.filter((r) => !r.home).flatMap((r) => r.places)
          : (frame.regions[regionIndex]?.places ?? []),
    [frame.isTour, frame.framePlaces, frame.regions, regionIndex, wholeTrip],
  );
  const regionDayNumbers = useMemo(
    () => new Set(frameRegionPlaces.map((p) => p.day)),
    [frameRegionPlaces],
  );
  // A tour shows every place at once (docs/plans/2026-09-28-trip-maps —
  // "more than three regions ⇒ a tour, shown whole"); otherwise the map
  // frames on whichever region is selected.
  const regionPlaces = useMemo(
    () =>
      // A home-zone place is a day in the list but never a marker: its real position is the owner's.
      (whole
        ? places
        : places.filter((p) => regionDayNumbers.has(dayNumberByDate.get(p.firstDate) ?? 1))
      ).filter((p) => !p.home),
    [whole, places, regionDayNumbers, dayNumberByDate],
  );
  const overlayPlaces = useMemo(() => frameRegionPlaces.filter((p) => !p.home), [frameRegionPlaces]);
  // Lines for the region on screen, chosen here so a region chip draws its own.
  const regionLines = useMemo(
    () => linesForRegion(frame.lines, regionDayNumbers, whole),
    [frame.lines, regionDayNumbers, whole],
  );
  // Pins far outside the region shown (a mis-tagged photo) never stretch its frame.
  const pins = useMemo(
    () => (whole ? allPins : pinsInRegion(allPins, frameRegionPlaces)),
    [whole, allPins, frameRegionPlaces],
  );
  const onMainRegion = frame.isTour || regionIndex === frame.mainRegionIndex;

  // Which region file's tiles to actually draw — B2560. `streetMap` alone is
  // only ever the *main* region's file; switched onto another region (via a
  // chip, see `regionChips` below), this picks whichever of `streetMapRegions`
  // covers the most of that region's own places instead, so the streets
  // under a region switch are that region's own, not the main region's moved
  // frame. Falls back to `streetMap`'s own file when there's nothing to
  // check bboxes against (no extra files, or nothing in bounds). A tour gets
  // none at all.
  const activeStreetMap = useMemo(() => {
    // A tour is framed whole over the world underlay every street map
    // carries, its bounds clamped inside the poles (B2604, B2618).
    if (!streetMap) return null;
    if (whole) return streetMap;
    if (!streetMapRegions || streetMapRegions.length === 0) return streetMap;
    const currentRegionPlaces = frame.regions[regionIndex]?.places ?? [];
    if (currentRegionPlaces.length === 0) return streetMap;
    let best = streetMap;
    let bestCount = -1;
    for (const file of streetMapRegions) {
      const [[minLng, minLat], [maxLng, maxLat]] = file.bounds;
      const count = currentRegionPlaces.filter(
        (p) => p.lng >= minLng && p.lng <= maxLng && p.lat >= minLat && p.lat <= maxLat,
      ).length;
      if (count > bestCount) {
        bestCount = count;
        best = file;
      }
    }
    return best;
  }, [streetMap, streetMapRegions, whole, frame.regions, regionIndex]);
  // The server only ever clipped a basemap around the main region (see
  // `basemapForRoute(framePoints(places))` in the page above this
  // component) — switched onto another region, that bundle would draw the
  // wrong coastline, so `WorldMap` falls back to its own whole-world
  // coastline instead, same as a trip with no basemap at all.
  const regionBasemap = onMainRegion ? basemap : null;

  const plottableInRegion = useMemo(() => regionPlaces.filter(isPlottable), [regionPlaces]);

  // Where the street map frames the trip: the places where days happened, not the region
  // file's own padded box (15 km wider, which lets a day sit on the edge).
  const streetBounds = useMemo(
    () =>
      plottableInRegion.length > 0
        ? boundsFor([...plottableInRegion, ...pins, ...regionLines.filter((l) => l.kind === "recorded").flatMap((l) => l.coords)])
        : routePoints.length > 0
          ? boundsFor(routePoints)
          : plan.length > 0 && activeStreetMap?.world
            ? boundsFor(plan)
            : (activeStreetMap?.bounds ?? null),
    [plottableInRegion, pins, regionLines, routePoints, plan, activeStreetMap],
  );
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [sheetInset, setSheetInset] = useState(0);
  const [layersOpen, setLayersOpen] = useState(false);
  // The owner note is dismissed for this browser session only.
  const [unwrittenHidden, setUnwrittenHidden] = useState(false);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read after hydration so server and client markup match
      if (sessionStorage.getItem(`fs-unwritten-hidden-${tripId}`)) setUnwrittenHidden(true);
    } catch {}
  }, [tripId]);
  const dismissUnwritten = () => {
    setUnwrittenHidden(true);
    try {
      sessionStorage.setItem(`fs-unwritten-hidden-${tripId}`, "1");
    } catch {}
  };

  // Selects a day and carries it in the URL as `?day=<date>` (B2537 — was
  // `?stop=<key>` before this ticket, since the page now navigates by
  // calendar day rather than by merged-stay place; `?stop=` on an old link
  // simply finds nothing below, same as any other unknown key always did).
  // `history.replaceState`, so picking through a trip never grows the back
  // stack or jumps the scroll position `pushState`/a hash link would.
  const selectDay = useCallback((date: string | null) => {
    setSelectedDate(date);
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${withDayParam(window.location.search, date)}${window.location.hash}`,
    );
  }, []);

  // B-2980: the desktop list's own "Read this day" — the day opens in the left column, no navigation.
  const [readingDesktop, setReadingDesktop] = useState(false);
  const reducedMotion = Boolean(useReducedMotion());
  const readIndex = days.findIndex((d) => d.date === selectedDate);
  const readDay = days[readIndex];
  const readPrev = adjacentDate(days.map((d) => d.date), selectedDate, -1);
  const readNext = adjacentDate(days.map((d) => d.date), selectedDate, 1);
  const toggleDay = useCallback((date: string | null) => {
    selectDay(date === selectedDate ? null : date);
  }, [selectDay, selectedDate]);

  // Escape goes back to the whole trip (anything inside that used the key has already claimed it).
  useEffect(() => {
    if (selectedDate === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (escapeDeselects(selectedDate, e.key, e.defaultPrevented)) selectDay(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedDate, selectDay]);

  // Warm the selected day's story, its neighbours' and the first photographs, so "Read the day" opens at once.
  const galleryOf = (i: number) =>
    days[i] ? places.flatMap((p) => p.entries).filter((e) => e.date === days[i].date).flatMap((e) => e.gallery ?? []) : [];
  usePrefetchDays(readIndex, days.length, galleryOf);
  const kmByDate = useMemo(() => kmByDateOf(trackByDay), [trackByDay]);
  const selectedWeather = useWeatherText(readDay?.weather);
  const weatherChip = selectedWeather?.chip;
  const weatherLabel = selectedWeather?.label;

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

  // A day in another region brings that region's camera and lines with it.
  useEffect(() => {
    if (selectedDayNumber === null || whole || regionDayNumbers.has(selectedDayNumber)) return;
    const i = frame.regions.findIndex((r) => !r.home && r.places.some((p) => p.day === selectedDayNumber));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (i >= 0) setRegionIndex(i);
  }, [selectedDayNumber, whole, regionDayNumbers, frame.regions]);

  const pastTense = over && hasDays;
  const hasContent = hasPlaces || plan.length > 0 || track.length > 0 || routePoints.length > 0 || pins.length > 0;
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

  // The legend lists every mode the WHOLE trip travelled by (recorded and declared legs on
  // every day) and marks the ones the selected day used — selecting a day never shrinks it.
  const modesShown = useMemo(() => legendModes(frame.lines, selectedDayNumber), [frame.lines, selectedDayNumber]);

  const regionChips = onMainRegion && !wholeTrip ? frame.chips : [];
  // B-2980: with two or more real regions there is a way back out to all of
  // them, and a way over to any one of them from wherever the camera is.
  const switchRegions = frame.isTour ? [] : frame.regions.flatMap((r, i) => (r.home ? [] : [{ r, i }]));
  const multiRegion = switchRegions.length > 1;
  const showSwitchers = multiRegion && (wholeTrip || !onMainRegion);

  // The street map itself — a live `maplibregl.Map`, drawn onto imperatively
  // by `applyStreetOverlay` rather than through JSX. A day selected re-runs
  // the effect below against the same stored instance; a region switch
  // (B2560) changes `activeStreetMap.url`, which remounts `StreetMap`
  // entirely (see its own doc on why) and fires `onReady` again with a
  // *different* `maplibregl.Map`.
  //
  // The redraw effect below keys off `streetMapInstance` itself, not a
  // boolean — a remount fires `onReady` with a genuinely new object, so the
  // effect re-runs even when nothing else it depends on changed in the same
  // render. A boolean "ready" flag flipping true→true across a remount is a
  // no-op update React skips entirely, which is exactly the render a region
  // switch produces: `regionDayNumbers` already changed *before* the new map
  // finishes mounting, so the redraw effect fires once against the
  // about-to-be-destroyed old map, and never again against the new one,
  // leaving it with no markers at all. The old markers were also `Marker`
  // instances bound to that now-removed map — `streetMarkersRef` is cleared
  // on every ready too, or a later redraw would reuse one whose `setLngLat`
  // on the new map silently does nothing.
  const pinLabel = t("map.photoPin");
  const streetMarkersRef = useRef<Map<number, MapLibreMarker>>(new Map());
  const [streetMapInstance, setStreetMapInstance] = useState<MapLibreMap | null>(null);
  const onStreetMapReady = useCallback((map: MapLibreMap) => {
    streetMarkersRef.current.clear();
    setStreetMapInstance(map);
  }, []);
  useEffect(() => {
    const map = streetMapInstance;
    if (!map) return;
    // The canvas runs on under the phone's day sheet; as the map's own
    // padding the sheet moves the camera's centre — the point every zoom
    // keeps still — into the part still showing, so a zoom-out lands the
    // globe there rather than behind the sheet (B2618).
    map.setPadding({ top: 0, right: 0, left: 0, bottom: sheetInset });
    const redraw = applyStreetOverlay(
      map,
      {
        frame,
        whole: wholeTrip,
        regionDayNumbers,
        regionPlaces: overlayPlaces,
        selectedDay: selectedDayNumber,
        accentHex: ACCENT_HEX[accent],
        pins,
        pinLabel,
        unwrittenLines: unwritten?.lines,
        legLabel: (m, src) => legLabelRef.current(m, src),
        weather:
          weatherChip && weatherLabel && selectedDayNumber !== null
            ? { day: selectedDayNumber, chip: weatherChip, label: weatherLabel }
            : undefined,
        onOpenPins: (group) => {
          setPinIndex(0);
          setOpenPins(group);
        },
        onSelectDay: (day) => {
          const date = dateByDayNumber.get(day);
          if (date) toggleDay(date);
        },
        // Keeps a fitted day clear of the header above and the phone
        // sheet's own peek height below — `sheetInset` is 0 on desktop and
        // wherever nothing covers the map, same value `WorldMap` already
        // frames around.
        // sheetInset is already the map's own bottom padding (setPadding above) and
        // fitBounds adds to it, so only the 24px margin goes here.
        padding: { top: 72, bottom: 24, left: 24, right: 24 },
      },
      streetMarkersRef.current,
    );
    map.on("zoom", redraw);
    return () => {
      map.off("zoom", redraw);
    };
  }, [
    streetMapInstance,
    frame,
    wholeTrip,
    regionDayNumbers,
    overlayPlaces,
    selectedDayNumber,
    accent,
    dateByDayNumber,
    toggleDay,
    sheetInset,
    pins,
    unwritten,
    pinLabel,
    declaredModes,
    weatherChip,
    weatherLabel,
  ]);

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden lg:h-screen">
      <div className="shrink-0">
        <PageHeader />
      </div>

      {/* The info/chip row — region switch, far legs, and the live-tail
          status (B2536), in one row right under the header. Visible at
          every width: on a phone this *is* "a small header chip row" over
          the full-bleed map below; on desktop it sits atop the day list. */}
      {(regionChips.length > 0 || multiRegion || liveTail || selectedDate !== null) && hasPlaces && (
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
                onClick={
                  clickable
                    ? () => {
                        selectDay(null);
                        setRegionIndex(targetRegionIndex);
                      }
                    : undefined
                }
                className="flex items-center gap-1 rounded-full border border-line-quiet bg-surface-raised px-2.5 py-1 text-xs font-semibold text-ink-body disabled:cursor-default"
              >
                <ArrowUp
                  className="h-3 w-3 shrink-0"
                  style={{ transform: `rotate(${Math.round(chip.bearingDeg)}deg)` }}
                  aria-hidden
                />
                {chip.label}
                {chip.days ? ` · ${chip.days} ${tn("map.days", chip.days)}` : ""}
              </button>
            );
          })}
          {showSwitchers &&
            switchRegions.map(({ r, i }) => (
              <button
                key={`switch-${i}`}
                type="button"
                role="listitem"
                aria-current={!wholeTrip && i === regionIndex ? "true" : undefined}
                onClick={() => {
                  selectDay(null);
                  setWholeTrip(false);
                  setRegionIndex(i);
                }}
                className="flex items-center gap-1 rounded-full border border-line-quiet bg-surface-raised px-2.5 py-1 text-xs font-semibold text-ink-body aria-[current=true]:border-line-prominent aria-[current=true]:bg-surface-selected"
              >
                {r.places[0].name}
                {r.days ? ` · ${r.days} ${tn("map.days", r.days)}` : ""}
              </button>
            ))}
          {!multiRegion && selectedDate !== null && (
            // The way back out of a selected day: the whole trip in view again.
            <button
              type="button"
              role="listitem"
              onClick={() => selectDay(null)}
              className="flex min-h-8 items-center gap-1 rounded-full border border-line-prominent bg-surface-raised px-3 py-1 text-xs font-semibold text-ink-body"
            >
              <Globe className="h-3 w-3 shrink-0" aria-hidden />
              {t("map.wholeTrip")}
            </button>
          )}
          {multiRegion && (
            <button
              type="button"
              role="listitem"
              aria-current={wholeTrip ? "true" : undefined}
              onClick={() => {
                selectDay(null);
                setWholeTrip(true);
              }}
              className="flex items-center gap-1 rounded-full border border-line-quiet bg-surface-raised px-2.5 py-1 text-xs font-semibold text-ink-body aria-[current=true]:border-line-prominent aria-[current=true]:bg-surface-selected"
            >
              <Globe className="h-3 w-3 shrink-0" aria-hidden />
              {t("map.wholeTrip")}
            </button>
          )}
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
          {readingDesktop && readDay ? (
            <DayReader
              day={readDay}
              index={readIndex}
              count={days.length}
              transportLine={transportLine(readDay.date)}
              pageHref={href(`/day/${readDay.slug}`)}
              dir={0}
              reduced={reducedMotion}
              onPrev={readPrev ? () => selectDay(readPrev) : undefined}
              onNext={readNext ? () => selectDay(readNext) : undefined}
              onClose={() => setReadingDesktop(false)}
              km={kmByDate.get(readDay.date)}
              tripCost={tripCost}
              className="min-h-0 flex-1 px-4 pt-3"
            />
          ) : (
            <>
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
                        <div className="flex flex-wrap gap-2">
                          <button type="button" onClick={() => setReadingDesktop(true)} className={READ_DAY_BUTTON}>
                            {t("map.readTheDay")}
                            <BookOpen className="h-4 w-4" aria-hidden />
                          </button>
                        </div>
                        <a
                          href={googleMapsHref(place)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex min-h-8 items-center gap-1 self-start text-xs font-semibold text-ink-secondary underline decoration-line-quiet underline-offset-2"
                        >
                          <MapPin className="h-3.5 w-3.5" aria-hidden />
                          {t("map.googleMapsShort")}
                        </a>
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
                        style={{ stroke: "var(--map-leg-muted)" }}
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
            </>
          )}
        </section>

        {/* The map — full-bleed under the info row, on every width. */}
        <div className="relative h-full min-h-0">
          {activeStreetMap && (!activeStreetMap.world || hasContent) ? (
            <StreetMap
              bounds={streetBounds ?? activeStreetMap.bounds}
              zoomControl={false}
              // Clear of the header chips above and the legend (and, on a
              // phone, the day sheet) below.
              padding={{ top: 72, bottom: sheetInset + 24, left: 24, right: 24 }}
              pmtilesUrl={activeStreetMap.url}
              maxZoom={activeStreetMap.maxZoom}
              onReady={onStreetMapReady}
              // Flat, not the globe: MapLibre places HTML markers (stops, photo pins,
              // chips) with a different projection than the GPU-drawn lines when zoomed
              // out on a globe, so they drift off the route until you zoom in (B-2980).
              // The globe returns when those markers are drawn by the GPU as well.
              className="h-full w-full"
            />
          ) : hasContent ? (
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
              frameHint={routePoints}
              pins={pins}
              mutedTrack={unwritten?.lines}
              onOpenPins={(group) => {
                setPinIndex(0);
                setOpenPins(group);
              }}
            />
          ) : (
            <p className="flex h-full items-center justify-center p-6 text-center text-ink-secondary">
              {t(hasDays ? "map.emptyNoPlace" : "map.empty")}
            </p>
          )}

      {owner && activeStreetMap?.world && hasContent && (
        <p
          className={`absolute left-3 z-10 max-w-[calc(100%-76px)] rounded-full border border-line-quiet bg-surface-raised/95 px-3 py-1.5 text-xs text-ink-secondary shadow-sm backdrop-blur ${
            unwritten && unwritten.dates.length > 0 && !unwrittenHidden ? "top-14" : "top-3"
          }`}
        >
          {t("map.worldOnlyHint")}
        </p>
      )}

      {unwritten && unwritten.dates.length > 0 && !unwrittenHidden && (
        <aside className="absolute left-3 top-3 z-10 flex h-8 max-w-[calc(100%-76px)] items-center gap-2 rounded-full border border-line-quiet bg-surface-raised/95 pl-3 pr-1 text-xs text-ink-body shadow-sm backdrop-blur">
          <p className="min-w-0 truncate">
            {tn("map.unwritten", unwritten.dates.length, { n: String(unwritten.dates.length) })}
            {" · "}
            <a
              href={`${userHref("/studio/day/new")}?trip=${encodeURIComponent(tripId)}&date=${unwritten.dates[0]}`}
              className="underline decoration-line-quiet underline-offset-2"
            >
              {formatShortDate(unwritten.dates[0])} · {t("map.unwritten.write")}
            </a>
          </p>
          <button
            type="button"
            aria-label={t("map.unwritten.dismiss")}
            onClick={dismissUnwritten}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-surface-muted"
          >
            <X size={14} aria-hidden />
          </button>
        </aside>
      )}

          {/* Big round zoom buttons on the right edge, in the thumb zone, riding above the sheet at every
              snap (the sheet's own inset); stepping aside when the reader fills the screen. */}
          {streetMapInstance && activeStreetMap && zoomControlsVisible(sheetInset, typeof window === "undefined" ? 0 : window.innerHeight) && (
            <div className="absolute right-3 z-10" style={{ bottom: sheetInset + 12 }}>
              <MapControls
                onZoomIn={() => streetMapInstance.zoomIn()}
                onZoomOut={() => streetMapInstance.zoomOut()}
                onFit={() => {
                  if (selectedDate !== null) selectDay(null);
                  else if (streetBounds) streetMapInstance.fitBounds(streetBounds, { padding: { top: 72, bottom: 24, left: 24, right: 24 }, duration: reducedMotion ? 0 : 500 });
                }}
              />
            </div>
          )}

          {/* "Legend shows only what is drawn": one small button, a popover of every mode the trip travelled by. */}
          {streetMap && hasPlaces && modesShown.length > 0 && (
            <div className="absolute right-3 top-3 z-10">
              <button
                type="button"
                aria-label={t("map.layers")}
                aria-expanded={layersOpen}
                onClick={() => setLayersOpen((o) => !o)}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-line-quiet bg-surface-raised text-ink-strong shadow-md"
              >
                <Layers size={18} aria-hidden />
              </button>
              {layersOpen && (
                <ul className="absolute right-0 mt-2 w-48 rounded-xl border border-line-quiet bg-surface-raised p-3 text-xs text-ink-body shadow-md">
                  {modesShown.map(({ mode, pattern, selected }) => (
                    <li key={mode} className={`flex items-center gap-2 py-1${selected ? " font-bold text-ink-strong" : ""}`}>
                      <LineSwatch pattern={pattern} />
                      {modeLabel(mode)}
                      {selected && <span aria-hidden className="ml-auto h-1.5 w-1.5 rounded-full bg-ink-strong" />}
                    </li>
                  ))}
                </ul>
              )}
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
          // The z0–6 world file has no street to fly through: the slideshow keeps its own cut.
          streetMapUrl={streetMap && !streetMap.world ? streetMap.url : null}
        />
      )}

      <Lightbox
        index={openPins ? pinIndex : null}
        count={openPins?.length ?? 0}
        onClose={() => setOpenPins(null)}
        onPrev={() => setPinIndex((i) => (i - 1 + (openPins?.length ?? 1)) % (openPins?.length ?? 1))}
        onNext={() => setPinIndex((i) => (i + 1) % (openPins?.length ?? 1))}
      >
        {openPin && (
          <>
            <FullPhoto item={openPin.item} />
            {openPin.item.caption && (
              <p className="mt-3 text-center font-display text-sm italic text-overlay-ink/85">{openPin.item.caption}</p>
            )}
          </>
        )}
      </Lightbox>

      <MobileMapSheet
        days={days}
        places={places}
        selectedDate={selectedDate}
        onSelectDate={toggleDay}
        onInsetChange={setSheetInset}
        onDeselect={() => selectDay(null)}
        kmByDate={kmByDate}
        tripCost={tripCost}
        transportLine={transportLine}
        hrefForDay={(slug) => href(`/day/${slug}`)}
        onPlay={
          hasPlaces
            ? (date) => {
                setStartDate(date);
                setShowing(true);
              }
            : undefined
        }
      />
    </div>
  );
}

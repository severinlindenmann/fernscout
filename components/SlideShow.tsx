"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { mediaLoader, posterSrc } from "./mediaLoader";
import { POSTER_WIDTH } from "@/lib/mediaSizes";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  X,
  Play,
  Pause,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Plane,
  TrainFront,
  TrainFrontTunnel,
  TramFront,
  Bus,
  Bike,
  Motorbike,
  Car,
  CarTaxiFront,
  Ship,
  Footprints,
  Navigation,
  Sparkles,
  Film,
  Minus,
  Plus,
  Maximize2,
  Minimize2,
  RotateCcw,
  Volume2,
  VolumeX,
} from "lucide-react";
import { project, MAP_VIEWBOX } from "@/lib/mapProjection";
import { isPlottable, frameRoute, type Frame } from "@/lib/mapFrame";
import { useWorldLand } from "./useWorldLand";
import { flagFor } from "@/lib/flags";
import { buildNarratedCut, slideNeedsTravelInterlude, type NarratedCutSlide } from "@/lib/narratedCut";
import DualTime from "./DualTime";
import { useWakeLock } from "./useWakeLock";
import { useI18n } from "./LocaleProvider";
import { useTrip } from "./TripProvider";
import { mapAccent, mapStyle } from "@/lib/map/style";
import StopMarker from "./map/StopMarker";
import RouteLine from "./map/RouteLine";
import type { PlaceView } from "./WorldMap";
import type { Basemap } from "@/lib/basemap";
import type { GalleryItem, TripAccent } from "@/lib/types";

/** The trip's headline counts, for the end screen — computed once, the same
 * way for every caller (`lib/entries.ts`'s `getTripStats`), and handed in
 * rather than re-derived here so the show's own count never drifts from the
 * map page's stats row it is quoting. */
export type SlideShowStats = {
  tripDays: number;
  places: number;
  countries: number;
  totalMedia: number;
};

// Base dwell, in seconds — the "1x" the +/- speed control scales from.
// Deliberately unhurried by default — this is meant to be watched, not skimmed.
const DEFAULT_DWELL_S = 6;
const MIN_DWELL_S = 3;
const MAX_DWELL_S = 15;
const FULL_TRAVEL_MS = 5200;
const FULL_MEDIA_MS = 6500;

// How long a Highlights travel interlude shows before the next day's slide.
const INTERLUDE_MS = 2000;

// Controls fade out this long after the last pointer/key activity, so a show
// left running on a TV isn't sitting under a permanent overlay of buttons.
const CHROME_IDLE_MS = 3500;

// Story-style tap zones on the slide surface: hold past this long pauses
// instead of counting as a tap; a swipe down past this many px closes.
const TAP_HOLD_MS = 350;
const SWIPE_CLOSE_DY = 80;

// Remembers the chosen dwell across visits, per device — B2305.
const DWELL_STORAGE_KEY = "fernscout.slideshow.dwell";

type Cut = "narrated" | "full";

/**
 * Whether the presentation frame itself is portrait or widescreen —
 * `.fs-present-frame`'s own `orientation` breakpoint, tracked in JS because
 * both the interlude corner map and the landscape-photo treatment need to
 * branch on it, not just switch CSS. Starts `false` (widescreen) rather than
 * guessing from `window` during render, since this component is `ssr:false`
 * and the very first paint corrects itself via the effect below before
 * anything the guess would affect has painted.
 */
function useIsPortraitFrame(): boolean {
  const [portrait, setPortrait] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(orientation: portrait)");
    const update = () => setPortrait(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return portrait;
}

type FullStep =
  | { kind: "travel"; place: PlaceView; fromPlace?: PlaceView; placeIndex: number }
  | {
      kind: "media";
      place: PlaceView;
      item: GalleryItem;
      dayLabel: string;
      date: string;
      time?: string;
      timezone?: string;
      placeIndex: number;
    };

/**
 * Where the "every photo" cut lands for a given calendar day — the day strip
 * and `startDate` both jump through this. The exact match is the day's first
 * photo; a day with no gallery at all (video-only, or not yet photographed)
 * has no step of its own, so this lands on the next day that does rather
 * than doing nothing. Past the last photographed day it clamps to the last
 * step, never past the end.
 */
export function fullCutIndexForDate(steps: readonly FullStep[], date: string): number {
  const exact = steps.findIndex((s) => s.kind === "media" && s.date === date);
  if (exact >= 0) return exact;
  const next = steps.findIndex((s) => s.kind === "media" && s.date > date);
  if (next >= 0) return next;
  return Math.max(steps.length - 1, 0);
}

/** The calendar date a full-cut step belongs to — a travel step carries none
 * of its own, so it borrows the date its destination's first entry was
 * written on. Used only to work out which day-strip thumbnail is current. */
function dateOfFullStep(step: FullStep | undefined): string | undefined {
  if (!step) return undefined;
  return step.kind === "media" ? step.date : step.place.entries[0]?.date;
}

/**
 * Fullscreen presentation mode: letterboxed to 16:9, big type, chrome that
 * hides itself, and two ways to tell the trip.
 *
 * "Highlights" is the narrated cut (I2) — one slide per day, the day's best
 * photo plus a single sentence pulled straight from what was actually
 * written, so "show us the trip" takes minutes rather than hours. "Full
 * tour" is the original retelling: the map flies to each stop in turn and
 * every photo and video plays in order. Meant to be shown on a TV over
 * AirPlay/Chromecast screen mirroring — arrow keys, space and a presenter
 * remote all drive it, the screen won't sleep mid-show, and scroll/clicks on
 * the page behind it are locked out.
 */
export default function SlideShow({
  places,
  onClose,
  startPlaceKey,
  startDate,
  stats,
  basemap = null,
}: {
  places: PlaceView[];
  onClose: () => void;
  startPlaceKey?: string;
  /** Opens the show on this day instead of the beginning — the trip page and
   * day pages' own slideshow buttons (B2306). Resolved in both cuts. */
  startDate?: string;
  /** The trip's real counts, for the end screen — see `SlideShowStats`. */
  stats: SlideShowStats;
  /** Server-clipped to this trip's own frame (`lib/basemap.ts`) — the same
   * prop the map page already computed for `WorldMap` (B2424). Threaded
   * through rather than fetched again: nothing here asks the server for a
   * second copy of a bundle already sitting in this page's own props. */
  basemap?: Basemap | null;
}) {
  const { t, formatShortDate, formatLongDate, locale } = useI18n();
  const href = useTrip()?.href ?? ((p: string) => p);
  // The trip's own colour on its own route (B2422), the same fallback
  // `WorldMap`/`MapPageContent` use for a caller with none to give.
  const accent = useTrip()?.trip?.accent ?? "navy";
  const reducedMotion = useReducedMotion();
  const isPortraitFrame = useIsPortraitFrame();

  const narratedSlides = useMemo<NarratedCutSlide[]>(
    () => buildNarratedCut(places.flatMap((p) => p.entries)),
    [places],
  );

  // Which `places` index each narrated slide (i.e. each calendar day) belongs
  // to — by date rather than by matching `location` strings, since a trip
  // that revisits a city gets two distinct places with the same name. This
  // is what both the travel interludes and the widescreen corner map key
  // off to find their leg/place on the real map.
  const narratedPlaceIndexes = useMemo(() => {
    const byDate = new Map<string, number>();
    places.forEach((place, i) => {
      place.entries.forEach((e) => {
        if (!byDate.has(e.date)) byDate.set(e.date, i);
      });
    });
    return narratedSlides.map((s) => byDate.get(s.date));
  }, [places, narratedSlides]);

  const fullSteps = useMemo<FullStep[]>(() => {
    const out: FullStep[] = [];
    places.forEach((place, placeIndex) => {
      out.push({ kind: "travel", place, fromPlace: places[placeIndex - 1], placeIndex });
      place.entries.forEach((entry) => {
        entry.gallery.forEach((item) => {
          out.push({
            kind: "media",
            place,
            item,
            dayLabel: formatShortDate(entry.date),
            date: entry.date,
            time: entry.time,
            timezone: entry.timezone,
            placeIndex,
          });
        });
      });
    });
    return out;
  }, [places, formatShortDate]);

  // Narrated is the default: it's the one that turns "show us the trip" into
  // eight minutes rather than three hours. Falls back to the full tour only
  // in the edge case of a trip with entries but somehow no days at all.
  const [cut, setCut] = useState<Cut>(narratedSlides.length > 0 ? "narrated" : "full");

  const fullStartIndex = useMemo(() => {
    if (startPlaceKey) {
      const i = fullSteps.findIndex((s) => s.place.key === startPlaceKey);
      if (i >= 0) return i;
    }
    if (startDate) return fullCutIndexForDate(fullSteps, startDate);
    return 0;
  }, [fullSteps, startPlaceKey, startDate]);

  const narratedStartIndex = useMemo(() => {
    if (!startDate) return 0;
    const i = narratedSlides.findIndex((s) => s.date === startDate);
    return i >= 0 ? i : 0;
  }, [narratedSlides, startDate]);

  const [index, setIndex] = useState(cut === "full" ? fullStartIndex : narratedStartIndex);
  const [playing, setPlaying] = useState(true);
  // Lazy initializer, not an effect — this component is ssr:false, so
  // there's no hydration mismatch to dodge, and reading it up front means
  // the very first render already uses the device's remembered speed
  // instead of flashing the default first. Every localStorage touch is
  // wrapped: private browsing and blocked site data both throw rather than
  // return null.
  const [dwellSeconds, setDwellSeconds] = useState<number>(() => {
    try {
      const raw = window.localStorage.getItem(DWELL_STORAGE_KEY);
      const n = raw ? Number(raw) : NaN;
      return Number.isFinite(n) && n >= MIN_DWELL_S && n <= MAX_DWELL_S ? n : DEFAULT_DWELL_S;
    } catch {
      return DEFAULT_DWELL_S;
    }
  });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // A Highlights travel interlude pending between the current slide and the
  // next — see the autoplay effect below for how it's driven. `null` means
  // no interlude is showing.
  const [interlude, setInterlude] = useState<{ toIndex: number; toPlaceIndex: number } | null>(null);
  // Every "Every photo" video starts muted (iOS autoplay requires it). The
  // stored index rides along with the flag so a step change resets it to
  // muted by simple derivation — no effect or ref needed, since a stale
  // stored index (from a video the person unmuted) is just ignored.
  const [mutedState, setMutedState] = useState({ index, muted: true });
  const videoMuted = mutedState.index === index ? mutedState.muted : true;

  useEffect(() => {
    try {
      window.localStorage.setItem(DWELL_STORAGE_KEY, String(dwellSeconds));
    } catch {
      // ignore — nothing to remember it with.
    }
  }, [dwellSeconds]);

  const switchCut = useCallback(
    (next: Cut) => {
      setInterlude(null);
      setCut(next);
      setIndex(next === "full" ? fullStartIndex : narratedStartIndex);
      setPlaying(true);
    },
    [fullStartIndex, narratedStartIndex],
  );

  const total = cut === "narrated" ? narratedSlides.length : fullSteps.length;
  const narratedStep = cut === "narrated" ? narratedSlides[index] : undefined;
  const fullStep = cut === "full" ? fullSteps[index] : undefined;
  // One slide index past the last real one is the end card — not a stop on
  // the last photo, an actual screen of its own (B2306).
  const atEndCard = index >= total;

  const dwellScale = dwellSeconds / DEFAULT_DWELL_S;
  const duration =
    cut === "narrated"
      ? dwellSeconds * 1000
      : (fullStep?.kind === "travel" ? FULL_TRAVEL_MS : FULL_MEDIA_MS) * dwellScale;

  // Derived rather than stored, so reaching the end doesn't need a setState
  // inside the timer effect. Nothing auto-advances once the end card is up —
  // there's nothing after it.
  const isPlaying = playing && !atEndCard && total > 0;

  useWakeLock(total > 0);

  // Arrow keys, taps and the day strip all jump straight to a slide — never
  // through a pending travel interlude, which is an autoplay-only thing.
  const go = useCallback(
    (delta: number) => {
      setInterlude(null);
      setIndex((i) => Math.min(Math.max(i + delta, 0), Math.max(total, 0)));
    },
    [total],
  );

  const isVideoStep = cut === "full" && fullStep?.kind === "media" && fullStep.item.type === "video";

  // Auto-advance; lands on the end card rather than looping or freezing on
  // the last photo. A video step is driven by its own `ended` effect below
  // instead — it does nothing here.
  useEffect(() => {
    if (!isPlaying || isVideoStep) return;
    const advanceTo = Math.min(index + 1, total);
    timerRef.current = setTimeout(() => {
      // A travel interlude between two Highlights slides at different
      // places — only on autoplay (manual navigation always skips it via
      // `go`/`jumpToDay`/`switchCut` above, which clear it), and never into
      // the end card. Modelled as a transient state ahead of the real
      // advance, rather than as an extra step in the sequence, so `index`,
      // the progress bar, the day strip and the end-card maths never have to
      // know interludes exist.
      if (cut === "narrated" && !reducedMotion && advanceTo < total) {
        const toPlaceIndex = narratedPlaceIndexes[advanceTo];
        if (slideNeedsTravelInterlude(narratedPlaceIndexes, advanceTo) && toPlaceIndex !== undefined) {
          setInterlude({ toIndex: advanceTo, toPlaceIndex });
          return;
        }
      }
      setIndex(advanceTo);
    }, duration);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [index, isPlaying, duration, total, cut, reducedMotion, narratedPlaceIndexes, isVideoStep]);

  // Once a pending interlude has had its ~2s on screen, commit the advance
  // it was standing in for — a new setTimeout, not a continuation of the one
  // above, so the interlude's own duration is independent of `dwellSeconds`.
  useEffect(() => {
    if (!interlude) return;
    const id = setTimeout(() => {
      setIndex(interlude.toIndex);
      setInterlude(null);
    }, INTERLUDE_MS);
    return () => clearTimeout(id);
  }, [interlude]);

  // "Every photo" video steps advance on the video's own `ended` event
  // rather than the fixed timer above — a clip that runs long shouldn't get
  // cut off, and one that's short shouldn't leave dead air. A fallback timer
  // covers a video that errors or whose duration never resolves, so autoplay
  // can never stall on a broken file.
  useEffect(() => {
    if (!isPlaying || !isVideoStep) return;
    const advance = () => setIndex((i) => Math.min(i + 1, total));
    let fallback: ReturnType<typeof setTimeout> | null = null;
    const armFallback = () => {
      if (!fallback) fallback = setTimeout(advance, FULL_MEDIA_MS * dwellScale);
    };
    const video = videoRef.current;
    if (!video) {
      armFallback();
      return () => {
        if (fallback) clearTimeout(fallback);
      };
    }
    const onEnded = () => advance();
    const onError = () => advance();
    const onMeta = () => {
      if (!Number.isFinite(video.duration)) armFallback();
    };
    video.addEventListener("ended", onEnded);
    video.addEventListener("error", onError);
    video.addEventListener("loadedmetadata", onMeta);
    if (video.readyState >= 1 && !Number.isFinite(video.duration)) armFallback();
    return () => {
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("error", onError);
      video.removeEventListener("loadedmetadata", onMeta);
      if (fallback) clearTimeout(fallback);
    };
  }, [isPlaying, isVideoStep, total, dwellScale]);

  const toggle = useCallback(() => {
    if (atEndCard) {
      setIndex(0);
      setPlaying(true);
      return;
    }
    setPlaying((p) => !p);
  }, [atEndCard]);

  const watchAgain = useCallback(() => {
    setIndex(0);
    setPlaying(true);
  }, []);

  // Controls fade out during playback and reappear on any activity — a show
  // left running on a TV shouldn't sit under a permanent row of buttons.
  const [chromeVisible, setChromeVisible] = useState(true);
  const idleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bumpChrome = useCallback(() => {
    setChromeVisible(true);
    if (idleRef.current) clearTimeout(idleRef.current);
    idleRef.current = setTimeout(() => setChromeVisible(false), CHROME_IDLE_MS);
  }, []);
  useEffect(() => {
    // Chrome starts visible (the initial state above already reflects that)
    // — this just arms the same idle timeout that keeps it in sync after.
    idleRef.current = setTimeout(() => setChromeVisible(false), CHROME_IDLE_MS);
    window.addEventListener("pointermove", bumpChrome);
    window.addEventListener("pointerdown", bumpChrome);
    return () => {
      window.removeEventListener("pointermove", bumpChrome);
      window.removeEventListener("pointerdown", bumpChrome);
      if (idleRef.current) clearTimeout(idleRef.current);
    };
  }, [bumpChrome]);
  const showChrome = chromeVisible || !isPlaying;

  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      containerRef.current?.requestFullscreen?.().catch(() => {});
    }
  }, []);

  // iPhone WebKit has no element fullscreen at all (B2305) — the button did
  // nothing there. A lazy initializer rather than an effect: this component
  // is ssr:false, so there's no server-rendered guess to avoid fighting, and
  // the capability check needs no DOM node — the method lives on the
  // element prototype whether or not anything has requested it yet.
  const [fullscreenSupported] = useState(
    () => document.fullscreenEnabled === true && typeof HTMLElement.prototype.requestFullscreen === "function",
  );

  // A small settings sheet replaces the old top cut-switch and bottom speed
  // pill with one 44px-safe chip (B2305) — opening it pauses the show.
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Keyboard + scroll lock while the overlay is up.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      bumpChrome();
      if (e.key === "Escape") {
        if (settingsOpen) {
          setSettingsOpen(false);
          return;
        }
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        onClose();
        return;
      }
      // ArrowRight/PageDown and ArrowLeft/PageUp both step the show — most
      // presenter remotes send one pair or the other.
      if (e.key === "ArrowRight" || e.key === "PageDown") {
        setPlaying(false);
        go(1);
      }
      if (e.key === "ArrowLeft" || e.key === "PageUp") {
        setPlaying(false);
        go(-1);
      }
      if (e.key === " ") {
        e.preventDefault();
        toggle();
      }
      if ((e.key === "f" || e.key === "F") && fullscreenSupported) {
        toggleFullscreen();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, [onClose, go, toggle, bumpChrome, settingsOpen, fullscreenSupported, toggleFullscreen]);

  // Mirrors `isPlaying` for the hold timer below, which fires after a delay
  // and needs the live value rather than whatever it closed over at press time.
  const isPlayingRef = useRef(isPlaying);
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  // Story-style gestures on the slide surface itself (B2305): a tap in the
  // left third steps back, the right two thirds step forward and keep
  // playing (unlike the buttons/keys, which pause — this is meant to feel
  // like flicking through stories, not like scrubbing), a press held past
  // TAP_HOLD_MS pauses for as long as it's held, and a mostly-vertical
  // downward swipe closes the show. State lives in a ref, not useState — it
  // changes many times a gesture and none of it should ever cause a render.
  const tapRef = useRef<{
    x: number;
    y: number;
    holdTimer: ReturnType<typeof setTimeout> | null;
    held: boolean;
    pausedByHold: boolean;
  } | null>(null);

  const onSurfacePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    // Wrapped — an id without a live pointer session (Safari has done this
    // for a synthetic press) throws NotFoundError, and losing capture is far
    // cheaper than losing the rest of this handler: the hold timer below is
    // what actually matters, and it still needs to run either way.
    try {
      (e.target as Element).setPointerCapture?.(e.pointerId);
    } catch {
      // ignore — the gesture still tracks fine without capture.
    }
    const holdTimer = setTimeout(() => {
      const st = tapRef.current;
      if (!st) return;
      st.held = true;
      if (isPlayingRef.current) {
        st.pausedByHold = true;
        setPlaying(false);
      }
    }, TAP_HOLD_MS);
    tapRef.current = { x: e.clientX, y: e.clientY, holdTimer, held: false, pausedByHold: false };
  }, []);

  const endSurfaceGesture = useCallback(
    (e: React.PointerEvent, evaluate: boolean) => {
      const st = tapRef.current;
      tapRef.current = null;
      if (!st) return;
      if (st.holdTimer) clearTimeout(st.holdTimer);
      if (st.held) {
        // A hold never also counts as a tap — release just resumes.
        if (st.pausedByHold) setPlaying(true);
        return;
      }
      if (!evaluate) return;
      bumpChrome();
      const dx = e.clientX - st.x;
      const dy = e.clientY - st.y;
      if (Math.abs(dy) > SWIPE_CLOSE_DY && Math.abs(dy) > Math.abs(dx)) {
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        onClose();
        return;
      }
      const rect = containerRef.current?.getBoundingClientRect();
      const relX = rect && rect.width > 0 ? (st.x - rect.left) / rect.width : 0.5;
      // Tap-to-advance keeps playing (stories behaviour) — unlike Prev/Next
      // and the arrow keys, this never calls setPlaying(false).
      go(relX < 1 / 3 ? -1 : 1);
    },
    [bumpChrome, go, onClose],
  );
  const onSurfacePointerUp = useCallback((e: React.PointerEvent) => endSurfaceGesture(e, true), [endSurfaceGesture]);
  const onSurfacePointerCancel = useCallback(
    (e: React.PointerEvent) => endSurfaceGesture(e, false),
    [endSurfaceGesture],
  );

  // The strip along the bottom, one thumbnail per calendar day — `narratedCut`
  // already groups the trip that way, so this is that same list rather than a
  // second grouping of its own. The active thumbnail follows whichever day the
  // current step actually belongs to, in either cut.
  const currentDate = atEndCard
    ? narratedSlides.at(-1)?.date
    : cut === "narrated"
      ? narratedStep?.date
      : dateOfFullStep(fullStep);
  const currentDayIndex = currentDate ? narratedSlides.findIndex((s) => s.date === currentDate) : -1;
  const stripRef = useRef<HTMLDivElement | null>(null);
  const activeThumbRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    activeThumbRef.current?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [currentDayIndex]);
  const jumpToDay = useCallback(
    (dayIndex: number) => {
      const day = narratedSlides[dayIndex];
      if (!day) return;
      setInterlude(null);
      setPlaying(false);
      setIndex(cut === "narrated" ? dayIndex : fullCutIndexForDate(fullSteps, day.date));
      bumpChrome();
    },
    [cut, narratedSlides, fullSteps, bumpChrome],
  );

  if (total === 0) return null;

  // The one sentence per day, in every locale the journal reads in, is
  // computed once on the server (`lib/entries.ts`'s `PlaceEntry.headline`,
  // B309) rather than shipping each day's full prose here to extract from.
  const narratedHeadline = narratedStep?.entry.headline[locale] ?? "";

  const showingFullMedia = fullStep?.kind === "media";
  const fullPlace = fullStep?.place;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black"
    >
      {/* Letterboxed to 16:9 regardless of the window/screen shape, so a
          mirrored TV always gets a proper widescreen frame rather than
          whatever aspect the browser window happens to be. On a portrait
          phone screen — which this never targets, but shouldn't break on —
          that same formula collapses to a thin strip, so it's skipped there
          in favour of just filling the screen. */}
      <style>{`
        .fs-present-frame {
          width: min(100vw, calc(100vh * 16 / 9));
          width: min(100vw, calc(100dvh * 16 / 9));
          height: min(100vh, calc(100vw * 9 / 16));
          height: min(100dvh, calc(100vw * 9 / 16));
        }
        @media (orientation: portrait) {
          .fs-present-frame { width: 100vw; height: 100vh; }
          .fs-present-frame { height: 100dvh; }
        }
        /* Safe-area offsets for the chrome — a sensible minimum margin even
           where env() resolves to 0 (most non-iOS browsers), the real inset
           on a notched/Dynamic-Island phone otherwise (B2305). */
        .fs-safe-top { top: max(3.75rem, env(safe-area-inset-top, 0px)); }
        .fs-safe-bottom { bottom: max(0.75rem, env(safe-area-inset-bottom, 0px)); }
        .fs-safe-left { left: max(0.75rem, env(safe-area-inset-left, 0px)); }
        .fs-safe-right { right: max(0.75rem, env(safe-area-inset-right, 0px)); }
      `}</style>
      <div ref={containerRef} className="relative overflow-hidden bg-overlay-strong fs-present-frame">
        {atEndCard ? (
          <EndScreen stats={stats} tripHref={href("/")} onWatchAgain={watchAgain} />
        ) : cut === "full" && fullStep ? (
          <>
            {/* Map layer — always mounted so the camera keeps its position. */}
            <div
              className={`absolute inset-0 ${showingFullMedia ? "opacity-25" : "opacity-100"} transition-opacity duration-700`}
            >
              <SlideMap
                places={places}
                activeIndex={fullStep.placeIndex}
                travelling={fullStep.kind === "travel" && fullStep.placeIndex > 0}
                basemap={basemap}
                accent={accent}
              />
            </div>

            {/* Media layer */}
            <AnimatePresence mode="wait">
              {showingFullMedia && fullStep.kind === "media" && (
                <motion.div
                  key={`${index}`}
                  initial={{ opacity: 0, scale: 1.04 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.6, ease: "easeOut" }}
                  className="absolute inset-0 flex items-center justify-center p-4 sm:p-10"
                >
                  {fullStep.item.type === "video" ? (
                    <video
                      ref={videoRef}
                      src={fullStep.item.src}
                      // The still frame holds the slide until the clip's first
                      // frame paints, rather than an empty box.
                      poster={posterSrc(fullStep.item.poster, POSTER_WIDTH.FULL)}
                      className="max-h-full max-w-full rounded-xl object-contain shadow-2xl"
                      autoPlay
                      muted={videoMuted}
                      playsInline
                    />
                  ) : (
                    <PresentedPhoto
                      item={fullStep.item}
                      alt={fullStep.item.alt ?? fullStep.item.caption ?? fullPlace?.location ?? ""}
                      priority
                      isPortraitFrame={isPortraitFrame}
                      fit="contain"
                      zoomS={reducedMotion ? undefined : FULL_MEDIA_MS / 1000}
                    />
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Caption — place, when, and one line of what. */}
            {fullPlace && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-overlay-strong via-overlay-strong/70 to-transparent px-[4%] pb-[calc(14%+9rem+env(safe-area-inset-bottom,0px))] pt-[10%]">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={`cap-${index}`}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.35 }}
                  >
                    <div className="font-display font-semibold text-overlay-ink text-[clamp(1.5rem,4.2vw,3.25rem)]">
                      {flagFor(fullPlace.country, fullPlace.countryCode)} {fullPlace.location}
                    </div>
                    <div className="mt-1 text-overlay-ink/70 text-[clamp(0.8rem,1.4vw,1.25rem)]">
                      {showingFullMedia && fullStep.kind === "media" ? (
                        <>
                          {fullStep.dayLabel}
                          {fullStep.time && (
                            <>
                              {" · "}
                              <DualTime date={fullStep.date} time={fullStep.time} timezone={fullStep.timezone} />
                            </>
                          )}
                          {fullStep.item.caption && <>{" · "}{fullStep.item.caption}</>}
                        </>
                      ) : (
                        `${fullPlace.country} · ${formatShortDate(fullPlace.firstDate)}`
                      )}
                    </div>
                  </motion.div>
                </AnimatePresence>
              </div>
            )}
          </>
        ) : cut === "narrated" && interlude ? (
          // The travel interlude itself — the same map the full tour uses,
          // aimed at the destination place with the leg into it flying.
          <div className="absolute inset-0">
            <SlideMap
              places={places}
              activeIndex={interlude.toPlaceIndex}
              travelling
              basemap={basemap}
              accent={accent}
            />
          </div>
        ) : (
          narratedStep && (
            <NarratedSlide
              slide={narratedStep}
              index={index}
              headline={narratedHeadline}
              dateLabel={formatLongDate(narratedStep.date)}
              isPortraitFrame={isPortraitFrame}
              reducedMotion={!!reducedMotion}
              cornerMap={
                !isPortraitFrame && narratedPlaceIndexes[index] !== undefined
                  ? { places, activeIndex: narratedPlaceIndexes[index]!, basemap, accent }
                  : undefined
              }
            />
          )
        )}

        {/* Story-style tap/hold/swipe layer, full-frame and BELOW the chrome
            in DOM order (and so in stacking) — a tap that lands on a real
            button is a click on that button, never a gesture on this. Absent
            on the end card: it renders *before* this layer in DOM order like
            every other slide, so without this guard its own two buttons sat
            under this transparent sheet and nothing could ever reach them. */}
        {!atEndCard && (
          <div
            className="absolute inset-0"
            style={{ touchAction: "none" }}
            onPointerDown={onSurfacePointerDown}
            onPointerUp={onSurfacePointerUp}
            onPointerCancel={onSurfacePointerCancel}
            aria-hidden
          />
        )}

        {/* Progress — one bar per slide in Highlights, where a handful of days
            reads fine. "Every photo" can run past 80 steps, where that many
            slivers is unreadable, so it gets a single line for the current
            step instead; the day strip below is what shows position there. */}
        {!atEndCard && cut === "narrated" && (
          <div className="pointer-events-none absolute inset-x-0 top-0 flex gap-1 p-2">
            {Array.from({ length: total }).map((_, i) => (
              <div key={i} className="h-0.5 flex-1 overflow-hidden rounded-full bg-overlay-ink/25">
                {i < index && <div className="h-full w-full bg-surface-raised/80" />}
                {i === index && (
                  <motion.div
                    key={`p-${index}-${isPlaying}`}
                    initial={{ width: "0%" }}
                    animate={{ width: isPlaying ? "100%" : "35%" }}
                    transition={{ duration: isPlaying ? duration / 1000 : 0.3, ease: "linear" }}
                    className="h-full bg-surface-raised"
                  />
                )}
              </div>
            ))}
          </div>
        )}
        {!atEndCard && cut === "full" && (
          <div className="pointer-events-none absolute inset-x-0 top-0 p-2">
            <div className="h-0.5 w-full overflow-hidden rounded-full bg-overlay-ink/25">
              <motion.div
                key={`p-${index}-${isPlaying}`}
                initial={{ width: "0%" }}
                animate={{ width: isPlaying ? "100%" : "35%" }}
                transition={{ duration: isPlaying ? duration / 1000 : 0.3, ease: "linear" }}
                className="h-full bg-surface-raised"
              />
            </div>
          </div>
        )}

        {/* Chrome: the settings chip (cut + speed), fullscreen and close, and
            Prev/Play/Next — fades out during playback, always there while
            paused or idle. Every box here is kept inside the safe area and
            at least 44x44 (B2305) — the tap layer above is what took over
            the cut-switch and speed pill this replaced. */}
        <AnimatePresence>
          {showChrome && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="pointer-events-none absolute inset-0"
            >
              <button
                onClick={() => {
                  setPlaying(false);
                  setSettingsOpen(true);
                }}
                aria-label={t("show.settings")}
                title={t("show.settings")}
                className="fs-safe-top fs-safe-left pointer-events-auto absolute flex h-11 items-center gap-1.5 rounded-full bg-black/40 px-3.5 text-sm font-semibold text-overlay-ink backdrop-blur transition-colors hover:bg-black/55"
              >
                {cut === "narrated" ? t("show.cutNarrated") : t("show.cutFull")}
                <ChevronDown className="h-4 w-4" />
              </button>

              <div className="fs-safe-top fs-safe-right pointer-events-auto absolute flex items-center gap-2">
                {isVideoStep && (
                  <button
                    onClick={() => setMutedState({ index, muted: !videoMuted })}
                    aria-label={videoMuted ? t("show.soundOn") : t("show.soundOff")}
                    title={videoMuted ? t("show.soundOn") : t("show.soundOff")}
                    className="rounded-full bg-overlay-ink/10 p-3 text-overlay-ink/90 transition-colors hover:bg-overlay-ink/20"
                  >
                    {videoMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
                  </button>
                )}
                {fullscreenSupported && (
                  <button
                    onClick={toggleFullscreen}
                    aria-label={isFullscreen ? t("show.exitFullscreen") : t("show.fullscreen")}
                    title={isFullscreen ? t("show.exitFullscreen") : t("show.fullscreen")}
                    className="rounded-full bg-overlay-ink/10 p-3 text-overlay-ink/90 transition-colors hover:bg-overlay-ink/20"
                  >
                    {isFullscreen ? (
                      <Minimize2 className="h-5 w-5" />
                    ) : (
                      <Maximize2 className="h-5 w-5" />
                    )}
                  </button>
                )}
                <button
                  onClick={onClose}
                  aria-label={t("show.close")}
                  title={t("show.close")}
                  className="rounded-full bg-overlay-ink/10 p-3 text-overlay-ink/90 transition-colors hover:bg-overlay-ink/20"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="fs-safe-bottom pointer-events-auto absolute inset-x-0 flex flex-col items-center gap-3 px-5">
                {/* One thumbnail per day — a tap jumps straight there, in
                    either cut (B2306). Kept off the tap-zone layer below it
                    by living inside this pointer-events-auto chrome. */}
                {narratedSlides.length > 1 && (
                  <div
                    ref={stripRef}
                    role="tablist"
                    aria-label={t("show.days")}
                    className="flex max-w-full items-center gap-1.5 self-stretch overflow-x-auto px-1 py-0.5"
                  >
                    {narratedSlides.map((day, i) => (
                      <button
                        key={day.key}
                        ref={i === currentDayIndex ? activeThumbRef : undefined}
                        role="tab"
                        aria-selected={i === currentDayIndex}
                        aria-label={t("show.dayNumber", { n: String(i + 1) })}
                        onClick={() => jumpToDay(i)}
                        className={`relative h-11 w-11 shrink-0 overflow-hidden rounded-lg border-2 transition-colors ${
                          i === currentDayIndex ? "border-yellow-400" : "border-transparent"
                        }`}
                      >
                        {day.photo ? (
                          <Image
                            src={day.photo.src}
                            loader={mediaLoader}
                            alt=""
                            fill
                            sizes="44px"
                            className="object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-overlay-ink/20 text-xs font-semibold text-overlay-ink">
                            {i + 1}
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <Ctrl
                    label={t("show.prev")}
                    onClick={() => {
                      setPlaying(false);
                      go(-1);
                    }}
                    disabled={index === 0}
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </Ctrl>
                  <Ctrl label={isPlaying ? t("show.pause") : t("show.play")} onClick={toggle} primary>
                    {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                  </Ctrl>
                  <Ctrl
                    label={t("show.next")}
                    onClick={() => {
                      setPlaying(false);
                      go(1);
                    }}
                    disabled={index >= total}
                  >
                    <ChevronRight className="h-5 w-5" />
                  </Ctrl>
                </div>
              </div>

              {settingsOpen && (
                <div className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-black/50 p-6">
                  <div className="w-full max-w-xs rounded-2xl bg-overlay-strong p-4 text-overlay-ink shadow-2xl">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold">{t("show.settings")}</div>
                      <button
                        onClick={() => setSettingsOpen(false)}
                        aria-label={t("show.settingsClose")}
                        title={t("show.settingsClose")}
                        className="flex h-11 w-11 items-center justify-center rounded-full text-overlay-ink/90 transition-colors hover:bg-overlay-ink/10"
                      >
                        <X className="h-5 w-5" />
                      </button>
                    </div>

                    {narratedSlides.length > 0 && fullSteps.length > 0 && (
                      <div className="mt-3 flex items-center gap-0.5 rounded-full bg-overlay-ink/10 p-1">
                        <CutTab
                          active={cut === "narrated"}
                          onClick={() => switchCut("narrated")}
                          label={t("show.cutNarrated")}
                          Icon={Sparkles}
                        />
                        <CutTab
                          active={cut === "full"}
                          onClick={() => switchCut("full")}
                          label={t("show.cutFull")}
                          Icon={Film}
                        />
                      </div>
                    )}

                    <div className="mt-3 flex items-center justify-center gap-1 rounded-full bg-overlay-ink/10 px-1.5 py-1.5">
                      <button
                        onClick={() => setDwellSeconds((s) => Math.max(MIN_DWELL_S, s - 1))}
                        disabled={dwellSeconds <= MIN_DWELL_S}
                        aria-label={t("show.slower")}
                        title={t("show.slower")}
                        className="flex h-11 w-11 items-center justify-center rounded-full text-overlay-ink/90 transition-colors hover:bg-overlay-ink/20 disabled:opacity-30"
                      >
                        <Minus className="h-4 w-4" />
                      </button>
                      <span className="w-16 text-center text-sm tabular-nums text-overlay-ink/80">
                        {t("show.perSlide", { seconds: String(dwellSeconds) })}
                      </span>
                      <button
                        onClick={() => setDwellSeconds((s) => Math.min(MAX_DWELL_S, s + 1))}
                        disabled={dwellSeconds >= MAX_DWELL_S}
                        aria-label={t("show.faster")}
                        title={t("show.faster")}
                        className="flex h-11 w-11 items-center justify-center rounded-full text-overlay-ink/90 transition-colors hover:bg-overlay-ink/20 disabled:opacity-30"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

/**
 * The screen after the last slide — a real stop rather than a freeze-frame on
 * the final photo. Counts are the trip's own, computed once by
 * `getTripStats` and carried down by both callers, never re-derived here, so
 * this can never disagree with the map page's own stats row about the same
 * trip.
 */
function EndScreen({
  stats,
  tripHref,
  onWatchAgain,
}: {
  stats: SlideShowStats;
  tripHref: string;
  onWatchAgain: () => void;
}) {
  const { t, tn } = useI18n();
  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center gap-6 bg-overlay-strong text-center"
      style={{
        paddingLeft: "max(1.5rem, env(safe-area-inset-left, 0px))",
        paddingRight: "max(1.5rem, env(safe-area-inset-right, 0px))",
        paddingTop: "max(1.5rem, env(safe-area-inset-top, 0px))",
        paddingBottom: "max(1.5rem, env(safe-area-inset-bottom, 0px))",
      }}
    >
      <div className="font-display font-semibold text-overlay-ink text-[clamp(1.5rem,4vw,2.5rem)]">
        {t("show.endTitle")}
      </div>
      <dl className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
        <EndStat label={tn("map.days", stats.tripDays)} value={stats.tripDays} />
        <EndStat label={tn("map.stops", stats.places)} value={stats.places} />
        <EndStat label={tn("map.countries", stats.countries)} value={stats.countries} />
        <EndStat label={t("map.media")} value={stats.totalMedia} />
      </dl>
      <div className="mt-2 flex flex-col items-stretch gap-3 sm:flex-row">
        <button
          onClick={onWatchAgain}
          className="flex min-h-11 items-center justify-center gap-1.5 rounded-full bg-overlay-ink/10 px-5 text-sm font-semibold text-overlay-ink transition-colors hover:bg-overlay-ink/20"
        >
          <RotateCcw className="h-4 w-4" />
          {t("show.watchAgain")}
        </button>
        <a
          href={tripHref}
          className="flex min-h-11 items-center justify-center gap-1.5 rounded-full bg-yellow-400 px-5 text-sm font-semibold text-yellow-950 transition-colors hover:bg-yellow-300"
        >
          {t("show.openTrip")}
        </a>
      </div>
    </div>
  );
}

function EndStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-xs text-overlay-ink/70">{label}</dt>
      <dd className="font-display text-xl font-semibold text-overlay-ink">{value}</dd>
    </div>
  );
}

/**
 * One photo, shown to fit the frame it's actually in — B2307.
 *
 * A landscape photo on a portrait frame used to either crop away most of it
 * (narrated's `object-cover`) or float it in black bars (full's
 * `object-contain`). Now it's shown whole, with a blurred, darkened copy of
 * itself filling the rest of the frame — the same trick photo apps use for
 * exactly this mismatch. Every other combination (a portrait photo on a
 * portrait frame, or anything at all on a widescreen frame) keeps each cut's
 * usual look via `fit`.
 *
 * Orientation comes from the gallery item's own `width`/`height` when ingest
 * recorded them (almost always); only when neither is known does this fall
 * back to measuring the loaded image, which can show the plain treatment for
 * one frame before the blurred fill kicks in.
 */
function PresentedPhoto({
  item,
  alt,
  priority,
  isPortraitFrame,
  fit,
  zoomS,
}: {
  item: GalleryItem;
  alt: string;
  priority?: boolean;
  isPortraitFrame: boolean;
  fit: "cover" | "contain";
  /** Seconds the slow zoom takes, or undefined to skip it (B2307: reduced motion, or a still that shouldn't move). */
  zoomS?: number;
}) {
  const [measured, setMeasured] = useState<{ w: number; h: number } | null>(null);
  const known = item.width != null && item.height != null ? item.width > item.height : undefined;
  const landscape = known ?? (measured ? measured.w > measured.h : false);
  const blurredFill = isPortraitFrame && landscape;

  const onLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      if (known !== undefined) return;
      const img = e.currentTarget;
      if (img.naturalWidth && img.naturalHeight) setMeasured({ w: img.naturalWidth, h: img.naturalHeight });
    },
    [known],
  );

  const foreground = (
    <Image
      src={item.src}
      loader={mediaLoader}
      alt={alt}
      fill
      sizes="100vw"
      className={blurredFill ? "object-contain" : fit === "cover" ? "object-cover" : "object-contain"}
      priority={priority}
      onLoad={onLoad}
    />
  );
  const sized = zoomS ? (
    <motion.div
      initial={{ scale: 1 }}
      animate={{ scale: 1.06 }}
      transition={{ duration: zoomS, ease: "linear" }}
      className="relative h-full w-full"
    >
      {foreground}
    </motion.div>
  ) : (
    <div className="relative h-full w-full">{foreground}</div>
  );

  if (!blurredFill) return sized;

  return (
    <div className="absolute inset-0 overflow-hidden">
      <Image
        src={item.src}
        loader={mediaLoader}
        alt=""
        fill
        // Blurred forty pixels and dimmed, so it only has to carry colour: a
        // 160px copy stretched across the screen looks exactly like the
        // full-width one did, which was a second full-size download of the
        // same photograph for every portrait-framed landscape slide.
        sizes="64px"
        aria-hidden
        className="scale-110 object-cover opacity-60 blur-2xl"
      />
      <div className="absolute inset-0">{sized}</div>
    </div>
  );
}

/** One narrated-cut slide: the day's best photo (or a plain card when there
 * is none) with the date/place as a kicker and one sentence as the headline. */
function NarratedSlide({
  slide,
  index,
  headline,
  dateLabel,
  isPortraitFrame,
  reducedMotion,
  cornerMap,
}: {
  slide: NarratedCutSlide;
  index: number;
  headline: string;
  dateLabel: string;
  isPortraitFrame: boolean;
  reducedMotion: boolean;
  /** The widescreen-only route map in the corner — undefined hides it
   * (a portrait frame, or a day that couldn't be matched to a place). */
  cornerMap?: { places: PlaceView[]; activeIndex: number; basemap: Basemap | null; accent: TripAccent };
}) {
  return (
    <div className="absolute inset-0">
      {slide.photo ? (
        <div key={`photo-${index}`} className="absolute inset-0">
          <PresentedPhoto
            item={slide.photo}
            alt={slide.photo.alt ?? slide.photo.caption ?? slide.location}
            priority={index === 0}
            isPortraitFrame={isPortraitFrame}
            fit="cover"
            zoomS={reducedMotion ? undefined : 8}
          />
        </div>
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-overlay-strong via-overlay-strong to-sky-500/40 grain" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-overlay-strong/95 via-overlay-strong/25 to-overlay-strong/10" />

      {cornerMap && (
        <div
          className="pointer-events-none absolute z-10 h-24 w-36 overflow-hidden rounded-xl shadow-lg ring-1 ring-overlay-ink/20 sm:h-28 sm:w-44"
          style={{
            right: "max(0.75rem, env(safe-area-inset-right, 0px))",
            bottom: "calc(9rem + env(safe-area-inset-bottom, 0px))",
          }}
        >
          <SlideMap
            places={cornerMap.places}
            activeIndex={cornerMap.activeIndex}
            travelling={false}
            basemap={cornerMap.basemap}
            accent={cornerMap.accent}
          />
        </div>
      )}

      <AnimatePresence mode="wait">
        <motion.div
          key={`narrated-cap-${index}`}
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
          className="absolute inset-x-0 bottom-0 px-[5%] pb-[calc(9%+9rem+env(safe-area-inset-bottom,0px))] pt-[16%]"
        >
          <div className="font-semibold text-yellow-300 text-[clamp(0.85rem,1.6vw,1.4rem)]">
            {flagFor(slide.country, slide.countryCode)} {slide.location} · {dateLabel}
          </div>
          {headline && (
            <div className="mt-2 font-display font-semibold leading-tight text-overlay-ink text-[clamp(1.75rem,5vw,4.5rem)]">
              {headline}
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function CutTab({
  active,
  onClick,
  label,
  Icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  Icon: typeof Sparkles;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`flex h-11 flex-1 items-center justify-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-colors ${
        active ? "bg-yellow-400 text-yellow-950" : "text-overlay-ink/80 hover:bg-overlay-ink/10"
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

function Ctrl({
  label,
  onClick,
  children,
  disabled,
  primary,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`rounded-full p-3 transition-colors disabled:opacity-30 ${
        primary
          ? "bg-yellow-400 text-yellow-950 hover:bg-yellow-300"
          : "bg-overlay-ink/10 text-overlay-ink hover:bg-overlay-ink/20"
      }`}
    >
      {children}
    </button>
  );
}

const VEHICLE_ICON = {
  flight: Plane,
  train: TrainFront,
  metro: TrainFrontTunnel,
  tram: TramFront,
  bus: Bus,
  motorbike: Motorbike,
  bicycle: Bike,
  car: Car,
  taxi: CarTaxiFront,
  boat: Ship,
  ferry: Ship,
  walk: Footprints,
} as const;

/**
 * A transform that points a vehicle glyph along `headingDeg` (the same
 * convention as `Math.atan2` in degrees) without ever turning it upside
 * down. Rotating a whole 180° for a westward heading is what B640 reported:
 * the car and the plane arrive nose-first but roof-down. Past vertical
 * (`|headingDeg| > 90`, i.e. the heading points leftward) this mirrors the
 * glyph horizontally instead and rotates only the remaining, always-small,
 * angle — a car facing left is a mirrored car, not an inverted one.
 */
export function vehicleHeadingTransform(headingDeg: number): string {
  if (headingDeg > 90 || headingDeg < -90) {
    return `rotate(${headingDeg + 180}) scale(-1, 1)`;
  }
  return `rotate(${headingDeg})`;
}

/**
 * Which points the camera should frame right now: both ends of the leg while
 * one is being flown, or just the one place being dwelled on. Unlocated
 * points fall out in `frameRoute` itself (`isPlottable`), which is also
 * where the last safety net lives — an empty list frames the whole world
 * rather than going anywhere near `NaN` (see the class doc comment below).
 */
function activeLegPoints(places: PlaceView[], activeIndex: number, travelling: boolean): PlaceView[] {
  if (travelling && activeIndex > 0) return [places[activeIndex - 1], places[activeIndex]];
  return [places[activeIndex]];
}

/**
 * The fraction of the *actually visible* viewBox this map's own chrome
 * permanently covers — the title block on the left, the thumbnail strip and
 * transport controls at the bottom, the progress bar and settings/full
 * -screen/close buttons at the top. Asymmetric on purpose: the right edge is
 * the one side nothing ever sits on. Review of B2424's first cut found a leg
 * framed against the *whole* viewBox routinely left one end under the title
 * or the controls — fitting a fine, whole ellipse into a room says nothing
 * about whether its corners are under the furniture.
 */
const SAFE_MARGIN = { left: 0.38, right: 0.06, top: 0.08, bottom: 0.22 } as const;

/**
 * The part of the fixed 1000×500 viewBox `preserveAspectRatio="xMidYMid
 * slice"` actually shows for a container of the given CSS size — the whole
 * viewBox only at exactly a 2:1 aspect; anything narrower (every real
 * container this map draws in: the 16:9 desktop frame, a portrait phone
 * full-bleed) crops symmetrically about the centre on the *width* axis,
 * because `slice` scales by the *larger* of the two ratios to guarantee no
 * letterboxing. `safeBox` must be measured against this, not the nominal
 * 1000×500 — B2424 review found a first cut of the safe-box margins,
 * measured against the full viewBox, landed a stop well outside the
 * portrait phone's actual, much narrower, visible slice.
 */
export function visibleWindow(containerWidth: number, containerHeight: number) {
  const scale = Math.max(containerWidth / MAP_VIEWBOX.width, containerHeight / MAP_VIEWBOX.height);
  const width = containerWidth / scale;
  const height = containerHeight / scale;
  return { x0: (MAP_VIEWBOX.width - width) / 2, y0: (MAP_VIEWBOX.height - height) / 2, width, height };
}

/** The box a leg is actually framed into — `visible` minus `SAFE_MARGIN`. */
export function safeBox(visible: { x0: number; y0: number; width: number; height: number }) {
  const left = visible.x0 + visible.width * SAFE_MARGIN.left;
  const right = visible.x0 + visible.width * (1 - SAFE_MARGIN.right);
  const top = visible.y0 + visible.height * SAFE_MARGIN.top;
  const bottom = visible.y0 + visible.height * (1 - SAFE_MARGIN.bottom);
  return { left, right, top, bottom, width: right - left, height: bottom - top, cx: (left + right) / 2, cy: (top + bottom) / 2 };
}

/**
 * The camera for one `Frame` (from `frameRoute`, reused for its sizing only
 * — see the class doc comment): a zoom and a screen-space centre such that
 * the frame's own box — already padded by `frameRoute`'s own
 * `PAD_FRACTION` — lands entirely inside `safeBox(visibleWindow(...))`, not
 * the whole viewBox. `targetX`/`targetY` are the frame's centre in this
 * map's raw, uncorrected world (the `lngScale` correction undone, per the
 * class doc comment); `cx`/`cy` are where that centre is drawn on screen —
 * the safe box's own centre, not the viewBox's.
 *
 * A pure function of the frame and the container's own CSS size, so it can
 * be tested without rendering anything: hand it a `Frame` and a size and
 * check where a point projects.
 */
export function cameraFor(
  frame: Frame,
  containerWidth: number,
  containerHeight: number,
): { zoom: number; targetX: number; targetY: number; cx: number; cy: number } {
  const safe = safeBox(visibleWindow(containerWidth, containerHeight));
  const targetX = (frame.x + frame.w / 2) / frame.lngScale;
  const targetY = frame.y + frame.h / 2;
  const zoom = Math.min(safe.width / (frame.w / frame.lngScale), safe.height / frame.h);
  return { zoom, targetX, targetY, cx: safe.cx, cy: safe.cy };
}

/** Where a raw (uncorrected) world point lands on screen for a given camera. */
export function projectCamera(camera: { zoom: number; targetX: number; targetY: number; cx: number; cy: number }, x: number, y: number): [number, number] {
  return [camera.cx + (x - camera.targetX) * camera.zoom, camera.cy + (y - camera.targetY) * camera.zoom];
}

/**
 * The map behind the show: the trip's own basemap, a camera framed to
 * whichever leg or stop is on screen, and — while a leg is playing — the
 * vehicle actually travelling along it.
 *
 * Projects through `project()` directly rather than through a `lib/mapFrame`
 * `Frame`, and that is deliberate: this map's viewBox is the whole,
 * uncorrected world — the same coordinate space `basemap`'s baked paths
 * (and, before B2424, `useWorldLand`'s) are in — and the camera pans and
 * zooms across it with a `motion.g` transform instead of cropping to a
 * bounding box. A `Frame`'s own space is cropped and latitude-corrected by
 * `lngScale` for a *static* viewBox; drawing straight into one here would
 * misalign every marker against the ground it sits on.
 *
 * **Per-leg framing (B2424).** The camera's target zoom and centre are still
 * chosen with `frameRoute` — reused for its sizing logic only, never for its
 * coordinate space. `frameRoute(activeLegPoints(...))` frames both ends of
 * the leg being flown, or the single place being dwelled on, and its
 * `lngScale` correction is undone (divided back out of x) to land the answer
 * back in this map's own raw, uniform-scale world before it is used —
 * `frame.w`/`frame.h` become the zoom, `frame.x + frame.w/2` (undone) and
 * `frame.y + frame.h/2` become the pan target (`cameraFor`). Before this a
 * single `ZOOM = 3.4` constant framed every leg the same way regardless of
 * size, so `alps-2024` — four passes inside 68 km — collapsed to a point at
 * the same zoom a transcontinental flight used.
 *
 * **Framed into `safeBox()`, not the whole viewBox.** A first cut fit the
 * frame into the full 1000×500 viewBox and review found a leg routinely
 * left one end under the title block or the transport controls — the show's
 * own chrome sits over a fixed fraction of every side but the right one, and
 * fitting a frame into the whole room says nothing about which corner is
 * under the furniture. `cameraFor` fits it into `safeBox()` instead — the
 * viewBox minus `SAFE_MARGIN` — and centres it there rather than at the
 * viewBox's own centre.
 *
 * Because the effective zoom now varies
 * by orders of magnitude between legs, every size on this map is drawn in
 * *screen* pixels via `px()` below rather than a raw map unit — a marker
 * sized in raw units came out huge at a tight per-leg zoom, the bug this
 * comment is here to keep from coming back (see the equivalent `px` in
 * `WorldMap`/`TripMap`).
 */
export function SlideMap({
  places,
  activeIndex,
  travelling,
  basemap = null,
  accent = "navy",
}: {
  places: PlaceView[];
  activeIndex: number;
  travelling: boolean;
  /** Server-clipped to this trip's own frame (`lib/basemap.ts`), the same
   * prop `WorldMap` draws on this page — replaces the 1:110m coastline
   * (B2424). Null (the bundle not built, or an empty route) falls back to
   * `useWorldLand`'s coarse outline, exactly as before this ticket. */
  basemap?: Basemap | null;
  /** The trip's own accent (B2422) — undeclared reads as navy, the same
   * fallback `WorldMap` uses for a caller with none to give. */
  accent?: TripAccent;
}) {
  const worldLand = useWorldLand();
  const pts = places.map((p) => (isPlottable(p) ? project(p.lat, p.lng) : null));

  // How big this map is actually drawn, in CSS pixels — needed to know how
  // much of the fixed 1000×500 viewBox `preserveAspectRatio="xMidYMid
  // slice"` is actually cropping away (`visibleWindow`, inside `cameraFor`).
  // Same "measure after mount" shape `WorldMap`'s own `drawnWidth` uses, and
  // for the same reason it needs no hydration-safe default here: `SlideShow`
  // is `dynamic(..., { ssr: false })`, so there is no server-rendered value
  // to disagree with.
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 1280, height: 720 });
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setContainerSize({ width, height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const frame = useMemo(
    () => frameRoute(activeLegPoints(places, activeIndex, travelling)),
    [places, activeIndex, travelling],
  );
  // zoom, targetX/Y (the frame's centre, `lngScale` undone) and cx/cy (where
  // that centre lands on screen — `safeBox()`'s own centre, not the
  // viewBox's) — see `cameraFor`'s doc comment.
  const { zoom, targetX, targetY, cx, cy } = cameraFor(frame, containerSize.width, containerSize.height);
  // Only for the active stop's own label, below, to flip sides near the
  // safe box's own right edge — the same "would this name run off the
  // edge" question `TripMap`'s own `runsOff` asks, against this map's own
  // safe box rather than its frame.
  const safe = useMemo(
    () => safeBox(visibleWindow(containerSize.width, containerSize.height)),
    [containerSize.width, containerSize.height],
  );

  // Screen pixels, the same convention `px` in `WorldMap`/`TripMap` uses —
  // simplified for this map's own fixed viewBox (see the class doc comment):
  // one raw unit is always the same fraction of this container regardless of
  // its CSS size, so only the camera's own zoom needs dividing out.
  const px = useCallback((n: number) => n / zoom, [zoom]);

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${MAP_VIEWBOX.width} ${MAP_VIEWBOX.height}`}
      // Forces the dark `--map-*` tokens regardless of the reader's own
      // theme (docs/plans/map-redesign.md §1, "Accent": "The slideshow uses
      // the dark-theme token instead of a separate slideshow shade") — the
      // override lives in app/globals.css next to `.fs-ask-dark`'s own
      // single-card version of the same trick, scoped to every `--map-*`
      // token instead of one background/colour pair.
      className="fs-map-dark h-full w-full"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
    >
      <rect width={MAP_VIEWBOX.width} height={MAP_VIEWBOX.height} fill={mapStyle.sea} />
      <motion.g
        animate={{
          x: cx - targetX * zoom,
          y: cy - targetY * zoom,
          scale: zoom,
        }}
        transition={{ duration: FULL_TRAVEL_MS / 1000, ease: [0.4, 0, 0.2, 1] }}
        // Motion's default `transform-box: fill-box` for an SVG element makes
        // `originX`/`originY` relative to this group's own rendered content —
        // its bounding box, not the SVG's origin (and Motion recomputes
        // `transformOrigin` itself every render, so setting that CSS property
        // literally is not enough; `transformBox` is the escape hatch, since
        // Motion passes that one through untouched). At the old fixed
        // `ZOOM = 3.4` the fill-box/view-box mismatch was a few hundred
        // viewBox units, easy to miss; at a tight per-leg zoom (B2424, into
        // the hundreds) it is thousands of units, and every marker lands off
        // -screen. `view-box` makes `originX`/`originY: 0` mean the SVG's own
        // (0,0), which is what `x`/`y` above are computed against.
        style={{ transformBox: "view-box", originX: 0, originY: 0 }}
      >
        {/* Ground. Same convention `WorldMap` draws its own basemap with:
            path data is baked in raw, uncorrected units, so a literal
            `strokeWidth` plus `vectorEffect="non-scaling-stroke"` already
            renders as a constant screen width at any zoom, without needing
            `px()` — `px()` is for geometry (a marker's radius) that
            `vector-effect` cannot help with. */}
        {basemap ? (
          <>
            <g fill={mapStyle.land} stroke={mapStyle.border} strokeWidth={1.2}>
              {basemap.borders.map((d, i) => (
                <path key={i} d={d} vectorEffect="non-scaling-stroke" />
              ))}
            </g>
            <g fill={mapStyle.ice} stroke={mapStyle.ice} strokeWidth={0.6} opacity={0.9}>
              {basemap.glaciers.map((d, i) => (
                <path key={i} d={d} vectorEffect="non-scaling-stroke" />
              ))}
            </g>
            <g fill={mapStyle.water} stroke={mapStyle.water} strokeWidth={0.8}>
              {basemap.lakes.map((d, i) => (
                <path key={i} d={d} vectorEffect="non-scaling-stroke" />
              ))}
            </g>
            <g fill="none" stroke={mapStyle.water} strokeWidth={1.6} strokeLinecap="round">
              {basemap.rivers.map((d, i) => (
                <path key={i} d={d} vectorEffect="non-scaling-stroke" />
              ))}
            </g>
          </>
        ) : (
          <g fill={mapStyle.land} stroke={mapStyle.border} strokeWidth={0.5}>
            {worldLand.map((d, i) => (
              <path key={i} d={d} vectorEffect="non-scaling-stroke" />
            ))}
          </g>
        )}

        {/* The whole route, in the trip's own accent — the travelled part
            opaque, what's ahead dimmed. Straight, except a flight's own arc
            (`isArcLeg`, `RouteLine`'s rule since B2422/B2424, retiring the
            13 mode-coloured lines `lib/transport.ts` used to draw here). */}
        {places.slice(1).map((p, i) => {
          const from = pts[i];
          const to = pts[i + 1];
          if (!from || !to) return null;
          const done = i + 1 <= activeIndex;
          const mode = p.entries[0]?.transport?.mode;
          return (
            <g key={p.key} opacity={done ? 0.95 : 0.25}>
              <RouteLine
                accent={accent}
                px={px}
                hops={[{ x1: from[0], y1: from[1], x2: to[0], y2: to[1], mode }]}
              />
            </g>
          );
        })}

        {/* Stops, in day order — never yellow: the current one is the
            larger navy `StopMarker` "selected" shape, the same rule every
            other Paper map follows (docs/plans/map-redesign.md §1). */}
        {places.map((p, i) => {
          const pt = pts[i];
          if (!pt) return null;
          const [x, y] = pt;
          return (
            <StopMarker
              key={p.key}
              x={x}
              y={y}
              order={i + 1}
              selected={i === activeIndex}
              ariaLabel={`${p.location}, ${p.country}`}
              px={px}
            />
          );
        })}

        {/* The active stop's own name, the same halo technique `TripMap`
            uses (labelStop/labelStopHalo) — B2424 review found a map of
            unlabelled numbered dots read as an abstraction with the reader's
            own theme's land/sea contrast doing all the work; the caption
            outside the SVG already names the place, but the map itself
            should too. Just the active stop, not all four — the others are
            already fainter, and every name at once is the clutter the plan
            doc's "quiet" label rule warns against. */}
        {(() => {
          const active = pts[activeIndex];
          const place = places[activeIndex];
          if (!active || !place) return null;
          const [x, y] = active;
          // Same threshold shape as `TripMap`'s own `runsOff`: roughly
          // 0.55 em per character, checked against this map's own safe
          // box rather than its frame — B2424 review found "Bangkok" run
          // off a phone's own narrower safe box on a transcontinental leg.
          const runsOff = x + px(16) + px(14) * 0.62 * place.location.length > safe.right;
          return (
            <text
              x={x + (runsOff ? -px(16) : px(16))}
              y={y + px(5)}
              textAnchor={runsOff ? "end" : "start"}
              fontSize={px(14)}
              fontWeight={700}
              fill={mapStyle.labelStop}
              stroke={mapStyle.labelStopHalo}
              strokeWidth={px(3)}
              paintOrder="stroke"
              pointerEvents="none"
              className="font-display"
            >
              {place.location}
            </text>
          );
        })()}

        {/* The leg being flown right now — the vehicle itself, falling back
            to a direction arrow when the day carries no transport mode
            (B2424; before this it silently drew a plane for every unlabelled
            leg). */}
        {travelling && activeIndex > 0 && pts[activeIndex - 1] && pts[activeIndex] && (() => {
          const from = pts[activeIndex - 1]!;
          const to = pts[activeIndex]!;
          const mode = places[activeIndex].entries[0]?.transport?.mode;
          const Icon = mode ? VEHICLE_ICON[mode] ?? Navigation : Navigation;
          // Point the icon along the direction of travel.
          const angle = (Math.atan2(to[1] - from[1], to[0] - from[0]) * 180) / Math.PI;
          return (
            <motion.g
              key={`veh-${activeIndex}`}
              initial={{ x: from[0], y: from[1] }}
              animate={{ x: to[0], y: to[1] }}
              transition={{ duration: FULL_TRAVEL_MS / 1000, ease: [0.45, 0, 0.35, 1] }}
            >
              <g transform={vehicleHeadingTransform(angle)}>
                <circle r={px(5.5)} fill={mapStyle.hereNow} stroke={mapStyle.hereNowHalo} strokeWidth={px(1)} />
                <g transform={`translate(${px(-3.2)}, ${px(-3.2)})`}>
                  <Icon width={px(6.4)} height={px(6.4)} color={mapStyle.hereNowHalo} strokeWidth={2.6} />
                </g>
              </g>
            </motion.g>
          );
        })()}
      </motion.g>
    </svg>
  );
}

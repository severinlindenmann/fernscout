"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { mediaLoader } from "./mediaLoader";
import { AnimatePresence, motion } from "motion/react";
import {
  X,
  Play,
  Pause,
  ChevronLeft,
  ChevronRight,
  Plane,
  TrainFront,
  Bus,
  Bike,
  Car,
  Ship,
  Footprints,
  Sparkles,
  Film,
  Minus,
  Plus,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { project, MAP_VIEWBOX } from "@/lib/mapProjection";
import { useWorldLand } from "./useWorldLand";
import { TRANSPORT_STYLE } from "@/lib/transport";
import { flagFor } from "@/lib/flags";
import { buildNarratedCut, firstSentence, type NarratedCutSlide } from "@/lib/narratedCut";
import { useWakeLock } from "./useWakeLock";
import { useI18n } from "./LocaleProvider";
import type { PlaceView } from "./WorldMap";
import type { GalleryItem } from "@/lib/types";

// Base dwell, in seconds — the "1x" the +/- speed control scales from.
// Deliberately unhurried by default — this is meant to be watched, not skimmed.
const DEFAULT_DWELL_S = 6;
const MIN_DWELL_S = 3;
const MAX_DWELL_S = 15;
const FULL_TRAVEL_MS = 5200;
const FULL_MEDIA_MS = 6500;

// Controls fade out this long after the last pointer/key activity, so a show
// left running on a TV isn't sitting under a permanent overlay of buttons.
const CHROME_IDLE_MS = 3500;

type Cut = "narrated" | "full";

type FullStep =
  | { kind: "travel"; place: PlaceView; fromPlace?: PlaceView; placeIndex: number }
  | {
      kind: "media";
      place: PlaceView;
      item: GalleryItem;
      dayLabel: string;
      time?: string;
      placeIndex: number;
    };

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
}: {
  places: PlaceView[];
  onClose: () => void;
  startPlaceKey?: string;
}) {
  const { t, formatShortDate, formatLongDate, localized } = useI18n();

  const narratedSlides = useMemo<NarratedCutSlide[]>(
    () => buildNarratedCut(places.flatMap((p) => p.entries)),
    [places],
  );

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
            time: entry.time,
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
    if (!startPlaceKey) return 0;
    const i = fullSteps.findIndex((s) => s.place.key === startPlaceKey);
    return i >= 0 ? i : 0;
  }, [fullSteps, startPlaceKey]);

  const [index, setIndex] = useState(cut === "full" ? fullStartIndex : 0);
  const [playing, setPlaying] = useState(true);
  const [dwellSeconds, setDwellSeconds] = useState(DEFAULT_DWELL_S);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const switchCut = useCallback(
    (next: Cut) => {
      setCut(next);
      setIndex(next === "full" ? fullStartIndex : 0);
      setPlaying(true);
    },
    [fullStartIndex],
  );

  const total = cut === "narrated" ? narratedSlides.length : fullSteps.length;
  const narratedStep = cut === "narrated" ? narratedSlides[index] : undefined;
  const fullStep = cut === "full" ? fullSteps[index] : undefined;

  const dwellScale = dwellSeconds / DEFAULT_DWELL_S;
  const duration =
    cut === "narrated"
      ? dwellSeconds * 1000
      : (fullStep?.kind === "travel" ? FULL_TRAVEL_MS : FULL_MEDIA_MS) * dwellScale;

  const atEnd = index >= total - 1;
  // Derived rather than stored, so reaching the end doesn't need a setState
  // inside the timer effect.
  const isPlaying = playing && !atEnd && total > 0;

  useWakeLock(total > 0);

  const go = useCallback(
    (delta: number) => {
      setIndex((i) => Math.min(Math.max(i + delta, 0), Math.max(total - 1, 0)));
    },
    [total],
  );

  // Auto-advance; stops at the end rather than looping.
  useEffect(() => {
    if (!isPlaying) return;
    timerRef.current = setTimeout(() => setIndex((i) => Math.min(i + 1, total - 1)), duration);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [index, isPlaying, duration, total]);

  const toggle = useCallback(() => {
    if (atEnd) {
      setIndex(0);
      setPlaying(true);
      return;
    }
    setPlaying((p) => !p);
  }, [atEnd]);

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

  // Keyboard + scroll lock while the overlay is up.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      bumpChrome();
      if (e.key === "Escape") {
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
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, [onClose, go, toggle, bumpChrome]);

  if (total === 0) return null;

  const narratedLocalized = narratedStep ? localized(narratedStep.entry) : undefined;
  const narratedSentence = narratedLocalized ? firstSentence(narratedLocalized.content) : "";
  const narratedHeadline = narratedSentence || narratedLocalized?.title || "";

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
          height: min(100vh, calc(100vw * 9 / 16));
        }
        @media (orientation: portrait) {
          .fs-present-frame { width: 100vw; height: 100vh; }
        }
      `}</style>
      <div ref={containerRef} className="relative overflow-hidden bg-navy-900 fs-present-frame">
        {cut === "full" && fullStep ? (
          <>
            {/* Map layer — always mounted so the camera keeps its position. */}
            <div
              className={`absolute inset-0 ${showingFullMedia ? "opacity-25" : "opacity-100"} transition-opacity duration-700`}
            >
              <SlideMap
                places={places}
                activeIndex={fullStep.placeIndex}
                travelling={fullStep.kind === "travel" && fullStep.placeIndex > 0}
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
                      src={fullStep.item.src}
                      className="max-h-full max-w-full rounded-xl object-contain shadow-2xl"
                      autoPlay
                      muted
                      playsInline
                    />
                  ) : (
                    <motion.div
                      initial={{ scale: 1 }}
                      animate={{ scale: 1.06 }}
                      transition={{ duration: FULL_MEDIA_MS / 1000, ease: "linear" }}
                      className="relative h-full w-full"
                    >
                      <Image
                        src={fullStep.item.src}
                        loader={mediaLoader}
                        alt={fullStep.item.caption ?? fullPlace?.location ?? ""}
                        fill
                        sizes="100vw"
                        className="object-contain"
                        priority
                      />
                    </motion.div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Caption — place, when, and one line of what. */}
            {fullPlace && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-navy-900 via-navy-900/70 to-transparent px-[4%] pb-[14%] pt-[10%]">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={`cap-${index}`}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.35 }}
                  >
                    <div className="font-display font-semibold text-white text-[clamp(1.5rem,4.2vw,3.25rem)]">
                      {flagFor(fullPlace.country, fullPlace.countryCode)} {fullPlace.location}
                    </div>
                    <div className="mt-1 text-white/70 text-[clamp(0.8rem,1.4vw,1.25rem)]">
                      {showingFullMedia && fullStep.kind === "media"
                        ? [fullStep.dayLabel, fullStep.time, fullStep.item.caption]
                            .filter(Boolean)
                            .join(" · ")
                        : `${fullPlace.country} · ${formatShortDate(fullPlace.firstDate)}`}
                    </div>
                  </motion.div>
                </AnimatePresence>
              </div>
            )}
          </>
        ) : (
          narratedStep && (
            <NarratedSlide
              slide={narratedStep}
              index={index}
              headline={narratedHeadline}
              dateLabel={formatLongDate(narratedStep.date)}
            />
          )
        )}

        {/* Progress */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex gap-1 p-2">
          {Array.from({ length: total }).map((_, i) => (
            <div key={i} className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/25">
              {i < index && <div className="h-full w-full bg-white/80" />}
              {i === index && (
                <motion.div
                  key={`p-${index}-${isPlaying}`}
                  initial={{ width: "0%" }}
                  animate={{ width: isPlaying ? "100%" : "35%" }}
                  transition={{ duration: isPlaying ? duration / 1000 : 0.3, ease: "linear" }}
                  className="h-full bg-white"
                />
              )}
            </div>
          ))}
        </div>

        {/* Chrome: cut switch, controls, speed and fullscreen — fades out
            during playback, always there while paused or idle. */}
        <AnimatePresence>
          {showChrome && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="pointer-events-none absolute inset-0"
            >
              {narratedSlides.length > 0 && fullSteps.length > 0 && (
                <div className="pointer-events-auto absolute left-1/2 top-4 flex -translate-x-1/2 items-center gap-0.5 rounded-full bg-black/40 p-1 backdrop-blur">
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

              <div className="pointer-events-auto absolute right-3 top-3 flex items-center gap-2">
                <button
                  onClick={toggleFullscreen}
                  aria-label={isFullscreen ? t("show.exitFullscreen") : t("show.fullscreen")}
                  title={isFullscreen ? t("show.exitFullscreen") : t("show.fullscreen")}
                  className="rounded-full bg-white/10 p-2.5 text-white/90 transition-colors hover:bg-white/20"
                >
                  {isFullscreen ? (
                    <Minimize2 className="h-5 w-5" />
                  ) : (
                    <Maximize2 className="h-5 w-5" />
                  )}
                </button>
                <button
                  onClick={onClose}
                  aria-label={t("show.close")}
                  title={t("show.close")}
                  className="rounded-full bg-white/10 p-2.5 text-white/90 transition-colors hover:bg-white/20"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="pointer-events-auto absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 p-5">
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
                    disabled={index === total - 1}
                  >
                    <ChevronRight className="h-5 w-5" />
                  </Ctrl>
                </div>
                <div className="flex items-center gap-1 rounded-full bg-white/10 px-1.5 py-1.5">
                  <button
                    onClick={() => setDwellSeconds((s) => Math.max(MIN_DWELL_S, s - 1))}
                    disabled={dwellSeconds <= MIN_DWELL_S}
                    aria-label={t("show.slower")}
                    title={t("show.slower")}
                    className="rounded-full p-1.5 text-white/90 transition-colors hover:bg-white/20 disabled:opacity-30"
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                  <span className="w-12 text-center text-xs tabular-nums text-white/80">
                    {t("show.perSlide", { seconds: String(dwellSeconds) })}
                  </span>
                  <button
                    onClick={() => setDwellSeconds((s) => Math.min(MAX_DWELL_S, s + 1))}
                    disabled={dwellSeconds >= MAX_DWELL_S}
                    aria-label={t("show.faster")}
                    title={t("show.faster")}
                    className="rounded-full p-1.5 text-white/90 transition-colors hover:bg-white/20 disabled:opacity-30"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

/** One narrated-cut slide: the day's best photo (or a plain card when there
 * is none) with the date/place as a kicker and one sentence as the headline. */
function NarratedSlide({
  slide,
  index,
  headline,
  dateLabel,
}: {
  slide: NarratedCutSlide;
  index: number;
  headline: string;
  dateLabel: string;
}) {
  return (
    <div className="absolute inset-0">
      {slide.photo ? (
        <motion.div
          key={`photo-${index}`}
          initial={{ scale: 1 }}
          animate={{ scale: 1.06 }}
          transition={{ duration: 8, ease: "linear" }}
          className="absolute inset-0"
        >
          <Image
            src={slide.photo.src}
            loader={mediaLoader}
            alt={slide.photo.caption ?? slide.location}
            fill
            sizes="100vw"
            className="object-cover"
            priority={index === 0}
          />
        </motion.div>
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-navy-900 via-navy-700 to-sky-500/40 grain" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-navy-900/95 via-navy-900/25 to-navy-900/10" />

      <AnimatePresence mode="wait">
        <motion.div
          key={`narrated-cap-${index}`}
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
          className="absolute inset-x-0 bottom-0 px-[5%] pb-[9%] pt-[16%]"
        >
          <div className="font-semibold text-yellow-300 text-[clamp(0.85rem,1.6vw,1.4rem)]">
            {flagFor(slide.country, slide.countryCode)} {slide.location} · {dateLabel}
          </div>
          {headline && (
            <div className="mt-2 font-display font-semibold leading-tight text-white text-[clamp(1.75rem,5vw,4.5rem)]">
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
      className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
        active ? "bg-yellow-400 text-yellow-950" : "text-white/80 hover:bg-white/10"
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
          : "bg-white/10 text-white hover:bg-white/20"
      }`}
    >
      {children}
    </button>
  );
}

const VEHICLE_ICON = {
  flight: Plane,
  train: TrainFront,
  bus: Bus,
  motorbike: Bike,
  car: Car,
  boat: Ship,
  walk: Footprints,
} as const;

/** The map behind the show: same land data, camera pinned to the active stop,
 * and — while a leg is playing — the vehicle actually travelling along it. */
function SlideMap({
  places,
  activeIndex,
  travelling,
}: {
  places: PlaceView[];
  activeIndex: number;
  travelling: boolean;
}) {
  const worldLand = useWorldLand();
  const pts = places.map((p) => project(p.lat, p.lng));
  const active = pts[activeIndex] ?? [MAP_VIEWBOX.width / 2, MAP_VIEWBOX.height / 2];
  const ZOOM = 3.4;
  const cx = MAP_VIEWBOX.width / 2;
  const cy = MAP_VIEWBOX.height / 2;

  return (
    <svg
      viewBox={`0 0 ${MAP_VIEWBOX.width} ${MAP_VIEWBOX.height}`}
      className="h-full w-full"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
    >
      <rect width={MAP_VIEWBOX.width} height={MAP_VIEWBOX.height} fill="#0f2b3d" />
      <motion.g
        animate={{
          x: cx - active[0] * ZOOM,
          y: cy - active[1] * ZOOM,
          scale: ZOOM,
        }}
        transition={{ duration: FULL_TRAVEL_MS / 1000, ease: [0.4, 0, 0.2, 1] }}
        style={{ originX: 0, originY: 0 }}
      >
        <g fill="#1d4e5f" stroke="#2b6b7f" strokeWidth={0.5}>
          {worldLand.map((d, i) => (
            <path key={i} d={d} />
          ))}
        </g>

        {places.slice(1).map((p, i) => {
          const [x1, y1] = pts[i];
          const [x2, y2] = pts[i + 1];
          const mode = p.entries[0]?.transport?.mode;
          const style = mode ? TRANSPORT_STYLE[mode] : null;
          if (!style) return null;
          const done = i + 1 <= activeIndex;
          const isCurrentLeg = travelling && i + 1 === activeIndex;
          // Bowed by mode, exactly as the trip map draws it, so a flight
          // arcs in both places. This map's viewBox is the whole world at
          // roughly a unit per pixel, so the dash needs no scaling here.
          const dx = x2 - x1;
          const dy = y2 - y1;
          const len = Math.hypot(dx, dy) || 1;
          const bow = len * style.bow;
          const bx = (x1 + x2) / 2 - (dy / len) * bow;
          const by = (y1 + y2) / 2 + (dx / len) * bow;
          return (
            <motion.path
              key={p.key}
              d={`M${x1},${y1} Q${bx},${by} ${x2},${y2}`}
              fill="none"
              stroke={style.color}
              strokeWidth={1.2}
              strokeDasharray={style.dash ? style.dash.join(" ") : undefined}
              strokeLinecap="round"
              opacity={done ? 0.95 : 0.25}
              initial={isCurrentLeg ? { pathLength: 0 } : false}
              animate={isCurrentLeg ? { pathLength: 1 } : {}}
              transition={{ duration: FULL_TRAVEL_MS / 1000, ease: [0.45, 0, 0.35, 1] }}
            />
          );
        })}

        {places.map((p, i) => {
          const [x, y] = pts[i];
          const isActive = i === activeIndex;
          return (
            <g key={p.key}>
              {isActive && (
                <motion.circle
                  cx={x}
                  cy={y}
                  r={3}
                  fill="#ffd23f"
                  initial={{ scale: 1, opacity: 0.5 }}
                  animate={{ scale: [1, 3.2], opacity: [0.5, 0] }}
                  transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
                  style={{ transformOrigin: `${x}px ${y}px` }}
                />
              )}
              <circle
                cx={x}
                cy={y}
                r={isActive ? 2.6 : 1.6}
                fill={isActive ? "#ffd23f" : i < activeIndex ? "#ffffff" : "#7aa5b5"}
                stroke="#0f2b3d"
                strokeWidth={0.7}
              />
            </g>
          );
        })}

        {/* The leg being flown right now. */}
        {travelling && activeIndex > 0 && (() => {
          const from = pts[activeIndex - 1];
          const to = pts[activeIndex];
          const mode = places[activeIndex].entries[0]?.transport?.mode;
          const Icon = mode ? (VEHICLE_ICON[mode] ?? Plane) : Plane;
          // Point the icon along the direction of travel.
          const angle = (Math.atan2(to[1] - from[1], to[0] - from[0]) * 180) / Math.PI;
          return (
            <motion.g
              key={`veh-${activeIndex}`}
              initial={{ x: from[0], y: from[1] }}
              animate={{ x: to[0], y: to[1] }}
              transition={{ duration: FULL_TRAVEL_MS / 1000, ease: [0.45, 0, 0.35, 1] }}
            >
              <g transform={`rotate(${angle})`}>
                <circle r={5.5} fill="#ffd23f" stroke="#0f2b3d" strokeWidth={1} />
                <g transform="translate(-3.2, -3.2)">
                  <Icon width={6.4} height={6.4} color="#0f2b3d" strokeWidth={2.6} />
                </g>
              </g>
            </motion.g>
          );
        })()}
      </motion.g>
    </svg>
  );
}

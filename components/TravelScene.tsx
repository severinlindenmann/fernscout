"use client";

import { useEffect, useState } from "react";
import {
  animate,
  motion,
  useMotionValue,
  useTransform,
  type MotionValue,
} from "motion/react";
import { Plane, TrainFront, Bus, Bike, Car, Ship, Footprints, Cloud } from "lucide-react";
import type { DaySummary, TransportMode, TravelSceneVariant } from "@/lib/types";
import Travelers from "./Travelers";
import { useSite } from "./SiteProvider";
import { useTrip } from "./TripProvider";
import { partyFor } from "@/lib/travellers/parse";
import Cityscape from "./Cityscape";

const VEHICLE_ICON = {
  flight: Plane,
  train: TrainFront,
  bus: Bus,
  motorbike: Bike,
  car: Car,
  boat: Ship,
  walk: Footprints,
} as const;

/** Duration when either end of the leg carries no coordinates — the middle
 * of the range below, and what every leg played before duration varied. */
const FALLBACK_DURATION = 6;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}

/**
 * Great-circle distance in km. The same formula as `haversineKm` in
 * lib/plan.ts and `distanceKm` in lib/ingest/geo.ts, kept as its own copy
 * here rather than imported: both of those pull in `server-only` or
 * `node:fs`, and this component runs in the browser.
 */
function greatCircleKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(la1) * Math.cos(la2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * The distance a leg covered, or `null` when either end has no coordinates
 * to measure from — a hand-written entry without `lat`/`lng` is common
 * enough that this has to be a real case, not an edge one.
 */
export function legDistanceKm(from: DaySummary | undefined, leg: DaySummary): number | null {
  if (!from) return null;
  const coords = [from.lat, from.lng, leg.lat, leg.lng];
  if (coords.some((n) => typeof n !== "number" || !Number.isFinite(n))) return null;
  return greatCircleKm({ lat: from.lat, lng: from.lng }, { lat: leg.lat, lng: leg.lng });
}

/**
 * How long one leg takes to play, in seconds.
 *
 * Every leg used to take the same `FALLBACK_DURATION` regardless of what it
 * actually crossed — a night bus and a transoceanic flight played the
 * identical six seconds. `"quick"` compresses the same idea into a couple of
 * seconds for a reader who has already sat through the full scene many
 * times; `"skip"` never reaches this at all, because `buildSteps` leaves it
 * out of the pager. Unknown distance falls back to the middle of each range,
 * not the top or the bottom, since it is not evidence either way.
 */
export function sceneDurationSeconds(
  variant: TravelSceneVariant,
  km: number | null,
): number {
  if (variant === "quick") {
    return km === null ? 1.8 : clamp(1.2 + Math.sqrt(km) / 40, 1.2, 2.6);
  }
  return km === null ? FALLBACK_DURATION : clamp(3 + Math.sqrt(km) / 10, 3, 9);
}

/**
 * One leg of the trip, played on its own screen: the travellers head off, the
 * vehicle crosses (arcing up and back down for flights), and the destination
 * rises into view.
 *
 * This used to be scroll-driven. It isn't any more — the story is paged, so
 * the leg simply plays, and the reader either waits for it or skips ahead.
 *
 * **Variants.** `leg.travelScene` picks the treatment: `"default"` (or
 * absent) is the scene above, timed to the distance actually crossed;
 * `"quick"` compresses to an icon crossing a line, for a trip whose every
 * leg looks the same by day thirty; `"skip"` is handled one level up, by
 * `buildSteps` leaving the leg out of the pager entirely, so it never
 * reaches this component in practice. It is still handled defensively here —
 * rendered as the default scene but collapsed to the same near-zero duration
 * as reduced motion — so a caller that renders one directly never hangs.
 */
export default function TravelScene({
  leg,
  from,
  onDone,
}: {
  /** The day arrived at. A leg is entirely described by where it went and
   * how, both of which the story's day index already carries — so a travel
   * scene never waits on the day's content to load. */
  leg: DaySummary;
  /** The day travelled from, in the same index — enough to measure the
   * distance this leg covers. Absent plays the fallback duration. */
  from?: DaySummary;
  onDone?: () => void;
}) {
  const p = useMotionValue(0);
  const [progress, setProgress] = useState(0);

  // The same party the hero draws. `useTrip` is null outside a trip's story,
  // which a travel scene never is — but the fallback costs one `?.` and keeps
  // this component renderable on its own.
  const site = useSite();
  const active = useTrip();
  const party = partyFor(active?.trip.travellers ?? [], site.travellerFigures);

  const variant: TravelSceneVariant = leg.travelScene ?? "default";
  const km = legDistanceKm(from, leg);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // One effect, one `animate` call, for every variant — reduced motion and
    // a directly-rendered "skip" both collapse to the same near-zero
    // duration, so there is exactly one place `onDone` can fire from and no
    // per-variant branch to keep in sync.
    const duration = reduce || variant === "skip" ? 0.01 : sceneDurationSeconds(variant, km);
    const controls = animate(p, 1, {
      duration,
      ease: "linear",
      onUpdate: setProgress,
      onComplete: () => onDone?.(),
    });
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leg.slug]);

  const mode: TransportMode = leg.transport?.mode ?? "walk";
  const Icon = VEHICLE_ICON[mode] ?? Plane;
  const isFlight = mode === "flight";
  const quick = variant === "quick";

  // Travellers wait at the start, then walk out of frame to the right.
  const peopleX = useTransform(p, [0.04, 0.4], ["0%", "125%"]);
  const peopleOpacity = useTransform(p, [0.0, 0.12, 0.32, 0.44], [0, 1, 1, 0]);

  // Vehicle sweeps left → right across the middle of the leg.
  const vehicleX = useTransform(p, [0.22, 0.86], ["-22%", "120%"]);
  const vehicleY = useTransform(
    p,
    [0.26, 0.45, 0.66, 0.82],
    isFlight ? [8, -54, -54, 8] : [0, 0, 0, 0],
  );
  const vehicleRotate = useTransform(
    p,
    [0.26, 0.42, 0.7, 0.82],
    isFlight ? [-6, -14, 10, 2] : [0, 0, 0, 0],
  );
  const vehicleOpacity = useTransform(p, [0.14, 0.3, 0.78, 0.92], [0, 1, 1, 0]);

  // Destination skyline rises in near the end.
  const cityY = useTransform(p, [0.5, 0.92], [70, 0]);
  const cityOpacity = useTransform(p, [0.5, 0.8], [0, 1]);
  const cloudsX = useTransform(p, [0, 1], ["4%", "-14%"]);

  // The quick scene's icon crosses a plain lane, edge to edge.
  const quickX = useTransform(p, [0.06, 0.94], ["0%", "100%"]);
  const quickOpacity = useTransform(p, [0, 0.08, 0.9, 1], [0, 1, 1, 0]);

  return (
    <div
      className={`relative w-full overflow-hidden rounded-2xl border border-navy-200 shadow-sm ${
        quick
          ? "h-[110px] bg-navy-50"
          : "h-[280px] bg-gradient-to-b from-sky-300 to-sky-400 sm:h-[340px]"
      }`}
    >
      {quick ? (
        <div className="absolute inset-x-6 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-navy-200">
          <motion.div
            style={{ x: quickX, opacity: quickOpacity }}
            className="absolute top-1/2 left-0 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white p-2 shadow-md shadow-navy-900/15"
          >
            <Icon className="h-5 w-5 text-navy-900" strokeWidth={1.75} />
          </motion.div>
        </div>
      ) : (
        <>
          <motion.div style={{ x: cloudsX }} className="pointer-events-none absolute inset-0">
            <Cloud className="absolute left-[12%] top-6 h-10 w-10 fill-white text-white opacity-90" />
            <Cloud className="absolute left-[56%] top-10 h-7 w-7 fill-white text-white opacity-75" />
            <Cloud className="absolute left-[84%] top-5 h-8 w-8 fill-white text-white opacity-80" />
          </motion.div>

          <motion.div
            style={{ y: cityY, opacity: cityOpacity }}
            className="absolute bottom-9 right-2 origin-bottom-right"
          >
            <Cityscape name={leg.location} width={250} height={150} />
          </motion.div>

          <div className="absolute inset-x-0 bottom-0 h-9 bg-green-100" />
          <div className="absolute inset-x-0 bottom-9 h-1 bg-green-500/25" />

          <motion.div
            style={{ x: peopleX, opacity: peopleOpacity }}
            className="absolute bottom-7 left-8"
          >
            <Travelers figures={party} size={58} available={200} />
          </motion.div>

          <motion.div
            style={{ x: vehicleX, y: vehicleY, rotate: vehicleRotate, opacity: vehicleOpacity }}
            className="absolute bottom-11 left-0"
          >
            <div className="rounded-2xl bg-white/95 p-3 shadow-lg shadow-navy-900/20">
              <Icon className="h-9 w-9 text-navy-900" strokeWidth={1.75} />
            </div>
          </motion.div>
        </>
      )}

      <Caption leg={leg} progress={p} />

      {/* How far through the leg we are. */}
      <div className="absolute inset-x-0 bottom-0 h-1 bg-white/25">
        <div
          className="h-full bg-yellow-400 transition-[width] duration-100 ease-linear"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>
    </div>
  );
}

function Caption({ leg, progress }: { leg: DaySummary; progress: MotionValue<number> }) {
  const opacity = useTransform(progress, [0.04, 0.16], [0, 1]);
  const y = useTransform(progress, [0.04, 0.16], [10, 0]);
  if (!leg.transport) return null;
  return (
    <motion.div
      style={{ opacity, y }}
      className="pointer-events-none absolute left-5 top-5 rounded-xl bg-white/90 px-3.5 py-2 shadow-sm backdrop-blur-sm"
    >
      <div className="font-display text-sm font-semibold text-navy-900">
        {leg.transport.from} → {leg.transport.to}
      </div>
      <div className="text-xs capitalize text-navy-600">by {leg.transport.mode}</div>
    </motion.div>
  );
}

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
import type { DaySummary, TransportMode } from "@/lib/types";
import Travelers from "./Travelers";
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

/** How long one leg takes to play out. */
export const TRAVEL_DURATION = 6;

/**
 * One leg of the trip, played on its own screen: the travellers head off, the
 * vehicle crosses (arcing up and back down for flights), and the destination
 * rises into view.
 *
 * This used to be scroll-driven. It isn't any more — the story is paged, so
 * the leg simply plays, and the reader either waits for it or skips ahead.
 */
export default function TravelScene({
  leg,
  onDone,
}: {
  /** The day arrived at. A leg is entirely described by where it went and
   * how, both of which the story's day index already carries — so a travel
   * scene never waits on the day's content to load. */
  leg: DaySummary;
  onDone?: () => void;
}) {
  const p = useMotionValue(0);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const controls = animate(p, 1, {
      duration: reduce ? 0.01 : TRAVEL_DURATION,
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

  return (
    <div className="relative h-[280px] w-full overflow-hidden rounded-2xl border border-navy-200 bg-gradient-to-b from-sky-300 to-sky-400 shadow-sm sm:h-[340px]">
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
        <Travelers size={58} />
      </motion.div>

      <motion.div
        style={{ x: vehicleX, y: vehicleY, rotate: vehicleRotate, opacity: vehicleOpacity }}
        className="absolute bottom-11 left-0"
      >
        <div className="rounded-2xl bg-white/95 p-3 shadow-lg shadow-navy-900/20">
          <Icon className="h-9 w-9 text-navy-900" strokeWidth={1.75} />
        </div>
      </motion.div>

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

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
import Vehicle from "./travel/Vehicle";
import Ground, { GROUND_HEIGHT, surfaceFor } from "./travel/Ground";

/**
 * The glyphs, kept for the `quick` variant only.
 *
 * `quick` is a line and a marker crossing it — deliberately a diagram rather
 * than a scene, for a reader on their fortieth identical hop — and a diagram
 * is exactly where an icon belongs. The full scene draws real vehicles; see
 * `components/travel/Vehicle.tsx`.
 */
const VEHICLE_ICON = {
  flight: Plane,
  train: TrainFront,
  bus: Bus,
  motorbike: Bike,
  car: Car,
  boat: Ship,
  walk: Footprints,
} as const;

/**
 * Where things stand on each surface, in px from the bottom of the frame.
 *
 * Two numbers rather than one because a hull and a pair of boots do not sit at
 * the same height in the same water: the party stands *on* a road and *beside*
 * the sea, and a boat rides *in* it. Getting this wrong is the difference
 * between a ferry and a ferry buried to its windows.
 */
const STAND_ON = { rail: 30, road: 30, water: 58, sky: 26, path: 26 } as const;
const RIDE_ON = { rail: 8, road: 10, water: 14, sky: 60, path: 0 } as const;

/** How wide each vehicle is drawn in the full scene. A train is a train
 * because it is long; a motorbike is small because it is. */
const VEHICLE_WIDTH: Record<TransportMode, number> = {
  train: 210,
  flight: 165,
  bus: 145,
  boat: 150,
  car: 115,
  motorbike: 95,
  walk: 0,
};

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
  const onFoot = mode === "walk";
  const quick = variant === "quick";
  const surface = surfaceFor(mode);
  const groundH = GROUND_HEIGHT[surface];

  /*
   * Three layers moving at three speeds, which is the whole of the depth:
   * the ground (in `Ground`, fastest) is underfoot, the skylines are the
   * middle distance, and the clouds are the sky. Before this everything but
   * the clouds was static and the vehicle slid over a photograph.
   */
  const cloudsX = useTransform(p, [0, 1], ["2%", "-10%"]);
  const hillsX = useTransform(p, [0, 1], ["0%", "-18%"]);
  const farX = useTransform(p, [0, 1], ["0%", "-34%"]);

  /*
   * On foot the party *is* the vehicle: they cross the whole frame at
   * walking pace and nothing else moves through the scene. Every other mode
   * keeps the old departure — they set off to the right and the vehicle
   * follows them across.
   */
  const afloat = surface === "water";
  const peopleX = useTransform(
    p,
    onFoot ? [0.05, 0.95] : [0.04, 0.4],
    // Nobody walks off across a river. On a crossing by boat the party stays
    // put and is gone before the far bank has slid away — otherwise they were
    // left standing on open water for a third of the leg, which is what the
    // first version of this actually drew.
    afloat ? ["0%", "0%"] : ["0%", "125%"],
  );
  const peopleOpacity = useTransform(
    p,
    onFoot ? [0, 0.08, 0.9, 1] : afloat ? [0, 0.08, 0.2, 0.3] : [0.0, 0.12, 0.32, 0.44],
    [0, 1, 1, 0],
  );

  // Vehicle sweeps left → right across the middle of the leg.
  const vehicleX = useTransform(p, [0.22, 0.86], ["-30%", "125%"]);
  const vehicleY = useTransform(
    p,
    [0.26, 0.45, 0.66, 0.82],
    isFlight ? [10, -70, -70, 10] : [0, 0, 0, 0],
  );
  const vehicleRotate = useTransform(
    p,
    [0.26, 0.42, 0.7, 0.82],
    isFlight ? [-7, -13, 9, 2] : [0, 0, 0, 0],
  );
  const vehicleOpacity = useTransform(p, [0.14, 0.3, 0.78, 0.92], [0, 1, 1, 0]);
  // A hull has no wheels; the swell is what carries it. Small and slow — a
  // boat that bobs like a cork reads as a toy.
  const hullY = useTransform(p, [0, 0.25, 0.5, 0.75, 1], mode === "boat" ? [0, -4, 1, -3, 0] : [0, 0, 0, 0, 0]);

  /*
   * Both ends of the leg, not just the arrival.
   *
   * The origin used to be an empty green field: the travellers set off from
   * nowhere towards a city that rose out of the ground. Now where they left
   * slides out to the left as where they are going slides in from the right,
   * which is what makes it a journey between two places rather than an
   * arrival at one.
   */
  const originX = useTransform(p, [0, 0.55], ["0%", "-140%"]);
  const originOpacity = useTransform(p, [0, 0.1, 0.42], [1, 1, 0]);
  const destX = useTransform(p, [0.45, 0.95], ["120%", "0%"]);
  const destOpacity = useTransform(p, [0.45, 0.62], [0, 1]);

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
          {/* Sky, slowest. A flight gets more of it, because for the length of
              a flight the sky is the whole world. */}
          <motion.div style={{ x: cloudsX }} className="pointer-events-none absolute inset-0">
            <Cloud className="absolute left-[12%] top-6 h-10 w-10 fill-white text-white opacity-90" />
            <Cloud className="absolute left-[56%] top-10 h-7 w-7 fill-white text-white opacity-75" />
            <Cloud className="absolute left-[84%] top-5 h-8 w-8 fill-white text-white opacity-80" />
            {isFlight && (
              <>
                <Cloud className="absolute left-[30%] top-24 h-12 w-12 fill-white text-white opacity-70" />
                <Cloud className="absolute left-[70%] top-32 h-9 w-9 fill-white text-white opacity-60" />
              </>
            )}
          </motion.div>

          {/* Distant hills — the layer between the clouds and the skylines,
              and the thing that stopped the frame being two thirds empty sky
              on a leg between two small places. Drawn from the arrival's name
              so a leg looks the same every time it plays. A crossing by sea
              has no hills in the middle of it. */}
          {surface !== "water" && (
            <motion.div style={{ x: hillsX }} className="pointer-events-none absolute inset-0">
              <Hills seed={leg.location} bottom={groundH - 4} />
            </motion.div>
          )}

          {/*
            Middle distance: where they left, and where they are going.

            The origin used to be an empty green field — the party set off from
            nowhere towards a city that rose out of the ground. Both ends are in
            the day index already, so drawing both costs nothing and waits on
            nothing. `farX` is the parallax; the two `x`s inside it are the
            leaving and the arriving.
          */}
          <motion.div style={{ x: farX }} className="pointer-events-none absolute inset-0">
            {from && (
              <motion.div
                style={{ x: originX, opacity: originOpacity, bottom: groundH - 6 }}
                className="absolute left-2"
              >
                <Cityscape
                  name={from.location}
                  population={from.population}
                  lat={from.lat}
                  width={230}
                  height={130}
                />
              </motion.div>
            )}

            <motion.div
              style={{ x: destX, opacity: destOpacity, bottom: groundH - 6 }}
              className="absolute right-2"
            >
              <Cityscape
                name={leg.location}
                population={leg.population}
                lat={leg.lat}
                width={250}
                height={150}
              />
            </motion.div>
          </motion.div>

          {/* Nearest layer, fastest: rails, tarmac, water or a footpath. */}
          <Ground surface={surface} scroll={p} />

          <motion.div
            style={{ x: peopleX, opacity: peopleOpacity, bottom: STAND_ON[surface] }}
            className="absolute left-8"
          >
            <Travelers figures={party} size={58} available={200} />
          </motion.div>

          {/* Nothing crosses on a leg made on foot — the party above is the
              whole of it. */}
          {!onFoot && (
            <motion.div
              style={{
                x: vehicleX,
                y: vehicleY,
                rotate: vehicleRotate,
                opacity: vehicleOpacity,
                bottom: RIDE_ON[surface],
              }}
              className="absolute left-0"
            >
              <motion.div style={{ y: hullY }}>
                <Vehicle mode={mode} width={VEHICLE_WIDTH[mode]} />
              </motion.div>
            </motion.div>
          )}
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

/**
 * A ridge line across the back of the scene.
 *
 * Two overlapping bands rather than one, because a single silhouette reads as
 * a paper cut-out; the paler one behind is what gives the distance. Derived
 * from the arrival's name so the same leg draws the same hills every time,
 * the way `Cityscape` does — and deliberately *not* from anything real, since
 * nothing in a day's frontmatter says what the horizon looked like. They are
 * scenery, at the size and opacity of scenery.
 */
function Hills({ seed, bottom }: { seed: string; bottom: number }) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const pick = (i: number, lo: number, hi: number) =>
    lo + (((Math.abs(h) >> (i * 3)) % 100) / 100) * (hi - lo);

  const ridge = (peaks: number[]) => {
    const step = 100 / (peaks.length - 1);
    // Anchored past both edges so the ridge still fills the frame once the
    // parallax has slid it, and closed along the bottom rather than at the
    // peaks — a ridge that ends mid-air reads as a torn piece of paper.
    return `M-20,120 ${peaks.map((y, i) => `L${i * step},${y}`).join(" ")} L120,120 Z`;
  };

  return (
    <svg
      // `width` matters: an <svg> with only a viewBox takes its intrinsic size
      // from it, so `inset-x-0` left this 100px wide at the far left of the
      // frame and the hills appeared to be part of the departure town.
      // The extra 30% and the offset are the room the parallax slides into.
      className="absolute"
      style={{ bottom, height: 120, left: "-15%", width: "130%" }}
      viewBox="0 0 100 120"
      preserveAspectRatio="none"
      aria-hidden
    >
      {/* Hazy blue for the far ridge and a green-grey for the near one. They
          were white at a fifth opacity for one iteration, which on a sky this
          pale is invisible — distance in a flat illustration is a shift in hue
          towards the sky, not a fade to nothing. */}
      <path
        d={ridge([100, pick(0, 46, 74), pick(1, 62, 86), pick(2, 40, 70), pick(3, 66, 90), 104])}
        fill="#9ed3e4"
      />
      <path
        d={ridge([108, pick(4, 72, 96), pick(5, 58, 84), pick(6, 80, 102), pick(7, 66, 92), 96])}
        fill="#8cc4ae"
      />
    </svg>
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
